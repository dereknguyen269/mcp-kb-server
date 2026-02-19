import { detectProjectId, validateProjectRoot } from "../utils/projectId.js";
import {
  discoverInstructionPaths,
  loadAuthoritativeFiles,
  dedupePaths
} from "../utils/fileDiscovery.js";

function asBoolean(value, defaultValue) {
  if (value === undefined) return defaultValue;
  return Boolean(value);
}

function expectString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    const error = new Error(`${name} must be a non-empty string`);
    error.code = -32602;
    throw error;
  }
}

function expectOptionalStringArray(value, name) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((i) => typeof i !== "string")) {
    const error = new Error(`${name} must be an array of strings`);
    error.code = -32602;
    throw error;
  }
}

export function createSummaryTools({ memorySearchTool, kbSearchTool }) {
  if (!memorySearchTool || typeof memorySearchTool.handler !== "function") {
    throw new Error("summary.project requires memory.search tool handler");
  }
  if (!kbSearchTool || typeof kbSearchTool.handler !== "function") {
    throw new Error("summary.project requires kb.search tool handler");
  }

  return [
    {
      name: "summary.project",
      description:
        "Generate a ground-truth–aware project knowledge snapshot by reading authoritative instruction files, long-term memory, and the knowledge base. This tool does NOT store results automatically.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string", description: "Project identifier (auto-detected from project_root if not provided)" },
          project_root: { type: "string" },
          include_files: {
            type: "array",
            items: { type: "string" },
            description: "Explicit file or directory paths (relative to project root) to treat as authoritative"
          },
          auto_discover: { type: "boolean", default: false, description: "Automatically discover common instruction files" },
          include_memory: { type: "boolean", default: true },
          include_kb: { type: "boolean", default: true }
        },
        required: ["project_root"]
      },
      handler: async (args) => {
        let project_id = args?.project_id;
        const project_root = args?.project_root;
        const include_files = args?.include_files;

        expectString(project_root, "project_root");
        expectOptionalStringArray(include_files, "include_files");

        if (!project_id) {
          const detection = detectProjectId(project_root, { explicitProjectId: project_id });
          project_id = detection.project_id;
        } else {
          validateProjectRoot(project_root);
        }

        expectString(project_id, "project_id");

        const autoDiscover = asBoolean(args?.auto_discover, false);
        const includeMemory = asBoolean(args?.include_memory, true);
        const includeKb = asBoolean(args?.include_kb, true);

        const discovered_files = autoDiscover ? discoverInstructionPaths(project_root) : [];
        const mergedIncludeFiles = dedupePaths([...(include_files ?? []), ...discovered_files]);
        const authoritative_files = loadAuthoritativeFiles(project_root, mergedIncludeFiles);

        const memory = includeMemory
          ? (await Promise.resolve(memorySearchTool.handler({ project_id, query: "", limit: 50 }))).map((m) => ({
              content: m.content,
              tags: Array.isArray(m.tags) ? m.tags : [],
              created_at: m.created_at
            }))
          : [];

        const kbRows = includeKb ? await Promise.resolve(kbSearchTool.handler({ query: "", limit: 20 })) : [];
        const knowledge_base = (Array.isArray(kbRows) ? kbRows : []).map((d) => ({
          title: typeof d.title === "string" ? d.title : "",
          excerpt: (typeof d.content === "string" ? d.content : "").slice(0, 500),
          source: d.source ?? null
        }));

        return {
          project_id,
          authoritative_files,
          discovered_files,
          memory,
          knowledge_base,
          instructions:
            "Synthesize this data into a project summary. Files are authoritative over memory. Do not invent; resolve conflicts explicitly."
        };
      }
    }
  ];
}
