---
inclusion: manual
---

# KB Ingest Workflow

After ingesting a source document, process it to extract knowledge into the KB. This implements the Karpathy pattern: raw sources are the ground truth; the KB is the LLM-curated index built on top of them.

**Invoke this workflow after any `source.ingest` or `kb.init` call, or when asked to "process" a source.**

---

## Required context

You need `project_id` (or `project_root`) for every tool call. Infer it from the current project if not stated.

---

## Step 1 — Read the source

**After `source.ingest`** — the response includes `ingested[].id` for each file. Use it directly:

```
source.get { id: "<ingested[0].id>", project_id }
```

If multiple files were ingested, process each one in sequence using its own ID.

**After `kb.init`** — files land directly in `kb_fts` with no source record. The response includes `added_titles`. Look up each title to get its ID, then fetch full content:

```
kb.search { query: "<title>", project_id, limit: 1, max_content_length: 50 }
kb.get { id: <id from result>, project_id }
```

If `kb.init` added multiple files, process each one in sequence — don't batch them.

---

## Step 2 — Extract entities and concepts

Read the document and identify:

- **Named entities**: people, systems, tools, libraries, APIs, organizations
- **Key concepts**: domain terms, patterns, algorithms, decisions, constraints
- **Relationships**: what connects entities to each other (depends-on, implements, replaces, authored-by, etc.)
- **Facts worth indexing**: decisions made, problems solved, open questions

Aim for 3–10 entities per document. Prefer specific over generic (e.g. "BM25 ranking" over "search").

---

## Step 3 — Create or update entity pages

For each entity, check if a page already exists:

```
kb.search { query: "<entity name>", project_id, limit: 3, max_content_length: 200 }
```

**If no match** — create a new page:

```
kb.add {
  title: "<Entity Name>",
  content: "<2–4 sentence description. What it is, why it matters in this project, any key properties.>",
  source: "<source_id or relative file path>",
  project_id
}
```

**If a match exists** — extend it, don't duplicate:

```
kb.update {
  id: <existing_id>,
  content: "<existing content>\n\n---\n<new information from this source>"
}
```

Keep entity pages factual and terse. They are reference nodes, not essays.

---

## Step 4 — Create cross-references

Link related entities to each other and back to the source.

For each meaningful relationship identified in Step 2:

```
wiki.link {
  source_id: "<entity_kb_id>",
  source_type: "kb",
  target_id: "<related_entity_kb_id>",
  target_type: "kb",
  relation: "<depends-on | implements | replaces | related-to | authored-by | ...>",
  project_id
}
```

Link each new entity page back to the ingested document:

- After `source.ingest`: `target_type: "source"`, `target_id: "<source_id>"`
- After `kb.init`: `target_type: "kb"`, `target_id: "<kb_id of the raw file entry>"`

```
wiki.link {
  source_id: "<entity_kb_id>",
  source_type: "kb",
  target_id: "<source or kb id>",
  target_type: "<source | kb>",
  relation: "extracted-from",
  project_id
}
```

Only create links that reflect real relationships. Skip generic "related-to" links unless the connection is meaningful.

---

## Step 5 — Regenerate the index

Fetch the current index:

```
kb.index { project_id }
```

Then fetch all KB entries to build a complete picture (skip entries with `source="_index"`):

```
kb.search { query: "", project_id, limit: 100, max_content_length: 200 }
```

Write the new index — group entries by theme, one line each with ID and one-sentence description:

```
kb.index {
  project_id,
  content: "# KB Index\n\n## <Theme>\n- [<Title>] (id:<id>) — <one sentence>\n..."
}
```

See `.kiro/steering/kb-index.md` for the full format convention.

---

## Step 6 — Append to changelog

Find or create a memory entry in scope `"changelog"`:

```
memory.search { query: "changelog", scope: "changelog", project_id, limit: 1 }
```

If it exists, update it:

```
memory.update {
  id: <changelog_id>,
  content: "<existing content>\n\n[<ISO date>] Ingested `<filename>` — added: <entity1>, <entity2>, ..."
}
```

If it doesn't exist, create it:

```
memory.store {
  scope: "changelog",
  content: "[<ISO date>] Ingested `<filename>` — added: <entity1>, <entity2>, ...",
  tags: ["changelog"],
  project_id
}
```

---

## Example

Source ingested: `architecture.md` — describes how the server uses two SQLite databases, FTS5 for search, and an LRU cache.

**Entities extracted**: `memory.sqlite`, `kb.sqlite`, `FTS5`, `BM25 ranking`, `LRU query cache`

**KB pages created**:
- "memory.sqlite" — stores memory entries and wiki links; uses FTS5 for full-text search
- "kb.sqlite" — stores KB documents and source metadata; supports project scoping via kb_meta
- "FTS5" — SQLite full-text search extension used for BM25-ranked queries
- "LRU query cache" — 50-entry in-memory cache with 5-min TTL; invalidated on every write

**Links created**:
- memory.sqlite → FTS5 (depends-on)
- kb.sqlite → FTS5 (depends-on)
- LRU query cache → memory.sqlite (caches)
- LRU query cache → kb.sqlite (caches)
- each entity → source (extracted-from)

**Index updated**: 4 new lines appended

**Changelog updated**: `[2026-04-12] Ingested architecture.md — added: memory.sqlite, kb.sqlite, FTS5, BM25 ranking, LRU query cache`
