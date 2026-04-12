# MCP Knowledge Base Server

[![npm version](https://img.shields.io/npm/v/mcp-kb-server.svg)](https://www.npmjs.com/package/mcp-kb-server)
[![license](https://img.shields.io/npm/l/mcp-kb-server.svg)](https://www.npmjs.com/package/mcp-kb-server)
[![Node.js](https://img.shields.io/node/v/mcp-kb-server.svg)](https://www.npmjs.com/package/mcp-kb-server)

A Model Context Protocol (MCP) server providing persistent memory, knowledge base, and project summary capabilities with automatic project detection and an interactive dashboard.

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                   AI Assistant (Kiro, Claude, etc.)          │
│                                                              │
│  "Remember we use JWT"    "What do I know about auth?"       │
│  "Init KB from my docs"   "What changed since last summary?" │
└──────────────┬───────────────────────────┬───────────────────┘
               │ MCP Protocol (stdio)      │
               ▼                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    mcp-kb-server                             │
│                                                              │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐          │
│  │ memory  │ │    kb    │ │ summary │ │dashboard │          │
│  │ .store  │ │ .add     │ │.project │ │.projects │          │
│  │ .search │ │ .search  │ │ .delta  │ └──────────┘          │
│  │ .list   │ │ .init ★  │ └─────────┘                       │
│  │ .delete │ └──────────┘                                    │
│  │ .update │   Auto-detect project_id from project_root      │
│  └─────────┘   package.json → git remote → directory name   │
│                                                              │
│  ┌────────────────────┐  ┌─────────────────────┐            │
│  │  memory.sqlite     │  │  kb.sqlite           │            │
│  │  + memory_fts(FTS5)│  │  + kb_fts (FTS5)     │            │
│  │  + wiki_links      │  │  + kb_meta (scoping) │            │
│  │  + expires/TTL     │  │  + sources + fts     │            │
│  └────────────────────┘  └─────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

---

## Workflow Diagrams

### 1. Request Flow

Every tool call follows the same path from AI to database and back.

```
AI Assistant
    │
    │  JSON-RPC 2.0 over stdio
    ▼
server.js
    │
    ├─ Joi validation ──── invalid ──► error -32602
    │
    ├─ project_id resolution
    │     project_root provided?
    │     ├─ yes → detectProjectId()
    │     │         ├─ package.json name
    │     │         ├─ git remote URL
    │     │         └─ directory basename
    │     └─ no  → use explicit project_id
    │
    ├─ LRU query cache (read-only tools)
    │     hit  ──────────────────────► return cached result
    │     miss ─┐
    │           ▼
    ├─ tool handler (memory / kb / sources / wiki / summary)
    │           │
    │           ▼
    │     better-sqlite3 (synchronous)
    │     memory.sqlite  ──  kb.sqlite
    │           │
    │           ▼
    │     cache invalidated (on mutations)
    │
    └─ JSON-RPC result ──────────────► AI Assistant
```

---

### 2. Project Initialization (`kb.init`)

Run once when starting work on a project to populate the KB from existing docs.

```
Developer / AI
    │
    │  kb.init({ project_root: "/path/to/project" })
    ▼
Resolve project_id
    │  package.json → git remote → directory name
    ▼
Expand glob patterns
    │  default: ["**/*.md", "**/*.txt"]
    │  skip:    node_modules / .git / dist / build
    ▼
For each file
    ├─ already in KB? (matched by source path)
    │   └─ yes + overwrite=false → skip
    │
    ├─ read file content
    │   └─ binary or empty → skip
    │
    └─ extract title
        ├─ first "# Heading" in content
        └─ fallback: filename without extension
    ▼
Bulk INSERT (single SQLite transaction)
    │  kb_fts  ← title, content, source
    │  kb_meta ← rowid, project_id
    ▼
Return { scanned, added, skipped, added_titles }
```

---

### 3. Memory Lifecycle

```
                    ┌─────────────────────────────┐
                    │         AI Assistant         │
                    └──┬──────────┬───────────┬───┘
                       │          │           │
                  store/update  search      delete
                       │          │           │
                       ▼          ▼           ▼
              ┌────────────────────────────────────┐
              │           memory.sqlite             │
              │                                     │
              │  memory table                       │
              │  ┌──────────────────────────────┐   │
              │  │ id · project_id · scope      │   │
              │  │ content · tags · created_at  │   │
              │  │ updated_at · expires_at      │   │
              │  └──────────────────────────────┘   │
              │           │ FTS5 sync                │
              │  memory_fts (BM25 ranked search)     │
              │                                     │
              │  wiki_links (cross-references)       │
              └────────────────────────────────────┘
                       │
                  TTL purge
                  (auto on access, max 1×/60s/project)
                       │
                       ▼
              expired entries removed
```

---

### 4. Knowledge Base Flow

```
                 ┌──────────────────────────────────┐
                 │           Input sources           │
                 │                                   │
                 │  kb.init        kb.add            │
                 │  (bulk scan)    (single doc)      │
                 │  Dashboard      Dashboard          │
                 │  Import         New Document       │
                 └──────────┬───────────┬────────────┘
                            │           │
                            ▼           ▼
                 ┌──────────────────────────────────┐
                 │           kb.sqlite               │
                 │                                   │
                 │  kb_fts ── title, content, source │
                 │  kb_meta ─ rowid → project_id     │
                 └──────────────────────────────────┘
                            │
              ┌─────────────┼──────────────┐
              │             │              │
         kb.search    dashboard       wiki.link
         (FTS5/BM25   (split-panel    (cross-ref
          + Qdrant     list+detail)    to memory
          optional)                    or source)
              │
              ▼
         AI Assistant
```

---

### 5. Summary & Delta Flow

```
summary.project                        summary.delta
──────────────                         ─────────────

project_root                           project_root
    │                                      │
    ├─ auto-discover files                 ├─ run summary.project
    │   README, ARCHITECTURE,              │   (current snapshot)
    │   .kiro/resources/*.md, etc.         │
    │                                      ├─ search memory for
    ├─ memory.search (recent)              │   last "project-summary"
    │                                      │   scope entry
    ├─ kb.search (relevant docs)           │
    │                                      └─ diff current vs stored
    ▼                                          │
combined snapshot text                         ▼
    │                                  changed files / new memories /
    │  (AI stores result via            updated docs highlighted
    │   memory.store scope=
    │   "project-summary")
    ▼
searchable baseline for next delta
```

---

### 6. Dashboard Architecture

```
Browser                    HTTP Server (Node.js)           SQLite
  │                              │                            │
  │  GET /                       │                            │
  │ ─────────────────────────►   │                            │
  │  ◄── HTML (self-contained) ──│                            │
  │                              │                            │
  │  GET /api/projects           │  SELECT project_id,        │
  │ ─────────────────────────►   │  COUNT(*) FROM memory  ──► │
  │  ◄── [{ project_id, total }] │  ◄─────────────────────── │
  │                              │                            │
  │  GET /api/kb                 │  SELECT kb_fts JOIN        │
  │  ?project_id=x&limit=30      │  kb_meta WHERE             │
  │ ─────────────────────────►   │  project_id=x          ──► │
  │  ◄── { items, total }        │  ◄────────────────────── │
  │                              │                            │
  │  (click item)                │                            │
  │  GET /api/kb/:id         ──► │  SELECT * FROM kb_fts  ──► │
  │  ◄── { title, content, … }   │  ◄─────────────────────── │
  │                              │                            │
  │  GET /api/export/kb          │  SELECT all docs for       │
  │  ?project_id=x           ──► │  project → render .md  ──► │
  │  ◄── kb-x-2026-04-12.md      │  ◄─────────────────────── │
  │                              │                            │
  │  POST /api/kb/import         │  bulk INSERT kb_fts        │
  │  { project_id, docs[] }  ──► │  + kb_meta (transaction)──►│
  │  ◄── { ok, count }           │  ◄─────────────────────── │
```

---

### 7. Wiki Links & Lint

```
Entries (any type)
  memory ──┐
  kb     ──┼──► wiki.link ──► wiki_links table
  source ──┘                  (source_id, source_type,
                               target_id, target_type,
                               relation, project_id)
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
               wiki.links      wiki.lint       wiki.export
               (lookup by      (health check)  (dump to .md)
                entry_id)           │
                    │          ┌────┴────────────────┐
                    │          │ orphan_memory        │
                    │          │ (no links at all)    │
                    │          │                      │
                    │          │ broken_links         │
                    │          │ (source or target    │
                    │          │  no longer exists)   │
                    │          │                      │
                    │          │ stale_sources        │
                    │          │ (90+ days, no links) │
                    │          └──────────────────────┘
                    ▼
             { outbound[], inbound[] }
```

---

## Features

### 🧠 Memory Management
- **Long-term Memory**: Store, search, list, update, and delete project-specific memory entries
- **Full-Text Search**: FTS5 with BM25 ranking via `use_fts` flag, plus substring fallback
- **Tag Filtering**: Filter memories by tag name, combine with text queries
- **Pagination**: `memory.list` with `total_count`, `offset`, `has_more`
- **TTL / Expiry**: Optional `expires_at` on entries, auto-purged on access
- **Project Isolation**: Complete data isolation between projects

### 📚 Knowledge Base
- **Document Storage**: Add and search documents with FTS5 full-text search
- **Project Scoping**: `project_id` on all KB operations isolates docs per project
- **Bulk Init**: `kb.init` scans a project directory and imports all `.md`/`.txt` files in one call
- **Vector Search**: Optional Qdrant integration for semantic search
- **Source Tracking**: Track document sources and metadata

### 📂 Sources Layer
- **Raw Ingest**: Ingest `.md`, `.txt`, `.csv`, `.pdf` files via `source.ingest`
- **FTS Search**: Full-text search across ingested source content
- **Project Isolation**: Sources scoped per project

### 🔗 Wiki Links & Lint
- **Cross-references**: `wiki.link` creates typed links between memory/KB/source entries
- **Link Lookup**: `wiki.links` returns inbound and outbound links for any entry
- **Health Check**: `wiki.lint` detects orphan entries, broken links, and stale sources
- **Export**: `wiki.export` dumps all data as markdown files to a directory

### 📊 Project Summaries
- **Snapshot Generation**: `summary.project` reads files + memory + KB into a single snapshot
- **Delta Summaries**: `summary.delta` compares current state vs. last summary
- **Auto-Discovery**: Finds instruction files (README, ARCHITECTURE, `.kiro/resources/*.md`, etc.)

### 🎨 Interactive Dashboard
- **Split-panel UI**: KB, Memory, and Sources tabs show a paginated list on the left and a detail view on the right — no more infinite scroll dumps
- **Load More**: All lists paginate in batches of 30
- **Project Management**: Create and delete projects directly from the UI
- **KB Management**: Add, edit, delete, import (JSON/`.md`), and export KB documents as Markdown
- **Memory Management**: View and delete individual memory entries; export all as Markdown
- **Sources Viewer**: Browse and preview ingested source files inline
- **Dark / Light mode**, responsive layout, markdown rendering

### 🔒 Safety
- Path validation, mismatch detection, XSS protection, parameterized SQL

## Installation

```bash
npm install -g mcp-kb-server
```

Or use directly with npx:

```bash
npx mcp-kb-server
```

## Usage

### Configure MCP Client

```json
{
  "mcpServers": {
    "kb-server": {
      "command": "npx",
      "args": ["mcp-kb-server"],
      "env": {}
    }
  }
}
```

With a custom data directory:

```json
{
  "mcpServers": {
    "kb-server": {
      "command": "npx",
      "args": ["mcp-kb-server"],
      "env": {
        "DATA_DIR": "/path/to/your/data",
        "DASHBOARD_PORT": "4242"
      }
    }
  }
}
```

---

## Available Tools

### Memory Tools

All memory tools require either `project_root` (recommended) or `project_id`.

**memory.store**
```json
{
  "project_root": "/path/to/project",
  "content": "We use JWT for auth — stateless, works with mobile",
  "scope": "decisions",
  "tags": ["auth", "jwt", "architecture"],
  "expires_at": "2027-01-01T00:00:00Z"
}
```

**memory.search**
```json
{
  "project_root": "/path/to/project",
  "query": "authentication",
  "tag": "decision",
  "use_fts": true,
  "limit": 10
}
```

**memory.list**
```json
{
  "project_root": "/path/to/project",
  "limit": 50,
  "offset": 0,
  "scope": "decisions"
}
```
Returns `{ total_count, offset, limit, has_more, entries }`.

**memory.update**
```json
{
  "project_root": "/path/to/project",
  "id": "uuid",
  "content": "Updated content",
  "tags": ["updated", "auth"],
  "expires_at": ""
}
```

**memory.delete**
```json
{
  "project_root": "/path/to/project",
  "id": "uuid"
}
```

---

### Knowledge Base Tools

**kb.add**
```json
{
  "title": "API Reference",
  "content": "## Endpoints\n...",
  "source": "docs/api.md",
  "project_id": "my-project"
}
```

**kb.search**
```json
{
  "query": "authentication",
  "project_id": "my-project",
  "limit": 5
}
```

**kb.init** ★ — Scan a project and bulk-import all docs into the KB
```json
{
  "project_root": "/path/to/project",
  "patterns": ["**/*.md", "docs/**/*.txt"],
  "overwrite": false
}
```

Returns:
```json
{
  "project_id": "my-project",
  "scanned": 42,
  "added": 38,
  "skipped": 4,
  "added_titles": ["Getting Started", "API Reference", "..."],
  "skipped_paths": ["CHANGELOG.md (empty or binary)", "..."]
}
```

- Auto-detects `project_id` from `project_root`
- Default patterns: `["**/*.md", "**/*.txt"]`
- Skips `node_modules`, `.git`, `dist`, `build` automatically
- Uses first `# Heading` as title, falls back to filename
- Skips already-imported files unless `overwrite: true`
- Bulk-inserts in a single SQLite transaction

---

### Source Tools

**source.ingest** — Ingest a raw file (md, txt, csv, pdf)
```json
{
  "project_root": "/path/to/project",
  "filename": "spec.md",
  "content": "...",
  "file_type": "md"
}
```

**source.list** / **source.search**
```json
{
  "project_root": "/path/to/project",
  "query": "authentication",
  "limit": 20,
  "offset": 0
}
```

---

### Wiki Tools

**wiki.link** — Create a typed link between two entries
```json
{
  "project_root": "/path/to/project",
  "source_id": "mem-uuid",
  "source_type": "memory",
  "target_id": "kb-rowid",
  "target_type": "kb",
  "relation": "implements"
}
```

**wiki.links** — Look up all links for an entry
```json
{
  "project_root": "/path/to/project",
  "entry_id": "mem-uuid"
}
```

**wiki.lint** — Health check
```json
{ "project_root": "/path/to/project" }
```
Returns `{ orphan_memory, broken_links, stale_sources, summary }`.

**wiki.export** — Export everything as markdown files
```json
{
  "project_root": "/path/to/project",
  "output_dir": "./wiki-export"
}
```

---

### Summary Tools

**summary.project**
```json
{
  "project_root": "/path/to/project",
  "auto_discover": true,
  "include_memory": true,
  "include_kb": true
}
```

**summary.delta**
```json
{
  "project_root": "/path/to/project",
  "auto_discover": true
}
```

---

### Dashboard Tool

**dashboard.projects** — Start the dashboard server and return the URL
```json
{ "limit": 10 }
```

Returns `{ dashboard_url, file_path }`. Open the URL in a browser.

Set `DASHBOARD_PORT=4242` in env to auto-start on server boot.

---

## Dashboard

The dashboard is a self-contained HTML app served locally.

### KB Tab
- Left panel: paginated document list (30/page) with search
- Right panel: full document view with Edit / Delete actions
- Toolbar: New Document, Import (JSON or `.md`), Export as Markdown

### Memory Tab
- Left panel: paginated entry list showing scope + preview
- Right panel: full markdown content with Delete button
- Header: Export all entries as Markdown

### Sources Tab
- Left panel: paginated file list with search
- Right panel: inline file content preview (no modal)

### Links / Lint Tabs
- Links: look up cross-references by entry ID
- Lint: detect orphans, broken links, stale sources

### Project Management
- Project selector in topbar — switches all tabs
- "+" button to create a new project
- "Delete Project" button to wipe all data for the current project

### Import Format (JSON)
```json
[
  { "title": "Getting Started", "content": "## Overview\n...", "source": "docs/intro.md" },
  { "title": "API Reference",   "content": "## Endpoints\n..." }
]
```

### Export Format (Markdown)
KB export (`kb-{project}-{date}.md`):
```markdown
# Knowledge Base — my-project

> Exported 2026-04-12T... · 38 documents

---

## Getting Started

**Source:** docs/intro.md
**ID:** 1

## Overview
...
```

Memory export (`memory-{project}-{date}.md`):
```markdown
# Memory — my-project

> Exported 2026-04-12T... · 12 entries

---

### [decisions] uuid-here

**Tags:** auth, jwt
**Created:** 2026-03-01T...

We use JWT for auth — stateless, works with mobile.
```

---

## Automatic Project Detection

`project_id` is auto-detected from `project_root` in this order:

1. `package.json` `name` field
2. Git remote origin URL (repo name)
3. Directory basename

All IDs are sanitized to lowercase alphanumeric + hyphens.

```javascript
// Auto-detection
memory.store({ project_root: "/Users/me/my-app", content: "test" })
// → project_id: "my-app"
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `./data` | SQLite database location |
| `LOG_LEVEL` | `info` | Winston log level |
| `MAX_MEMORY_ENTRIES` | `1000` | Per-project memory cap |
| `MAX_KB_ENTRIES` | `500` | Per-project KB cap |
| `ENABLE_QDRANT` | `false` | Enable vector search |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant endpoint |
| `VACUUM_INTERVAL` | `86400000` | DB vacuum interval (ms) |
| `DASHBOARD_PORT` | — | Auto-start dashboard on boot |

---

## Project Structure

```
mcp-kb-server/
├── src/
│   ├── server.js              # MCP entry point (JSON-RPC 2.0 over stdio)
│   ├── storage/db.js          # SQLite schema + migrations
│   ├── tools/
│   │   ├── memory.js          # memory.* tools
│   │   ├── kb.js              # kb.add / kb.search / kb.init
│   │   ├── sources.js         # source.ingest / list / search
│   │   ├── summary.js         # summary.project
│   │   ├── summaryDelta.js    # summary.delta
│   │   ├── wikiLinks.js       # wiki.link / wiki.links
│   │   ├── wikiLint.js        # wiki.lint
│   │   ├── wikiExport.js      # wiki.export
│   │   └── dashboard.js       # HTTP server + HTML dashboard
│   └── utils/
│       ├── projectId.js       # Auto-detection logic
│       ├── fileDiscovery.js   # Glob + file reading utilities
│       ├── config.js          # Env config
│       ├── validation.js      # Joi schemas
│       ├── performance.js     # LRU cache + vacuum scheduler
│       └── errors.js          # AppError / handleError
├── config/discovery.json      # Auto-discovery glob patterns
├── data/                      # SQLite databases (auto-created)
└── test/                      # 84 tests (node --test)
```

---

## Database Schema

**memory.sqlite**
```sql
CREATE TABLE memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'legacy',
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  expires_at TEXT
);
CREATE VIRTUAL TABLE memory_fts USING fts5(content, tags);
CREATE TABLE wiki_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT, source_type TEXT,
  target_id TEXT, target_type TEXT,
  relation TEXT, created_at TEXT
);
```

**kb.sqlite**
```sql
CREATE VIRTUAL TABLE kb_fts USING fts5(title, content, source);
CREATE TABLE kb_meta (rowid INTEGER PRIMARY KEY, project_id TEXT);
CREATE TABLE sources (
  id TEXT PRIMARY KEY, project_id TEXT,
  slug TEXT, filename TEXT, file_type TEXT,
  content TEXT, file_path TEXT,
  ingested_at TEXT, size_bytes INTEGER
);
CREATE VIRTUAL TABLE sources_fts USING fts5(slug, content);
```

---

## Development

```bash
git clone https://github.com/dereknguyen269/mcp-kb-server.git
cd mcp-kb-server
npm install
npm test        # runs all 84 tests
```

Run a single test file:
```bash
NODE_ENV=test node --test test/memory.test.js
```

---

## Security

- **Project Isolation**: SQL-level `project_id` filtering on every query
- **Path Validation**: Prevents directory traversal
- **XSS Protection**: All user content HTML-escaped in dashboard
- **Parameterized Queries**: No SQL injection surface
- **No External Resources**: Dashboard works fully offline

---

## Performance

- **FTS5 / BM25**: Ranked full-text search on memory, KB, and sources
- **LRU Query Cache**: 50-entry cache, 5-min TTL, invalidated on mutations
- **Throttled Purge**: Expired entry cleanup at most once per 60s per project
- **SQLite WAL**: Concurrent reads without blocking writes
- **Bulk Transactions**: `kb.init` and dashboard import use single transactions

---

## Error Codes

| Code | Meaning |
|---|---|
| `-32602` | Invalid params (missing fields, bad paths) |
| `-32601` | Method not found |
| `-32000` | Server / DB error |

---

## Version History

### v1.2.0 (Current)
- ✅ `kb.init` — bulk-import project docs from filesystem in one MCP call
- ✅ Dashboard split-panel UI — list + detail for KB, Memory, Sources
- ✅ Paginated lists (30/page, Load more) across all tabs
- ✅ Import KB from JSON array or `.md` file via dashboard
- ✅ Export KB and Memory as Markdown downloads
- ✅ Create / delete projects from dashboard
- ✅ Delete individual memory entries from dashboard
- ✅ KB list filtered by `project_id` (was showing all projects)
- ✅ New Document correctly scoped to current project
- ✅ 84 tests

### v1.1.0
- ✅ memory.delete / memory.update / memory.list
- ✅ Tag-based filtering, FTS5 on memory
- ✅ KB project scoping, TTL/expiry, LRU cache
- ✅ Sources layer (ingest md/txt/csv/pdf)
- ✅ Wiki links, lint, export tools

### v1.0.0
- ✅ Auto project_id detection
- ✅ Interactive HTML dashboard (dark/light)
- ✅ KB management (add/edit/delete)
- ✅ Project scoping, path validation

---

## Support

- **npm**: https://www.npmjs.com/package/mcp-kb-server
- **GitHub**: https://github.com/dereknguyen269/mcp-kb-server
- **Issues**: https://github.com/dereknguyen269/mcp-kb-server/issues
