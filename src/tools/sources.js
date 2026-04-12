import crypto from "node:crypto";
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

function slugify(filename) {
  return path.basename(filename, path.extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

async function extractContent(filename, rawContent, fileType) {
  if (fileType === "pdf") {
    // rawContent must be base64-encoded PDF bytes
    const { default: pdfParse } = await import("pdf-parse");
    const buffer = Buffer.from(rawContent, "base64");
    const result = await pdfParse(buffer);
    return result.text;
  }
  if (fileType === "csv") {
    const { parse } = await import("csv-parse/sync");
    const rows = parse(rawContent, { columns: true, skip_empty_lines: true, relax_quotes: true });
    return rows.map((r) =>
      Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(" | ")
    ).join("\n");
  }
  return rawContent;
}

export function createSourceTools({ kbDb }) {
  const insertStmt = kbDb.prepare(`
    INSERT INTO sources (id, slug, filename, file_type, content, file_path, project_id, ingested_at, size_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFtsStmt = kbDb.prepare("INSERT INTO sources_fts (rowid, slug, content) VALUES (?, ?, ?)");

  const insertTx = kbDb.transaction((id, slug, filename, fileType, content, filePath, projectId, ingestedAt, sizeBytes) => {
    insertStmt.run(id, slug, filename, fileType, content, filePath ?? null, projectId, ingestedAt, sizeBytes);
    const info = kbDb.prepare("SELECT rowid FROM sources WHERE id = ?").get(id);
    insertFtsStmt.run(info.rowid, slug, content);
  });

  return [
    {
      name: "source.ingest",
      description: "Ingest one or more documents (md, txt, csv, pdf) into the raw sources layer.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          files: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                filename: { type: "string" },
                content: { type: "string", description: "Text content, or base64-encoded bytes for PDF" },
                file_path: { type: "string", description: "Optional original file path to read from disk" }
              },
              required: ["filename"]
            },
            minItems: 1
          },
          project_id: { type: "string" },
          project_root: { type: "string" }
        },
        required: ["files"]
      },
      handler: async (args) => {
        const project_id = resolveProjectId(args);
        if (!project_id) throw Object.assign(new Error("project_id or project_root is required"), { code: -32602 });

        const ingested = [];
        const errors = [];

        for (const file of args.files) {
          try {
            const { filename, file_path } = file;
            const ext = path.extname(filename).toLowerCase().slice(1) || "txt";
            const fileType = ["pdf", "csv", "md", "txt", "json", "yaml", "yml"].includes(ext) ? ext : "txt";

            let rawContent = file.content;
            if (!rawContent && file_path) {
              if (fileType === "pdf") {
                rawContent = fs.readFileSync(file_path).toString("base64");
              } else {
                rawContent = fs.readFileSync(file_path, "utf8");
              }
            }
            if (!rawContent) throw new Error("No content provided and no file_path to read from");

            const content = await extractContent(filename, rawContent, fileType);
            const id = crypto.randomUUID();
            const slug = slugify(filename);
            const ingestedAt = new Date().toISOString();
            const sizeBytes = Buffer.byteLength(content, "utf8");

            insertTx(id, slug, filename, fileType, content, file_path ?? null, project_id, ingestedAt, sizeBytes);
            ingested.push({ id, slug, filename, file_type: fileType, size_bytes: sizeBytes, ingested_at: ingestedAt });
          } catch (err) {
            errors.push({ filename: file.filename, error: err.message });
          }
        }

        return { ingested, errors };
      }
    },
    {
      name: "source.list",
      description: "List all raw sources ingested for a project.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
          project_root: { type: "string" },
          limit: { type: "number", default: 50 },
          offset: { type: "number", default: 0 }
        }
      },
      handler: async (args) => {
        const project_id = resolveProjectId(args);
        if (!project_id) throw Object.assign(new Error("project_id or project_root is required"), { code: -32602 });

        const limit = Math.min(Math.max(1, Math.trunc(args?.limit ?? 50)), 500);
        const offset = Math.max(0, Math.trunc(args?.offset ?? 0));

        const rows = kbDb.prepare(
          "SELECT id, slug, filename, file_type, file_path, ingested_at, size_bytes FROM sources WHERE project_id = ? ORDER BY ingested_at DESC LIMIT ? OFFSET ?"
        ).all(project_id, limit, offset);

        const { total } = kbDb.prepare("SELECT count(*) as total FROM sources WHERE project_id = ?").get(project_id);

        return { sources: rows, total_count: total, offset, has_more: offset + rows.length < total };
      }
    },
    {
      name: "source.search",
      description: "Full-text search over ingested raw sources.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          project_id: { type: "string" },
          project_root: { type: "string" },
          limit: { type: "number", default: 10 }
        },
        required: ["query"]
      },
      handler: async (args) => {
        const project_id = resolveProjectId(args);
        if (!project_id) throw Object.assign(new Error("project_id or project_root is required"), { code: -32602 });

        const limit = Math.min(Math.max(1, Math.trunc(args?.limit ?? 10)), 100);
        const query = args.query.trim();

        if (!query) {
          return kbDb.prepare(
            "SELECT id, slug, filename, file_type, ingested_at, size_bytes FROM sources WHERE project_id = ? ORDER BY ingested_at DESC LIMIT ?"
          ).all(project_id, limit);
        }

        const escaped = query.replaceAll('"', '""');
        const rows = kbDb.prepare(`
          SELECT s.id, s.slug, s.filename, s.file_type, s.ingested_at, s.size_bytes,
                 snippet(sources_fts, 1, '[', ']', '...', 20) as excerpt
          FROM sources_fts f
          JOIN sources s ON s.rowid = f.rowid
          WHERE sources_fts MATCH ? AND s.project_id = ?
          ORDER BY bm25(sources_fts)
          LIMIT ?
        `).all(`"${escaped}"`, project_id, limit);

        return rows;
      }
    }
  ];
}
