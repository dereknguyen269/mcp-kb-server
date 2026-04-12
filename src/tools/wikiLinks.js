import crypto from "node:crypto";
import { detectProjectId, validateProjectRoot } from "../utils/projectId.js";

function resolveProjectId(args) {
  let project_id = args?.project_id;
  const project_root = args?.project_root;
  if (!project_id && project_root) {
    const detection = detectProjectId(project_root, { explicitProjectId: project_id });
    project_id = detection.project_id;
  } else if (project_root) {
    validateProjectRoot(project_root);
  }
  return project_id;
}

const VALID_TYPES = new Set(["memory", "source", "kb"]);

export function createWikiLinkTools({ memoryDb }) {
  const insertStmt = memoryDb.prepare(`
    INSERT INTO wiki_links (id, source_id, target_id, source_type, target_type, relation, project_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const outboundStmt = memoryDb.prepare(
    "SELECT id, target_id, target_type, relation, created_at FROM wiki_links WHERE source_id = ? AND project_id = ? ORDER BY created_at DESC"
  );
  const inboundStmt = memoryDb.prepare(
    "SELECT id, source_id, source_type, relation, created_at FROM wiki_links WHERE target_id = ? AND project_id = ? ORDER BY created_at DESC"
  );

  return [
    {
      name: "wiki.link",
      description: "Create a cross-reference link between two wiki entries (memory, source, or kb).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_id: { type: "string" },
          target_id: { type: "string" },
          source_type: { type: "string", enum: ["memory", "source", "kb"] },
          target_type: { type: "string", enum: ["memory", "source", "kb"] },
          relation: { type: "string", description: "e.g. 'references', 'contradicts', 'extends', 'summarizes'" },
          project_id: { type: "string" },
          project_root: { type: "string" }
        },
        required: ["source_id", "target_id", "source_type", "target_type"]
      },
      handler: async (args) => {
        const project_id = resolveProjectId(args);
        if (!project_id) throw Object.assign(new Error("project_id or project_root is required"), { code: -32602 });

        const { source_id, target_id, source_type, target_type, relation } = args;
        if (!VALID_TYPES.has(source_type)) throw Object.assign(new Error("source_type must be memory, source, or kb"), { code: -32602 });
        if (!VALID_TYPES.has(target_type)) throw Object.assign(new Error("target_type must be memory, source, or kb"), { code: -32602 });
        if (source_id === target_id) throw Object.assign(new Error("source_id and target_id must be different"), { code: -32602 });

        const id = crypto.randomUUID();
        const created_at = new Date().toISOString();
        insertStmt.run(id, source_id, target_id, source_type, target_type, relation ?? null, project_id, created_at);

        return { id, source_id, target_id, source_type, target_type, relation: relation ?? null, project_id, created_at };
      }
    },
    {
      name: "wiki.links",
      description: "List all cross-reference links for a given entry (inbound, outbound, or both).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          entry_id: { type: "string" },
          project_id: { type: "string" },
          project_root: { type: "string" },
          direction: { type: "string", enum: ["in", "out", "both"], default: "both" }
        },
        required: ["entry_id"]
      },
      handler: async (args) => {
        const project_id = resolveProjectId(args);
        if (!project_id) throw Object.assign(new Error("project_id or project_root is required"), { code: -32602 });

        const { entry_id } = args;
        const direction = args.direction ?? "both";

        const outbound = (direction === "out" || direction === "both") ? outboundStmt.all(entry_id, project_id) : [];
        const inbound = (direction === "in" || direction === "both") ? inboundStmt.all(entry_id, project_id) : [];

        return { entry_id, outbound, inbound };
      }
    }
  ];
}
