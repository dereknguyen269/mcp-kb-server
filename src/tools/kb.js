
import fs from "node:fs";
import path from "node:path";
import { detectProjectId, validateProjectRoot } from "../utils/projectId.js";
import { expandGlob, readTextFileSafe, SKIP_DIR_NAMES } from "../utils/fileDiscovery.js";

function asLimit(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isFinite(value)) return defaultValue;
  const n = Math.trunc(value);
  if (n <= 0) return defaultValue;
  return Math.min(n, 100);
}

function expectString(value, name) {
  if (typeof value !== "string") {
    const error = new Error(`${name} must be a string`);
    error.code = -32602;
    throw error;
  }
}

function expectOptionalString(value, name) {
  if (value === undefined) return;
  if (typeof value !== "string") {
    const error = new Error(`${name} must be a string`);
    error.code = -32602;
    throw error;
  }
}

function expectOptionalUrl(value, name) {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    const error = new Error(`${name} must be a non-empty string`);
    error.code = -32602;
    throw error;
  }
  try {
    new URL(value);
  } catch {
    const error = new Error(`${name} must be a valid URL`);
    error.code = -32602;
    throw error;
  }
}

function expectOptionalVector(value, name) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    const error = new Error(`${name} must be a non-empty array of numbers`);
    error.code = -32602;
    throw error;
  }
  for (const n of value) {
    if (typeof n !== "number" || !Number.isFinite(n)) {
      const error = new Error(`${name} must be a non-empty array of numbers`);
      error.code = -32602;
      throw error;
    }
  }
}

function toFtsPhrase(query) {
  const escaped = query.replaceAll('"', '""');
  return `"${escaped}"`;
}

function getQdrantConfig(args) {
  const qdrantUrl = args?.qdrantUrl ?? process.env.QDRANT_URL ?? "http://localhost:6333";
  const qdrantCollection = args?.qdrantCollection ?? process.env.QDRANT_COLLECTION ?? "kb";
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  return { qdrantUrl, qdrantCollection, qdrantApiKey };
}

async function qdrantRequest({ qdrantUrl, qdrantApiKey, method, path, body }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = { Accept: "application/json" };
    if (qdrantApiKey) headers["api-key"] = qdrantApiKey;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(new URL(path, qdrantUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const error = new Error(`Qdrant error (${res.status}): ${text || res.statusText}`);
      error.code = -32000;
      throw error;
    }

    const json = await res.json().catch(() => null);
    return json;
  } catch (err) {
    if (err?.name === "AbortError") {
      const error = new Error("Qdrant request timed out");
      error.code = -32000;
      throw error;
    }
    const error = err instanceof Error ? err : new Error("Qdrant request failed");
    if (typeof error.code !== "number") error.code = -32000;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureQdrantCollection({ qdrantUrl, qdrantApiKey, qdrantCollection, vectorSize }) {
  try {
    await qdrantRequest({
      qdrantUrl,
      qdrantApiKey,
      method: "GET",
      path: `/collections/${encodeURIComponent(qdrantCollection)}`
    });
    return;
  } catch (err) {
    const msg = typeof err?.message === "string" ? err.message : "";
    if (!msg.includes("(404)")) throw err;
  }

  await qdrantRequest({
    qdrantUrl,
    qdrantApiKey,
    method: "PUT",
    path: `/collections/${encodeURIComponent(qdrantCollection)}`,
    body: {
      vectors: {
        size: vectorSize,
        distance: "Cosine"
      }
    }
  });
}

export function createKbTools({ kbDb }) {
  const insertStmt = kbDb.prepare("INSERT INTO kb_fts (title, content, source) VALUES (?, ?, ?)");
  const insertMetaStmt = kbDb.prepare("INSERT OR REPLACE INTO kb_meta (rowid, project_id) VALUES (?, ?)");
  const deleteStmt = kbDb.prepare("DELETE FROM kb_fts WHERE rowid = ?");
  const deleteMetaStmt = kbDb.prepare("DELETE FROM kb_meta WHERE rowid = ?");
  const getByIdStmt = kbDb.prepare(
    "SELECT f.rowid AS id, f.title, f.content, f.source FROM kb_fts f WHERE f.rowid = ?"
  );
  const getByIdScopedStmt = kbDb.prepare(
    "SELECT f.rowid AS id, f.title, f.content, f.source FROM kb_fts f JOIN kb_meta m ON m.rowid = f.rowid WHERE f.rowid = ? AND m.project_id = ?"
  );
  const updateStmt = kbDb.prepare(
    "UPDATE kb_fts SET title = ?, content = ?, source = ? WHERE rowid = ?"
  );
  const getIndexStmt = kbDb.prepare(
    `SELECT f.rowid AS id, f.title, f.content, f.source
     FROM kb_fts f JOIN kb_meta m ON m.rowid = f.rowid
     WHERE f.source = '_index' AND m.project_id = ?
     LIMIT 1`
  );

  // Atomic insert with optional project scoping
  const insertTx = kbDb.transaction((title, content, source, project_id) => {
    const info = insertStmt.run(title, content, source);
    const id = info.lastInsertRowid;
    if (project_id) {
      insertMetaStmt.run(id, project_id);
    }
    return id;
  });

  // Prepared statements for better performance
  const searchStmt = kbDb.prepare(
    `
      SELECT rowid AS id, title, content, source
      FROM kb_fts
      WHERE kb_fts MATCH ? AND source IS NOT '_index'
      ORDER BY bm25(kb_fts)
      LIMIT ?
    `
  );

  // Project-scoped search: FTS match + join on meta
  const searchScopedStmt = kbDb.prepare(
    `
      SELECT f.rowid AS id, f.title, f.content, f.source
      FROM kb_fts f
      JOIN kb_meta m ON m.rowid = f.rowid
      WHERE kb_fts MATCH ? AND m.project_id = ? AND f.source IS NOT '_index'
      ORDER BY bm25(kb_fts)
      LIMIT ?
    `
  );

  const allStmt = kbDb.prepare(
    `
      SELECT rowid AS id, title, content, source
      FROM kb_fts
      WHERE source IS NOT '_index'
      ORDER BY rowid DESC
      LIMIT ?
    `
  );

  const allScopedStmt = kbDb.prepare(
    `
      SELECT f.rowid AS id, f.title, f.content, f.source
      FROM kb_fts f
      JOIN kb_meta m ON m.rowid = f.rowid
      WHERE m.project_id = ? AND f.source IS NOT '_index'
      ORDER BY f.rowid DESC
      LIMIT ?
    `
  );

  const latestStmt = kbDb.prepare(
    `
      SELECT rowid AS id, title, content, source
      FROM kb_fts
      WHERE source IS NOT '_index'
      ORDER BY rowid DESC
      LIMIT ?
    `
  );

  function getByIds(ids) {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const stmt = kbDb.prepare(
      `SELECT rowid AS id, title, content, source FROM kb_fts WHERE rowid IN (${placeholders})`
    );
    return stmt.all(...ids);
  }

  return [
    {
      name: "kb.add",
      description: "Add a document to the knowledge base. After adding, regenerate the index page with kb.index.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          source: { type: "string" },
          project_id: { type: "string", description: "Optional project ID to scope this document to a specific project" },
          vector: { type: "array", items: { type: "number" } },
          qdrantUrl: { type: "string" },
          qdrantCollection: { type: "string" }
        },
        required: ["title", "content"]
      },
      handler: async (args) => {
        const title = args?.title;
        const content = args?.content;
        const source = args?.source;
        const vector = args?.vector;
        const project_id = args?.project_id ?? null;
        const qdrantUrlArg = args?.qdrantUrl;
        const qdrantCollectionArg = args?.qdrantCollection;

        expectString(title, "title");
        expectString(content, "content");
        expectOptionalString(source, "source");
        expectOptionalVector(vector, "vector");
        if (project_id !== null) expectString(project_id, "project_id");
        expectOptionalUrl(qdrantUrlArg, "qdrantUrl");
        expectOptionalString(qdrantCollectionArg, "qdrantCollection");

        const id = insertTx(title, content, source ?? null, project_id);

        if (vector !== undefined) {
          const { qdrantUrl, qdrantCollection, qdrantApiKey } = getQdrantConfig({
            qdrantUrl: qdrantUrlArg,
            qdrantCollection: qdrantCollectionArg
          });

          try {
            await ensureQdrantCollection({
              qdrantUrl,
              qdrantApiKey,
              qdrantCollection,
              vectorSize: vector.length
            });

            await qdrantRequest({
              qdrantUrl,
              qdrantApiKey,
              method: "PUT",
              path: `/collections/${encodeURIComponent(qdrantCollection)}/points?wait=true`,
              body: {
                points: [
                  {
                    id,
                    vector,
                    payload: {
                      id,
                      title,
                      content,
                      source: source ?? null
                    }
                  }
                ]
              }
            });
          } catch (err) {
            // Rollback both meta and FTS in a transaction to avoid orphans
            const rollbackTx = kbDb.transaction(() => {
              deleteMetaStmt.run(id);
              deleteStmt.run(id);
            });
            rollbackTx();
            throw err;
          }
        }

        return { id };
      }
    },
    {
      name: "kb.search",
      description:
        "Search the knowledge base using SQLite FTS5 by default; optionally uses Qdrant vector similarity when a vector is provided. Tip: call kb.index first to read the table of contents before searching blind.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 5 },
          project_id: { type: "string", description: "Optional project ID to search only project-scoped documents" },
          vector: { type: "array", items: { type: "number" } },
          qdrantUrl: { type: "string" },
          qdrantCollection: { type: "string" },
          max_content_length: { type: "number", description: "Truncate content to this many characters. Truncated results include truncated:true. Omit to return full content." }
        },
        required: ["query"]
      },
      handler: async (args) => {
        const query = args?.query;
        const limit = asLimit(args?.limit, 5);
        const vector = args?.vector;
        const project_id = args?.project_id ?? null;
        const qdrantUrlArg = args?.qdrantUrl;
        const qdrantCollectionArg = args?.qdrantCollection;
        const maxContentLength = (typeof args?.max_content_length === "number" && args.max_content_length > 0)
          ? Math.trunc(args.max_content_length)
          : null;
        expectString(query, "query");
        expectOptionalVector(vector, "vector");
        if (project_id !== null) expectString(project_id, "project_id");
        expectOptionalUrl(qdrantUrlArg, "qdrantUrl");
        expectOptionalString(qdrantCollectionArg, "qdrantCollection");

        function applyContentLimit(item) {
          if (maxContentLength === null || typeof item.content !== "string" || item.content.length <= maxContentLength) {
            return item;
          }
          return { ...item, content: item.content.slice(0, maxContentLength), truncated: true };
        }

        if (vector !== undefined) {
          const { qdrantUrl, qdrantCollection, qdrantApiKey } = getQdrantConfig({
            qdrantUrl: qdrantUrlArg,
            qdrantCollection: qdrantCollectionArg
          });

          const res = await qdrantRequest({
            qdrantUrl,
            qdrantApiKey,
            method: "POST",
            path: `/collections/${encodeURIComponent(qdrantCollection)}/points/search`,
            body: { vector, limit, with_payload: true }
          });

          const result = Array.isArray(res?.result) ? res.result : [];
          const missingIds = [];
          const scores = new Map();

          for (const item of result) {
            const id = item?.id;
            if (typeof id !== "number" && typeof id !== "string") continue;
            const score = typeof item?.score === "number" ? item.score : undefined;
            if (score !== undefined) scores.set(String(id), score);
            const payload = item?.payload;
            if (!payload || typeof payload !== "object") missingIds.push(id);
          }

          const fetched = missingIds.length
            ? getByIds(missingIds.filter((x) => typeof x === "number"))
            : [];
          const byId = new Map();
          for (const r of fetched) byId.set(String(r.id), r);

          const out = [];
          for (const item of result) {
            const id = item?.id;
            if (typeof id !== "number" && typeof id !== "string") continue;
            const key = String(id);
            const payload = item?.payload;
            out.push(applyContentLimit({
              id,
              title: payload?.title ?? byId.get(key)?.title,
              content: payload?.content ?? byId.get(key)?.content,
              source: (payload?.source ?? byId.get(key)?.source) ?? undefined,
              score: scores.get(key)
            }));
          }
          return out;
        }

        const trimmed = query.trim();
        const rows =
          trimmed.length === 0
            ? (project_id ? allScopedStmt.all(project_id, limit) : allStmt.all(limit))
            : (project_id ? searchScopedStmt.all(toFtsPhrase(trimmed), project_id, limit) : searchStmt.all(toFtsPhrase(trimmed), limit));

        return rows.map((r) => applyContentLimit({
          id: r.id,
          title: r.title,
          content: r.content,
          source: r.source ?? undefined
        }));
      }
    },
    {
      name: "kb.init",
      description: "Scan a project directory for markdown and text files and bulk-import them into the knowledge base. Skips files already present (matched by source path). Returns a summary of what was added and skipped. After running, follow the workflow in .kiro/steering/kb-ingest.md for each added file to extract entities, create cross-references, and update the index and changelog.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_root: { type: "string", description: "Absolute path to the project root to scan" },
          project_id: { type: "string", description: "Project identifier (auto-detected from project_root if omitted)" },
          patterns: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns relative to project_root to include (default: [\"**/*.md\", \"**/*.txt\"])"
          },
          skip_patterns: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns to exclude (default: node_modules, .git, dist, build)"
          },
          overwrite: { type: "boolean", description: "Re-import files that already exist in the KB (default: false)" }
        },
        required: ["project_root"]
      },
      async handler(args) {
        const projectRoot = validateProjectRoot(args.project_root);
        const detection = detectProjectId(projectRoot, { explicitProjectId: args.project_id });
        const projectId = detection.project_id;
        const patterns = Array.isArray(args.patterns) && args.patterns.length
          ? args.patterns
          : ["**/*.md", "**/*.txt"];
        const overwrite = args.overwrite === true;

        // Collect all matching files
        const seen = new Set();
        const candidates = [];
        for (const pattern of patterns) {
          const matches = expandGlob(projectRoot, pattern);
          for (const m of matches) {
            if (seen.has(m.abs)) continue;
            seen.add(m.abs);
            // Skip common noise dirs even if glob matched
            const parts = m.rel.split("/");
            if (parts.some(p => SKIP_DIR_NAMES.has(p))) continue;
            candidates.push(m);
          }
        }

        // Build set of already-imported source paths for this project
        const existingSources = new Set(
          kbDb.prepare(
            "SELECT f.source FROM kb_fts f JOIN kb_meta m ON m.rowid=f.rowid WHERE m.project_id=? AND f.source IS NOT NULL AND f.source != ''"
          ).all(projectId).map(r => r.source)
        );

        const bulkInsert = kbDb.transaction((docs) => {
          for (const { title, content, source } of docs) {
            const info = insertStmt.run(title, content, source);
            insertMetaStmt.run(info.lastInsertRowid, projectId);
          }
        });

        const added = [];
        const skipped = [];

        for (const m of candidates) {
          const sourceKey = m.rel;
          if (!overwrite && existingSources.has(sourceKey)) {
            skipped.push(sourceKey);
            continue;
          }
          const content = readTextFileSafe(m.abs);
          if (content === null || content.trim().length === 0) {
            skipped.push(sourceKey + " (empty or binary)");
            continue;
          }
          // Use first heading or filename as title
          const headingMatch = content.match(/^#\s+(.+)/m);
          const title = headingMatch
            ? headingMatch[1].trim().slice(0, 200)
            : path.basename(m.abs, path.extname(m.abs));
          added.push({ title, content, source: sourceKey });
        }

        if (added.length > 0) bulkInsert(added);

        return {
          project_id: projectId,
          project_root: projectRoot,
          scanned: candidates.length,
          added: added.length,
          skipped: skipped.length,
          added_titles: added.map(d => d.title),
          skipped_paths: skipped
        };
      }
    },
    {
      name: "kb.get",
      description: "Fetch a single KB document by ID. Use after kb.search with max_content_length to retrieve the full content of a specific document.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "number", description: "KB document ID" },
          project_id: { type: "string", description: "Optional project ID to scope the lookup" }
        },
        required: ["id"]
      },
      handler: (args) => {
        const id = args?.id;
        if (typeof id !== "number" || !Number.isFinite(id)) {
          const error = new Error("id must be a number");
          error.code = -32602;
          throw error;
        }
        const project_id = args?.project_id ?? null;
        if (project_id !== null) expectString(project_id, "project_id");

        const row = project_id
          ? getByIdScopedStmt.get(id, project_id)
          : getByIdStmt.get(id);

        if (!row) {
          const error = new Error(`KB document not found: ${id}`);
          error.code = -32602;
          throw error;
        }

        return { id: row.id, title: row.title, content: row.content, source: row.source ?? undefined };
      }
    },
    {
      name: "kb.index",
      description: "Read or replace the wiki index page (source='_index'). Call with no content to fetch the current index. Call with content to atomically replace it. The index is the LLM's navigation entry point — read it before searching, regenerate it after any kb.add/update/delete.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string", description: "Project ID to scope the index" },
          content: { type: "string", description: "New index content. Omit to fetch the current index without modifying it." }
        },
        required: ["project_id"]
      },
      handler: (args) => {
        const project_id = args?.project_id;
        const content = args?.content;
        expectString(project_id, "project_id");
        if (content !== undefined) expectString(content, "content");

        const existing = getIndexStmt.get(project_id);

        // Fetch-only when no content provided
        if (content === undefined) {
          if (!existing) return { exists: false, content: null };
          return { exists: true, id: existing.id, content: existing.content };
        }

        // Upsert
        if (existing) {
          updateStmt.run("Index", content, "_index", existing.id);
          return { id: existing.id, updated: true };
        } else {
          const id = insertTx("Index", content, "_index", project_id);
          return { id, updated: false };
        }
      }
    },
    {
      name: "kb.update",
      description: "Update an existing KB document by ID. Replaces title, content, and/or source. After updating, regenerate the index page with kb.index.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "number", description: "KB document ID to update" },
          project_id: { type: "string", description: "Optional project ID to scope the lookup" },
          title: { type: "string", description: "New title (replaces existing)" },
          content: { type: "string", description: "New content (replaces existing)" },
          source: { type: "string", description: "New source URL or path (replaces existing)" }
        },
        required: ["id"]
      },
      handler: (args) => {
        const id = args?.id;
        if (typeof id !== "number" || !Number.isFinite(id)) {
          const error = new Error("id must be a number");
          error.code = -32602;
          throw error;
        }
        const project_id = args?.project_id ?? null;
        if (project_id !== null) expectString(project_id, "project_id");

        const existing = project_id
          ? getByIdScopedStmt.get(id, project_id)
          : getByIdStmt.get(id);

        if (!existing) {
          const error = new Error(`KB document not found: ${id}`);
          error.code = -32602;
          throw error;
        }

        const newTitle = args?.title !== undefined ? args.title : existing.title;
        const newContent = args?.content !== undefined ? args.content : existing.content;
        const newSource = args?.source !== undefined ? args.source : existing.source;

        expectString(newTitle, "title");
        expectString(newContent, "content");
        if (newSource !== null) expectOptionalString(newSource, "source");

        updateStmt.run(newTitle, newContent, newSource ?? null, id);

        return { id, title: newTitle, content: newContent, source: newSource ?? undefined };
      }
    },
    {
      name: "kb.delete",
      description: "Delete a KB document by ID. After deleting, regenerate the index page with kb.index.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "number", description: "KB document ID to delete" },
          project_id: { type: "string", description: "Optional project ID to scope the lookup" }
        },
        required: ["id"]
      },
      handler: (args) => {
        const id = args?.id;
        if (typeof id !== "number" || !Number.isFinite(id)) {
          const error = new Error("id must be a number");
          error.code = -32602;
          throw error;
        }
        const project_id = args?.project_id ?? null;
        if (project_id !== null) expectString(project_id, "project_id");

        const existing = project_id
          ? getByIdScopedStmt.get(id, project_id)
          : getByIdStmt.get(id);

        if (!existing) {
          return { deleted: false, message: `KB document not found: ${id}` };
        }

        const deleteTx = kbDb.transaction(() => {
          deleteMetaStmt.run(id);
          deleteStmt.run(id);
        });
        deleteTx();

        return { deleted: true, id };
      }
    }
  ];
}
