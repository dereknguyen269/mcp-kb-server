import fs from "node:fs";
import path from "node:path";
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

function slugifyTitle(title) {
  return (title || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

function parseTags(tags) {
  if (!tags) return [];
  try { return JSON.parse(tags); } catch { return []; }
}

function writeFileSafe(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function createWikiExportTool({ memoryDb, kbDb }) {
  return {
    name: "wiki.export",
    description: "Export all wiki data (raw sources, KB entries, memory) as markdown files to a directory.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        output_dir: { type: "string", description: "Directory to write markdown files into" },
        project_id: { type: "string" },
        project_root: { type: "string" },
        include_sources: { type: "boolean", default: true },
        include_memory: { type: "boolean", default: true },
        include_kb: { type: "boolean", default: true }
      },
      required: ["output_dir"]
    },
    handler: async (args) => {
      const project_id = resolveProjectId(args);
      if (!project_id) throw Object.assign(new Error("project_id or project_root is required"), { code: -32602 });

      const outputDir = path.resolve(args.output_dir);
      const includeSources = args.include_sources !== false;
      const includeMemory = args.include_memory !== false;
      const includeKb = args.include_kb !== false;

      fs.mkdirSync(outputDir, { recursive: true });

      let filesWritten = 0;
      const indexSections = [`# Wiki Export — ${project_id}\n\n_Generated: ${new Date().toISOString()}_\n`];
      const logLines = [`# Log — ${project_id}\n`];

      // --- Sources ---
      if (includeSources) {
        const sources = kbDb.prepare(
          "SELECT id, slug, filename, file_type, content, file_path, ingested_at, size_bytes FROM sources WHERE project_id = ? ORDER BY ingested_at DESC"
        ).all(project_id);

        if (sources.length > 0) {
          indexSections.push(`\n## Sources (${sources.length})\n`);
          for (const src of sources) {
            const fname = `${src.slug}-${src.id.slice(0, 8)}.md`;
            const filePath = path.join(outputDir, "sources", fname);
            const md = [
              `# ${src.filename}`,
              ``,
              `- **Type:** ${src.file_type}`,
              `- **Ingested:** ${src.ingested_at}`,
              `- **Size:** ${src.size_bytes} bytes`,
              src.file_path ? `- **Original path:** ${src.file_path}` : null,
              `- **ID:** ${src.id}`,
              ``,
              `## Content`,
              ``,
              src.content
            ].filter((l) => l !== null).join("\n");
            writeFileSafe(filePath, md);
            filesWritten++;
            indexSections.push(`- [${src.filename}](sources/${fname}) — ${src.file_type}, ${src.ingested_at.slice(0, 10)}`);
            logLines.push(`## [${src.ingested_at.slice(0, 10)}] ingest | ${src.filename}`);
          }
        }
      }

      // --- KB index page (exported separately) ---
      if (includeKb) {
        const indexRow = kbDb.prepare(`
          SELECT f.rowid as id, f.title, f.content
          FROM kb_fts f
          JOIN kb_meta m ON m.rowid = f.rowid
          WHERE m.project_id = ? AND f.source = '_index'
          LIMIT 1
        `).get(project_id);

        if (indexRow) {
          const filePath = path.join(outputDir, "kb-index.md");
          writeFileSafe(filePath, indexRow.content);
          filesWritten++;
          indexSections.push(`\n## KB Index\n`);
          indexSections.push(`- [KB Index](kb-index.md) — auto-maintained table of contents`);
        }
      }

      // --- KB entries ---
      if (includeKb) {
        const kbEntries = kbDb.prepare(`
          SELECT f.rowid as id, f.title, f.content, f.source
          FROM kb_fts f
          JOIN kb_meta m ON m.rowid = f.rowid
          WHERE m.project_id = ? AND f.source IS NOT '_index'
          ORDER BY f.rowid DESC
        `).all(project_id);

        if (kbEntries.length > 0) {
          indexSections.push(`\n## Knowledge Base (${kbEntries.length})\n`);
          for (const entry of kbEntries) {
            const slug = slugifyTitle(entry.title);
            const fname = `${slug}-${String(entry.id)}.md`;
            const filePath = path.join(outputDir, "kb", fname);
            const md = [
              `# ${entry.title}`,
              ``,
              entry.source ? `_Source: ${entry.source}_\n` : null,
              entry.content
            ].filter((l) => l !== null).join("\n");
            writeFileSafe(filePath, md);
            filesWritten++;
            indexSections.push(`- [${entry.title}](kb/${fname})${entry.source ? ` — ${entry.source}` : ""}`);
          }
        }
      }

      // --- Memory entries ---
      if (includeMemory) {
        const memEntries = memoryDb.prepare(
          "SELECT id, content, tags, scope, created_at, updated_at FROM memory WHERE project_id = ? ORDER BY created_at DESC"
        ).all(project_id);

        if (memEntries.length > 0) {
          indexSections.push(`\n## Memory (${memEntries.length})\n`);
          for (const entry of memEntries) {
            const tags = parseTags(entry.tags);
            const preview = entry.content.slice(0, 60).replace(/\n/g, " ");
            const slug = slugifyTitle(preview);
            const fname = `${slug}-${entry.id.slice(0, 8)}.md`;
            const filePath = path.join(outputDir, "memory", fname);
            const md = [
              `# Memory Entry`,
              ``,
              `- **ID:** ${entry.id}`,
              `- **Scope:** ${entry.scope}`,
              `- **Created:** ${entry.created_at}`,
              entry.updated_at ? `- **Updated:** ${entry.updated_at}` : null,
              tags.length > 0 ? `- **Tags:** ${tags.join(", ")}` : null,
              ``,
              entry.content
            ].filter((l) => l !== null).join("\n");
            writeFileSafe(filePath, md);
            filesWritten++;
            indexSections.push(`- [${preview}…](memory/${fname})${tags.length ? ` \`${tags.join("` `")}\`` : ""}`);
            logLines.push(`## [${entry.created_at.slice(0, 10)}] memory | ${preview}`);
          }
        }
      }

      // --- index.md ---
      const indexPath = path.join(outputDir, "index.md");
      writeFileSafe(indexPath, indexSections.join("\n"));
      filesWritten++;

      // --- log.md ---
      const logPath = path.join(outputDir, "log.md");
      writeFileSafe(logPath, logLines.join("\n\n") + "\n");
      filesWritten++;

      return { files_written: filesWritten, output_dir: outputDir, index_path: indexPath };
    }
  };
}
