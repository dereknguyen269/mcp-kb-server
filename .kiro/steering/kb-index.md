---
inclusion: manual
---

# KB Index Convention

The KB index is a single document with `source="_index"` that serves as the wiki's table of contents. It is the first thing to read when navigating the KB — before searching blind.

**Read it at the start of any KB-heavy task:**

```
kb.index { project_id }
```

Returns `{ exists: false }` if no index has been built yet. In that case, build one (see below).

---

## Format

The index is free-form markdown. A good index looks like:

```markdown
# KB Index

## Core concepts
- [FTS5] (id:3) — SQLite full-text search extension; used for BM25-ranked queries across memory and KB
- [BM25 ranking] (id:4) — relevance scoring algorithm built into FTS5; lower score = better match
- [LRU query cache] (id:5) — 50-entry in-memory cache with 5-min TTL; cleared on every write

## Storage
- [memory.sqlite] (id:1) — stores memory entries, FTS index, and wiki links; scoped by project_id
- [kb.sqlite] (id:2) — stores KB documents and source metadata; supports project scoping via kb_meta

## Sources
- [architecture.md] (source id: abc-123) — system architecture overview; ingested 2026-04-12
```

Rules:
- One line per entity. Title, ID, one-sentence description.
- Group by theme (concepts, storage, APIs, people, decisions, etc.)
- Keep descriptions to one sentence — the index is for navigation, not explanation
- Include both KB entity IDs and source IDs so either can be fetched directly

---

## When to regenerate

Regenerate after any mutation to the KB:

1. Fetch all current KB entries (use `kb.search` with empty query, paginate if needed)
2. Read each entry's title, ID, and first sentence of content
3. Group entries by theme
4. Write the new index:

```
kb.index { project_id, content: "<new markdown>" }
```

`kb.index` with content always replaces the full index atomically — no partial updates.

---

## What NOT to put in the index

- Full content of any entry (that's what `kb.get` is for)
- Duplicate entries for the same concept
- The index entry itself (it has `source="_index"`, skip it when listing)
- Entries with no meaningful description yet
