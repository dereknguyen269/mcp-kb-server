import crypto from "node:crypto";
import { detectProjectId, validateProjectRoot } from "../utils/projectId.js";
import { getCachedQuery, setCachedQuery, createQueryKey, clearQueryCache } from "../utils/performance.js";
import metrics from "../utils/metrics.js";

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

function expectStringArrayOptional(value, name) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    const error = new Error(`${name} must be an array of strings`);
    error.code = -32602;
    throw error;
  }
  for (const item of value) {
    if (typeof item !== "string") {
      const error = new Error(`${name} must be an array of strings`);
      error.code = -32602;
      throw error;
    }
  }
}

function resolveProjectId(args) {
  let project_id = args?.project_id;
  const project_root = args?.project_root;

  if (!project_id && project_root) {
    const detection = detectProjectId(project_root, { explicitProjectId: project_id });
    project_id = detection.project_id;
    if (detection.explicit_mismatch) {
      console.warn(
        `[SAFETY WARNING] Explicit project_id "${detection.explicit_project_id}" ` +
        `differs from detected "${detection.project_id}" (${detection.detection_method}). ` +
        `Using explicit project_id.`
      );
    }
  } else if (project_root) {
    validateProjectRoot(project_root);
  }

  return project_id;
}

function escapeLike(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function toFtsPhrase(query) {
  const escaped = query.replaceAll('"', '""');
  return `"${escaped}"`;
}

export function createMemoryTools({ memoryDb }) {
  const DEFAULT_SCOPE = "default";

  // --- Prepared statements (created once, reused) ---
  const insertStmt = memoryDb.prepare(
    "INSERT INTO memory (id, scope, content, tags, created_at, updated_at, expires_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const insertFtsStmt = memoryDb.prepare(
    "INSERT INTO memory_fts(rowid, content, tags) VALUES ((SELECT rowid FROM memory WHERE id = ?), ?, ?)"
  );

  const updateStmt = memoryDb.prepare(
    "UPDATE memory SET content = ?, tags = ?, updated_at = ?, expires_at = ? WHERE id = ? AND project_id = ?"
  );

  const updateFtsStmt = memoryDb.prepare(
    "UPDATE memory_fts SET content = ?, tags = ? WHERE rowid = (SELECT rowid FROM memory WHERE id = ?)"
  );

  const deleteStmt = memoryDb.prepare(
    "DELETE FROM memory WHERE id = ? AND project_id = ?"
  );

  const deleteFtsStmt = memoryDb.prepare(
    "DELETE FROM memory_fts WHERE rowid = ?"
  );

  const getByIdStmt = memoryDb.prepare(
    "SELECT rowid, id, scope, content, tags, created_at, updated_at, expires_at, project_id FROM memory WHERE id = ? AND project_id = ?"
  );

  // Expired entry cleanup — all prepared once
  const selectExpiredStmt = memoryDb.prepare(
    "SELECT rowid FROM memory WHERE project_id = ? AND expires_at IS NOT NULL AND expires_at <= ?"
  );
  const deleteExpiredStmt = memoryDb.prepare(
    "DELETE FROM memory WHERE project_id = ? AND expires_at IS NOT NULL AND expires_at <= ?"
  );

  // FTS5 search (P4)
  const ftsSearchStmt = memoryDb.prepare(`
    SELECT m.id, m.scope, m.content, m.tags, m.created_at, m.updated_at, m.expires_at, m.project_id
    FROM memory m
    JOIN memory_fts f ON f.rowid = m.rowid
    WHERE m.scope = ? AND m.project_id = ? AND memory_fts MATCH ?
    ORDER BY bm25(memory_fts)
    LIMIT ?
  `);

  // Fallback LIKE search
  const searchByQueryStmt = memoryDb.prepare(`
    SELECT id, scope, content, tags, created_at, updated_at, expires_at, project_id
    FROM memory
    WHERE scope = ? AND project_id = ?
      AND (content LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const latestStmt = memoryDb.prepare(`
    SELECT id, scope, content, tags, created_at, updated_at, expires_at, project_id
    FROM memory
    WHERE scope = ? AND project_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  // Tag-based search (P3)
  const searchByTagStmt = memoryDb.prepare(`
    SELECT id, scope, content, tags, created_at, updated_at, expires_at, project_id
    FROM memory
    WHERE project_id = ? AND tags LIKE ? ESCAPE '\\'
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const searchByTagAndScopeStmt = memoryDb.prepare(`
    SELECT id, scope, content, tags, created_at, updated_at, expires_at, project_id
    FROM memory
    WHERE scope = ? AND project_id = ? AND tags LIKE ? ESCAPE '\\'
    ORDER BY created_at DESC
    LIMIT ?
  `);

  // memory.list — paginated listing of all memories
  const countStmt = memoryDb.prepare(
    "SELECT count(*) as total FROM memory WHERE project_id = ? AND (expires_at IS NULL OR expires_at > ?)"
  );
  const countByScopeStmt = memoryDb.prepare(
    "SELECT count(*) as total FROM memory WHERE project_id = ? AND scope = ? AND (expires_at IS NULL OR expires_at > ?)"
  );
  const listAllStmt = memoryDb.prepare(`
    SELECT id, scope, content, tags, created_at, updated_at, expires_at, project_id
    FROM memory
    WHERE project_id = ? AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  const listByScopeStmt = memoryDb.prepare(`
    SELECT id, scope, content, tags, created_at, updated_at, expires_at, project_id
    FROM memory
    WHERE project_id = ? AND scope = ? AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);

  // --- Helpers ---

  function formatRow(r) {
    return {
      id: r.id,
      scope: r.scope,
      project_id: r.project_id,
      content: r.content,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      created_at: r.created_at,
      updated_at: r.updated_at || undefined,
      expires_at: r.expires_at || undefined
    };
  }

  // Throttled purge: at most once per 60 seconds per project
  const lastPurge = new Map();
  const PURGE_INTERVAL_MS = 60_000;

  function purgeExpired(project_id) {
    const now = Date.now();
    const last = lastPurge.get(project_id) || 0;
    if (now - last < PURGE_INTERVAL_MS) return;
    lastPurge.set(project_id, now);

    const nowIso = new Date(now).toISOString();
    const expired = selectExpiredStmt.all(project_id, nowIso);
    for (const row of expired) {
      try { deleteFtsStmt.run(row.rowid); } catch { /* best-effort */ }
    }
    if (expired.length > 0) {
      deleteExpiredStmt.run(project_id, nowIso);
      clearQueryCache();
    }
  }

  function ftsSearch(scope, project_id, query, limit) {
    try {
      return ftsSearchStmt.all(scope, project_id, toFtsPhrase(query), limit);
    } catch {
      // FTS table might not be synced, fall back to LIKE
      const pattern = `%${escapeLike(query)}%`;
      return searchByQueryStmt.all(scope, project_id, pattern, pattern, limit);
    }
  }

  return [
    // --- memory.store ---
    {
      name: "memory.store",
      description: "Store long-term memory. Stores content exactly as provided.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string", description: "Project identifier (auto-detected from project_root if not provided)" },
          project_root: { type: "string", description: "Project root directory (required for auto-detection if project_id not provided)" },
          scope: { type: "string" },
          content: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          expires_at: { type: "string", description: "ISO 8601 expiry timestamp. Memory auto-expires after this time." }
        },
        required: ["content"]
      },
      handler: (args) => {
        const project_id = resolveProjectId(args);
        const scope = args?.scope;
        const content = args?.content;
        const tags = args?.tags;
        const expires_at = args?.expires_at ?? null;

        expectString(project_id, "project_id");
        expectOptionalString(scope, "scope");
        expectString(content, "content");
        expectStringArrayOptional(tags, "tags");
        if (expires_at !== null) expectString(expires_at, "expires_at");

        const id = crypto.randomUUID();
        const created_at = new Date().toISOString();
        const tagsJson = tags === undefined ? null : JSON.stringify(tags);
        const resolvedScope = (scope ?? DEFAULT_SCOPE).trim() || DEFAULT_SCOPE;

        insertStmt.run(id, resolvedScope, content, tagsJson, created_at, null, expires_at, project_id);
        try { insertFtsStmt.run(id, content, tagsJson || ""); } catch { /* FTS sync best-effort */ }

        // Invalidate cache — new data means cached searches are stale
        clearQueryCache();

        return { id, scope: resolvedScope, project_id, created_at, expires_at: expires_at || undefined };
      }
    },

    // --- memory.search ---
    {
      name: "memory.search",
      description: "Search long-term memory by substring match over stored content and tags.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string", description: "Project identifier (auto-detected from project_root if not provided)" },
          project_root: { type: "string", description: "Project root directory (required for auto-detection if project_id not provided)" },
          scope: { type: "string" },
          query: { type: "string" },
          tag: { type: "string", description: "Filter by tag name. Returns only entries containing this tag." },
          limit: { type: "number", default: 5 },
          use_fts: { type: "boolean", default: false, description: "Use FTS5 full-text search with BM25 ranking instead of substring match." }
        },
        required: ["query"]
      },
      handler: (args) => {
        const project_id = resolveProjectId(args);
        const scope = args?.scope;
        const query = args?.query;
        const tag = args?.tag;
        const limit = asLimit(args?.limit, 5);
        const useFts = args?.use_fts || false;

        expectString(project_id, "project_id");
        expectOptionalString(scope, "scope");
        expectString(query, "query");
        expectOptionalString(tag, "tag");

        const resolvedScope = (scope ?? DEFAULT_SCOPE).trim() || DEFAULT_SCOPE;
        const trimmed = query.trim();

        // Purge expired entries (throttled — at most once per 60s per project)
        purgeExpired(project_id);

        // Build cache key that covers all search dimensions
        const cacheKey = createQueryKey("memory_search", { project_id, scope: resolvedScope, query: trimmed, tag, limit, useFts });
        const cached = getCachedQuery(cacheKey);
        if (cached) {
          metrics.recordCacheHit();
          return cached.result;
        }
        metrics.recordCacheMiss();

        let rows;

        // Tag-only search (P3)
        if (tag && trimmed.length === 0) {
          const tagPattern = `%"${escapeLike(tag)}"%`;
          rows = scope
            ? searchByTagAndScopeStmt.all(resolvedScope, project_id, tagPattern, limit)
            : searchByTagStmt.all(project_id, tagPattern, limit);
          const result = rows.map(formatRow);
          setCachedQuery(cacheKey, result, 300000);
          return result;
        }

        if (trimmed.length === 0) {
          rows = latestStmt.all(resolvedScope, project_id, limit);
        } else if (useFts) {
          rows = ftsSearch(resolvedScope, project_id, trimmed, limit);
        } else {
          const pattern = `%${escapeLike(trimmed)}%`;
          rows = searchByQueryStmt.all(resolvedScope, project_id, pattern, pattern, limit);
        }

        // Post-filter by tag if both query and tag provided
        let result = rows.map(formatRow);
        if (tag) {
          result = result.filter((r) => Array.isArray(r.tags) && r.tags.includes(tag));
        }

        setCachedQuery(cacheKey, result, 300000);
        return result;
      }
    },

    // --- memory.list — get all memories with pagination ---
    {
      name: "memory.list",
      description: "List all memory entries for a project with pagination. Use when you need to see all memories, not just search results. Returns total_count so you know how many exist.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string", description: "Project identifier (auto-detected from project_root if not provided)" },
          project_root: { type: "string", description: "Project root directory" },
          scope: { type: "string", description: "Filter by scope. Omit to list across all scopes." },
          limit: { type: "number", default: 50, description: "Page size (1-500, default 50)" },
          offset: { type: "number", default: 0, description: "Offset for pagination (default 0)" }
        },
        required: []
      },
      handler: (args) => {
        const project_id = resolveProjectId(args);
        const scope = args?.scope;
        const rawLimit = args?.limit ?? 50;
        const offset = Math.max(0, Math.trunc(args?.offset ?? 0));

        expectString(project_id, "project_id");
        expectOptionalString(scope, "scope");

        // Allow up to 500 per page for list (vs 100 for search)
        const limit = Math.min(Math.max(1, Math.trunc(rawLimit)), 500);

        purgeExpired(project_id);

        const now = new Date().toISOString();
        let rows;
        let total;

        if (scope) {
          const resolvedScope = scope.trim() || DEFAULT_SCOPE;
          total = countByScopeStmt.get(project_id, resolvedScope, now).total;
          rows = listByScopeStmt.all(project_id, resolvedScope, now, limit, offset);
        } else {
          total = countStmt.get(project_id, now).total;
          rows = listAllStmt.all(project_id, now, limit, offset);
        }

        return {
          total_count: total,
          offset,
          limit,
          has_more: offset + rows.length < total,
          entries: rows.map(formatRow)
        };
      }
    },

    // --- memory.delete (P1) ---
    {
      name: "memory.delete",
      description: "Delete a memory entry by ID. Use to remove outdated or incorrect information.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Memory entry ID to delete" },
          project_id: { type: "string", description: "Project identifier (auto-detected from project_root if not provided)" },
          project_root: { type: "string", description: "Project root directory" }
        },
        required: ["id"]
      },
      handler: (args) => {
        const project_id = resolveProjectId(args);
        const id = args?.id;

        expectString(project_id, "project_id");
        expectString(id, "id");

        const existing = getByIdStmt.get(id, project_id);
        if (!existing) {
          return { deleted: false, message: `Memory entry not found: ${id}` };
        }

        try { deleteFtsStmt.run(existing.rowid); } catch { /* best-effort */ }
        const info = deleteStmt.run(id, project_id);

        if (info.changes > 0) clearQueryCache();

        return { deleted: info.changes > 0, id, project_id };
      }
    },

    // --- memory.update (P2) ---
    {
      name: "memory.update",
      description: "Update an existing memory entry. Replaces content and/or tags. Use to correct or refine stored knowledge.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Memory entry ID to update" },
          project_id: { type: "string", description: "Project identifier (auto-detected from project_root if not provided)" },
          project_root: { type: "string", description: "Project root directory" },
          content: { type: "string", description: "New content (replaces existing)" },
          tags: { type: "array", items: { type: "string" }, description: "New tags (replaces existing)" },
          expires_at: { type: "string", description: "New expiry timestamp (ISO 8601). Set to empty string to remove expiry." }
        },
        required: ["id"]
      },
      handler: (args) => {
        const project_id = resolveProjectId(args);
        const id = args?.id;

        expectString(project_id, "project_id");
        expectString(id, "id");

        const existing = getByIdStmt.get(id, project_id);
        if (!existing) {
          const error = new Error(`Memory entry not found: ${id}`);
          error.code = -32602;
          throw error;
        }

        const newContent = args?.content !== undefined ? args.content : existing.content;
        const newTags = args?.tags !== undefined ? JSON.stringify(args.tags) : existing.tags;
        const newExpiresAt = args?.expires_at !== undefined
          ? (args.expires_at === "" ? null : args.expires_at)
          : existing.expires_at;
        const updated_at = new Date().toISOString();

        expectString(newContent, "content");
        if (args?.tags !== undefined) expectStringArrayOptional(args.tags, "tags");

        updateStmt.run(newContent, newTags, updated_at, newExpiresAt, id, project_id);
        try { updateFtsStmt.run(newContent, newTags || "", id); } catch { /* best-effort */ }

        clearQueryCache();

        return {
          id,
          project_id,
          updated_at,
          content: newContent,
          tags: newTags ? JSON.parse(newTags) : undefined,
          expires_at: newExpiresAt || undefined
        };
      }
    }
  ];
}
