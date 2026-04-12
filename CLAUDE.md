# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # Run the MCP server
npm test         # Run all tests (NODE_ENV=test node --test)
```

To run a single test file:
```bash
NODE_ENV=test node --test test/memory.test.js
```

No linter is configured. Node.js built-in test runner is used (`node --test`).

## Architecture

This is an MCP (Model Context Protocol) server that provides persistent memory, knowledge base, and project summary tools to AI assistants over stdio (JSON-RPC 2.0).

**Request flow:**
```
AI Assistant (stdio) → server.js → Joi validation → tool handler → better-sqlite3 → response
```

**Two SQLite databases** (auto-created in `./data/`):
- `memory.sqlite` — `memory` + `memory_fts` (FTS5/BM25) + `wiki_links` (cross-references)
- `kb.sqlite` — `kb_fts` + `kb_meta` (project scoping) + `sources` + `sources_fts` (raw sources layer)

**Tool groups** (each in `src/tools/`):
- `memory.js` — store/search/list/delete/update; all scoped by `project_id`
- `kb.js` — add/search documents; optional Qdrant vector search via `ENABLE_QDRANT`
- `sources.js` — ingest/list/search raw source files (md, txt, csv, pdf); pdf-parse + csv-parse for extraction
- `wikiLinks.js` — create and list explicit cross-reference links between entries (`wiki.link`, `wiki.links`)
- `wikiLint.js` — health-check for orphans, broken links, stale sources (`wiki.lint`)
- `wikiExport.js` — export all data as markdown files to a directory (`wiki.export`)
- `summary.js` / `summaryDelta.js` — generate project snapshots from files + memory + KB
- `dashboard.js` — interactive HTML dashboard; auto-starts HTTP server if `DASHBOARD_PORT` is set

**Project ID detection** (`src/utils/projectId.js`): auto-infers `project_id` from `package.json` name → git remote URL → directory basename. All tool calls accept `project_root` instead of explicit `project_id`.

**Performance layer** (`src/utils/performance.js`): LRU query cache (50 entries, 5-min TTL) invalidated on every mutation. Throttled expiry purge (max once per 60s per project).

**Validation** (`src/utils/validation.js`): Joi schemas for all tools — checked before any DB access.

## Key Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `./data` | SQLite database location |
| `LOG_LEVEL` | `info` | Winston log level |
| `MAX_MEMORY_ENTRIES` | `1000` | Per-project memory cap |
| `MAX_KB_ENTRIES` | `500` | Per-project KB cap |
| `ENABLE_QDRANT` | `false` | Enable vector search |
| `QDRANT_URL` | — | Qdrant endpoint when enabled |
| `VACUUM_INTERVAL` | `86400000` | DB vacuum interval (ms) |
| `DASHBOARD_PORT` | — | Set to auto-start dashboard on boot (e.g. `4242`). Access at `http://127.0.0.1:<port>`. If unset, starts on demand via `dashboard.projects` tool. |

## Project Isolation

Every read/write query filters by `project_id` at the SQL level — there is no cross-project data access. FTS searches join `memory_fts` back to `memory` on `project_id` to enforce this.
