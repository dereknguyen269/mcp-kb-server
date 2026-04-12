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

export function createWikiLintTool({ memoryDb, kbDb }) {
  return {
    name: "wiki.lint",
    description: "Health-check the wiki: find orphan entries, broken links, stale sources, and missing cross-references.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        project_root: { type: "string" }
      }
    },
    handler: async (args) => {
      const project_id = resolveProjectId(args);
      if (!project_id) throw Object.assign(new Error("project_id or project_root is required"), { code: -32602 });

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

      // 4. KB entries with no links (suggested cross-refs)
      const linkedKbIds = new Set([
        ...memoryDb.prepare("SELECT source_id as id FROM wiki_links WHERE project_id = ? AND source_type = 'kb'").all(project_id).map((r) => String(r.id)),
        ...memoryDb.prepare("SELECT target_id as id FROM wiki_links WHERE project_id = ? AND target_type = 'kb'").all(project_id).map((r) => String(r.id))
      ]);
      const allKbEntries = kbDb.prepare(`
        SELECT f.rowid as id, f.title, substr(f.content, 1, 80) as preview
        FROM kb_fts f
        JOIN kb_meta m ON m.rowid = f.rowid
        WHERE m.project_id = ?
        LIMIT 100
      `).all(project_id);
      const unlinkedKb = allKbEntries.filter((e) => !linkedKbIds.has(String(e.id))).slice(0, 20);

      const issues = orphanMemory.length + brokenLinks.length + staleSources.length;
      const summary = `Found ${issues} issue(s): ${orphanMemory.length} orphan memory entries, ${brokenLinks.length} broken links, ${staleSources.length} stale sources. ${unlinkedKb.length} KB entries have no cross-references.`;

      return {
        orphan_memory: orphanMemory,
        broken_links: brokenLinks,
        stale_sources: staleSources,
        unlinked_kb: unlinkedKb,
        summary
      };
    }
  };
}
