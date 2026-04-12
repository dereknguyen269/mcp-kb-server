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

const SEMANTIC_PROMPT = `You are performing a semantic health check on a knowledge base. Analyze the kb_entries, memory_entries, and existing_links provided and identify:

1. contradictions — pairs of KB or memory entries making conflicting claims about the same topic. For each, include entry_ids (array) and description.
2. stale_claims — entries whose facts appear superseded by newer entries or sources. Include entry_id, entry_type ("kb"|"memory"), and description.
3. missing_entity_pages — concepts, systems, or people mentioned frequently across entries but with no dedicated KB page. Include concept (name) and mentioned_in (array of entry IDs).
4. missing_cross_references — pairs of entries that clearly relate to each other but have no wiki_link. Include entry_a, entry_b (IDs), and reason.

Respond with JSON only, using exactly these keys: { "contradictions": [], "stale_claims": [], "missing_entity_pages": [], "missing_cross_references": [] }.`;

export function createWikiLintTool({ memoryDb, kbDb }) {
  return {
    name: "wiki.lint",
    description: "Health-check the wiki: find orphan entries, broken links, stale sources, and missing cross-references. Use lint_mode='semantic' to get an LLM-ready payload for deeper analysis (contradictions, stale claims, missing entity pages, missing cross-references).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        project_root: { type: "string" },
        lint_mode: {
          type: "string",
          enum: ["structural", "semantic"],
          description: "structural (default): orphans, broken links, stale sources. semantic: returns gathered KB/memory data + a prompt for LLM-driven contradiction and gap analysis."
        },
        max_kb_entries: { type: "number", description: "Max KB entries to include in semantic payload (default 50, max 200)" },
        max_memory_entries: { type: "number", description: "Max memory entries to include in semantic payload (default 50, max 200)" },
        content_preview_length: { type: "number", description: "Characters of content to include per entry in semantic payload (default 500)" }
      }
    },
    handler: async (args) => {
      const project_id = resolveProjectId(args);
      if (!project_id) throw Object.assign(new Error("project_id or project_root is required"), { code: -32602 });

      const lintMode = args?.lint_mode ?? "structural";

      if (lintMode === "semantic") {
        return handleSemanticLint({ args, project_id, memoryDb, kbDb });
      }

      // 1. Orphan memory entries — no inbound or outbound links
      const orphanMemory = memoryDb.prepare(`
        SELECT id, substr(content, 1, 80) as preview, tags, created_at
        FROM memory
        WHERE project_id = ?
          AND id NOT IN (SELECT source_id FROM wiki_links WHERE project_id = ?)
          AND id NOT IN (SELECT target_id FROM wiki_links WHERE project_id = ?)
      `).all(project_id, project_id, project_id);

      // 2. Broken links — source_id or target_id no longer exists
      const allLinks = memoryDb.prepare(
        "SELECT id, source_id, source_type, target_id, target_type, relation FROM wiki_links WHERE project_id = ?"
      ).all(project_id);

      const memoryIds = new Set(
        memoryDb.prepare("SELECT id FROM memory WHERE project_id = ?").all(project_id).map((r) => r.id)
      );
      const sourceIds = new Set(
        kbDb.prepare("SELECT id FROM sources WHERE project_id = ?").all(project_id).map((r) => r.id)
      );
      const kbRowids = new Set(
        kbDb.prepare("SELECT f.rowid FROM kb_fts f JOIN kb_meta m ON m.rowid = f.rowid WHERE m.project_id = ?").all(project_id).map((r) => String(r.rowid))
      );

      function exists(id, type) {
        if (type === "memory") return memoryIds.has(id);
        if (type === "source") return sourceIds.has(id);
        if (type === "kb") return kbRowids.has(String(id));
        return false;
      }

      const brokenLinks = allLinks.filter(
        (l) => !exists(l.source_id, l.source_type) || !exists(l.target_id, l.target_type)
      ).map((l) => ({
        link_id: l.id,
        source_id: l.source_id,
        source_type: l.source_type,
        source_exists: exists(l.source_id, l.source_type),
        target_id: l.target_id,
        target_type: l.target_type,
        target_exists: exists(l.target_id, l.target_type),
        relation: l.relation
      }));

      // 3. Stale sources — older than 90 days with no linked memory entries
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const linkedSourceIds = new Set([
        ...memoryDb.prepare("SELECT source_id as id FROM wiki_links WHERE project_id = ? AND source_type = 'source'").all(project_id).map((r) => r.id),
        ...memoryDb.prepare("SELECT target_id as id FROM wiki_links WHERE project_id = ? AND target_type = 'source'").all(project_id).map((r) => r.id)
      ]);
      const allOldSources = kbDb.prepare(
        "SELECT id, slug, filename, ingested_at, size_bytes FROM sources WHERE project_id = ? AND ingested_at < ?"
      ).all(project_id, ninetyDaysAgo);
      const staleSources = allOldSources.filter((s) => !linkedSourceIds.has(s.id));

      // 4. KB entries with no links (suggested cross-refs) — exclude index entry
      const linkedKbIds = new Set([
        ...memoryDb.prepare("SELECT source_id as id FROM wiki_links WHERE project_id = ? AND source_type = 'kb'").all(project_id).map((r) => String(r.id)),
        ...memoryDb.prepare("SELECT target_id as id FROM wiki_links WHERE project_id = ? AND target_type = 'kb'").all(project_id).map((r) => String(r.id))
      ]);
      const allKbEntries = kbDb.prepare(`
        SELECT f.rowid as id, f.title, substr(f.content, 1, 80) as preview
        FROM kb_fts f
        JOIN kb_meta m ON m.rowid = f.rowid
        WHERE m.project_id = ? AND f.source != '_index'
        LIMIT 100
      `).all(project_id);
      const unlinkedKb = allKbEntries.filter((e) => !linkedKbIds.has(String(e.id))).slice(0, 20);

      // 5. Missing index page
      const indexRow = kbDb.prepare(
        `SELECT f.rowid FROM kb_fts f JOIN kb_meta m ON m.rowid = f.rowid WHERE f.source = '_index' AND m.project_id = ? LIMIT 1`
      ).get(project_id);
      const missingIndex = !indexRow;

      const issues = orphanMemory.length + brokenLinks.length + staleSources.length + (missingIndex ? 1 : 0);
      const summary = `Found ${issues} issue(s): ${orphanMemory.length} orphan memory entries, ${brokenLinks.length} broken links, ${staleSources.length} stale sources${missingIndex ? ", missing index page (run kb.index to create one)" : ""}. ${unlinkedKb.length} KB entries have no cross-references.`;

      return {
        orphan_memory: orphanMemory,
        broken_links: brokenLinks,
        stale_sources: staleSources,
        unlinked_kb: unlinkedKb,
        missing_index: missingIndex,
        summary
      };
    }
  };
}

function clamp(value, min, max, defaultValue) {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultValue;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function handleSemanticLint({ args, project_id, memoryDb, kbDb }) {
  const maxKb = clamp(args?.max_kb_entries, 1, 200, 50);
  const maxMem = clamp(args?.max_memory_entries, 1, 200, 50);
  const previewLen = clamp(args?.content_preview_length, 50, 10000, 500);

  // Gather KB entries (exclude index)
  const kbEntries = kbDb.prepare(`
    SELECT f.rowid AS id, f.title, substr(f.content, 1, ?) AS content_preview, f.source
    FROM kb_fts f
    JOIN kb_meta m ON m.rowid = f.rowid
    WHERE m.project_id = ? AND f.source IS NOT '_index'
    ORDER BY f.rowid DESC
    LIMIT ?
  `).all(previewLen, project_id, maxKb);

  // Gather memory entries
  const memoryEntries = memoryDb.prepare(`
    SELECT id, scope, substr(content, 1, ?) AS content_preview, tags, created_at, updated_at
    FROM memory
    WHERE project_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(previewLen, project_id, maxMem);

  // Gather existing wiki links
  const existingLinks = memoryDb.prepare(`
    SELECT id, source_id, source_type, target_id, target_type, relation
    FROM wiki_links
    WHERE project_id = ?
  `).all(project_id);

  // Gather source metadata (no content — just slugs/filenames for context)
  const sources = kbDb.prepare(`
    SELECT id, slug, filename, file_type, ingested_at
    FROM sources
    WHERE project_id = ?
    ORDER BY ingested_at DESC
    LIMIT 100
  `).all(project_id);

  const totalEntries = kbEntries.length + memoryEntries.length;

  return {
    lint_mode: "semantic",
    project_id,
    stats: {
      kb_entries_included: kbEntries.length,
      memory_entries_included: memoryEntries.length,
      existing_links: existingLinks.length,
      sources: sources.length
    },
    kb_entries: kbEntries.map((e) => ({
      id: String(e.id),
      type: "kb",
      title: e.title,
      content_preview: e.content_preview,
      source: e.source ?? undefined
    })),
    memory_entries: memoryEntries.map((e) => ({
      id: e.id,
      type: "memory",
      scope: e.scope,
      content_preview: e.content_preview,
      tags: e.tags ? JSON.parse(e.tags) : undefined,
      created_at: e.created_at,
      updated_at: e.updated_at ?? undefined
    })),
    existing_links: existingLinks.map((l) => ({
      source_id: l.source_id,
      source_type: l.source_type,
      target_id: l.target_id,
      target_type: l.target_type,
      relation: l.relation
    })),
    sources,
    semantic_prompt: SEMANTIC_PROMPT,
    instructions: `Pass kb_entries, memory_entries, and existing_links to an LLM along with semantic_prompt. The LLM should return JSON with keys: contradictions, stale_claims, missing_entity_pages, missing_cross_references. Total entries analyzed: ${totalEntries}.`
  };
}
