
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
      WHERE kb_fts MATCH ?
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
      WHERE kb_fts MATCH ? AND m.project_id = ?
      ORDER BY bm25(kb_fts)
      LIMIT ?
    `
  );
  
  const allStmt = kbDb.prepare(
    `
      SELECT rowid AS id, title, content, source
      FROM kb_fts
      ORDER BY rowid DESC
      LIMIT ?
    `
  );

  const allScopedStmt = kbDb.prepare(
    `
      SELECT f.rowid AS id, f.title, f.content, f.source
      FROM kb_fts f
      JOIN kb_meta m ON m.rowid = f.rowid
      WHERE m.project_id = ?
      ORDER BY f.rowid DESC
      LIMIT ?
    `
  );

  const latestStmt = kbDb.prepare(
    `
      SELECT rowid AS id, title, content, source
      FROM kb_fts
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
      description: "Add a document to the knowledge base.",
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
        "Search the knowledge base using SQLite FTS5 by default; optionally uses Qdrant vector similarity when a vector is provided.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 5 },
          project_id: { type: "string", description: "Optional project ID to search only project-scoped documents" },
          vector: { type: "array", items: { type: "number" } },
          qdrantUrl: { type: "string" },
          qdrantCollection: { type: "string" }
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
        expectString(query, "query");
        expectOptionalVector(vector, "vector");
        if (project_id !== null) expectString(project_id, "project_id");
        expectOptionalUrl(qdrantUrlArg, "qdrantUrl");
        expectOptionalString(qdrantCollectionArg, "qdrantCollection");

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
            out.push({
              id,
              title: payload?.title ?? byId.get(key)?.title,
              content: payload?.content ?? byId.get(key)?.content,
              source: (payload?.source ?? byId.get(key)?.source) ?? undefined,
              score: scores.get(key)
            });
          }
          return out;
        }

        const trimmed = query.trim();
        const rows =
          trimmed.length === 0
            ? (project_id ? allScopedStmt.all(project_id, limit) : allStmt.all(limit))
            : (project_id ? searchScopedStmt.all(toFtsPhrase(trimmed), project_id, limit) : searchStmt.all(toFtsPhrase(trimmed), limit));

        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          source: r.source ?? undefined
        }));
      }
    }
  ];
}
