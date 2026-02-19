# MCP Knowledge Base Server

A Model Context Protocol (MCP) server providing persistent memory, knowledge base, and project summary capabilities with automatic project detection and interactive dashboards.

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                   AI Assistant (Kiro, Claude, etc.)          │
│                                                              │
│  "Remember we use JWT"    "What do I know about auth?"       │
│  "Show all my memories"   "What changed since last summary?" │
└──────────────┬───────────────────────────┬───────────────────┘
               │ MCP Protocol (stdio)      │
               ▼                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    mcp-kb-server                             │
│                                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐            │
│  │ memory  │ │   kb    │ │ summary │ │dashboard │            │
│  │ .store  │ │ .add    │ │.project │ │.projects │            │
│  │ .search │ │ .search │ │ .delta  │ └──────────┘            │
│  │ .list   │ └─────────┘ └─────────┘                         │
│  │ .delete │                                                 │
│  │ .update │   Auto-detect project_id from project_root      │
│  └─────────┘   package.json → git remote → directory name    │
│                                                              │
│  ┌────────────────────┐  ┌────────────────────┐              │
│  │  memory.sqlite     │  │  kb.sqlite          │             │
│  │  + memory_fts(FTS5)│  │  + kb_fts (FTS5)    │             │
│  │  + expires/TTL     │  │  + kb_meta (scoping) │            │
│  └────────────────────┘  └────────────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

### Agent Workflow

```
  Store knowledge          Recall knowledge          Maintain knowledge
  ─────────────           ────────────────          ──────────────────
                                                    
  memory.store ──┐        memory.search -──┐         memory.update ──┐
  (decisions,    │        (query + tags,   │         (correct info,  │
   patterns,     │         FTS5 ranking)   │          refine tags)   │
   bug fixes)    │                         │                         │
                 │        memory.list ─────┤         memory.delete ──┤
  kb.add ────────┤        (paginated,      │         (remove stale)  │
  (docs, specs,  │         total_count)    │                         │
   references)   │                         │         TTL/expiry ─────┘
                 │        kb.search ───────┤         (auto-purge)
                 │        (FTS5 + optional │
                 │         project scoping)│
                 │                         │
                 ▼                         ▼
           ┌──────────┐            ┌──────────────┐
           │  SQLite  │            │  summary     │
           │  (WAL)   │◄───────────│  .project    │
           └──────────┘            │  .delta      │
                                   └──────┬───────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │  dashboard   │
                                   │  .projects   │
                                   │  (HTML view) │
                                   └──────────────┘
```

## Features

### 🧠 Memory Management
- **Long-term Memory**: Store, search, list, update, and delete project-specific memory entries
- **Full-Text Search**: FTS5 with BM25 ranking via `use_fts` flag, plus substring fallback
- **Tag Filtering**: Filter memories by tag name, combine with text queries
- **Pagination**: `memory.list` with `total_count`, `offset`, `has_more` for browsing all memories
- **TTL / Expiry**: Optional `expires_at` on entries, auto-purged on access
- **Automatic Project Detection**: Auto-detect project_id from package.json, git, or directory name
- **Project Isolation**: Complete data isolation between projects
- **Scoped Storage**: Organize entries by custom scopes

### 📚 Knowledge Base
- **Document Storage**: Add and search documents with full-text search (FTS5)
- **Project Scoping**: Optional `project_id` on kb.add/kb.search to isolate docs per project
- **Vector Search**: Optional Qdrant integration for semantic search
- **Source Tracking**: Track document sources and metadata

### 📊 Project Summaries
- **Snapshot Generation**: Create comprehensive project summaries from files, memory, and KB
- **Delta Summaries**: Compare current state vs. last summary to see changes
- **Auto-Discovery**: Automatically find instruction files (README, ARCHITECTURE, etc.)

### 🎨 Interactive Dashboards
- **Visual Overview**: Beautiful HTML dashboards showing all projects
- **Real-time Search**: Filter projects and entries interactively
- **Activity Tracking**: See recent activity across all projects
- **Self-Contained**: No external dependencies, works offline

### 🔒 Safety Features
- **Path Validation**: Validates project_root paths exist and are accessible
- **Mismatch Detection**: Warns when explicit project_id differs from detected
- **XSS Protection**: All user content is HTML-escaped
- **Path Normalization**: Consistent absolute paths across platforms
- **Cache Invalidation**: Query cache cleared on all mutations

## Installation

```bash
npm install
```

## Testing

```bash
npm run test
```

## Usage

### As MCP Server

Configure in your MCP client (e.g., Kiro, Claude Desktop):

```json
{
  "mcpServers": {
    "kb-server": {
      "command": "node",
      "args": ["/path/to/mcp-kb-server/src/server.js"],
      "env": {}
    }
  }
}
```

### Available Tools

#### Memory Tools
Requires either `project_root` or `project_id`.

**memory.store** - Store long-term memory
```javascript
{
  "project_root": "/path/to/project",  // Auto-detects project_id
  "content": "Important information",
  "scope": "default",                  // Optional
  "tags": ["feature", "auth"],         // Optional
  "expires_at": "2026-12-31T00:00:00Z" // Optional TTL
}
```

**memory.search** - Search memory
```javascript
{
  "project_root": "/path/to/project",
  "query": "authentication",
  "tag": "decision",                   // Optional — filter by tag
  "use_fts": true,                     // Optional — FTS5 with BM25 ranking
  "scope": "default",                  // Optional
  "limit": 5                           // Optional
}
```

**memory.list** - List all memories with pagination
```javascript
{
  "project_root": "/path/to/project",
  "limit": 50,                         // Optional (1-500, default 50)
  "offset": 0,                         // Optional — for pagination
  "scope": "decisions"                 // Optional — filter by scope
}
// Returns: { total_count, offset, limit, has_more, entries }
```

**memory.delete** - Delete a memory entry
```javascript
{
  "project_root": "/path/to/project",
  "id": "uuid-of-entry"
}
```

**memory.update** - Update an existing memory entry
```javascript
{
  "project_root": "/path/to/project",
  "id": "uuid-of-entry",
  "content": "Updated information",    // Optional
  "tags": ["updated", "auth"],         // Optional — replaces existing
  "expires_at": ""                     // Optional — empty string removes expiry
}
```

#### Knowledge Base Tools

**kb.add** - Add document to knowledge base
```javascript
{
  "title": "API Documentation",
  "content": "Complete API reference...",
  "source": "docs/api.md",             // Optional
  "project_id": "my-project"           // Optional — scope to project
}
```

**kb.search** - Search knowledge base
```javascript
{
  "query": "authentication",
  "project_id": "my-project",          // Optional — search only this project's docs
  "limit": 5                           // Optional
}
```

#### Summary Tools

**summary.project** - Generate project snapshot
```javascript
{
  "project_root": "/path/to/project",
  "auto_discover": true,               // Auto-find instruction files
  "include_memory": true,              // Include memory entries
  "include_kb": true                   // Include KB documents
}
```

**summary.delta** - Generate change summary
```javascript
{
  "project_root": "/path/to/project",
  "auto_discover": true
}
```

#### Dashboard Tool

**dashboard.projects** - Generate and serve interactive HTML dashboard
```javascript
{
  "limit": 10                          // Recent entries per project
}
```

Generates a dashboard file (in `./temp`) and starts a local server. Returns the local URL and file path.

## Automatic Project Detection

The server automatically detects `project_id` from `project_root` using:

1. **package.json** - Uses the "name" field
2. **Git remote** - Extracts repository name from origin URL
3. **Directory name** - Falls back to directory basename

All project IDs are sanitized to valid identifiers (lowercase, alphanumeric + hyphens).

### Example

```javascript
// Auto-detection
memory.store({
  project_root: "/Users/me/my-awesome-project",
  content: "test"
})
// Detects project_id: "my-awesome-project"

// Explicit (still works)
memory.store({
  project_id: "custom-id",
  project_root: "/Users/me/my-awesome-project",
  content: "test"
})
```

## Safety Features

### Path Validation

All `project_root` paths are validated:
- ✅ Path exists
- ✅ Path is a directory
- ✅ Path is accessible
- ✅ Path is normalized to absolute

```javascript
// ❌ Error: project_root does not exist
memory.store({ project_root: "/nonexistent", content: "test" })

// ❌ Error: project_root is not a directory
memory.store({ project_root: "/path/to/file.txt", content: "test" })

// ✅ Success: Valid path
memory.store({ project_root: "/path/to/project", content: "test" })
```

### Mismatch Detection

Warns when explicit `project_id` differs from auto-detected:

```javascript
// package.json has name: "actual-project"
memory.store({
  project_id: "wrong-name",
  project_root: "/path/to/actual-project",
  content: "test"
})
// Console: [SAFETY WARNING] Explicit project_id "wrong-name" 
// differs from detected "actual-project" (package.json)
```

## Dashboard

Generate beautiful HTML dashboards:

```javascript
const result = dashboard.projects({ limit: 20 });

console.log(result.dashboard_url);
// Open the URL in your browser
```

**Dashboard Features**:
- 📊 Overview statistics (projects, entries, summaries)
- 🔍 Real-time search and filtering
- ✏️ Interactive KB management (Add/Edit/Delete)
- 📝 Markdown rendering support
- 📋 Latest project summaries
- 🎨 Clean, theme-aware UI (Dark/Light mode)
- 📱 Responsive design
- 🔒 XSS protection
- 📦 Self-contained (no external dependencies)

## Project Structure

```
mcp-kb-server/
├── src/
│   ├── server.js              # MCP server entry point
│   ├── storage/
│   │   └── db.js             # Database initialization
│   ├── tools/
│   │   ├── memory.js         # Memory storage/search
│   │   ├── kb.js             # Knowledge base
│   │   ├── summary.js        # Project summaries
│   │   ├── summaryDelta.js   # Delta summaries
│   │   └── dashboard.js      # Dashboard generation
│   └── utils/
│       └── projectId.js      # Project ID detection
├── data/                      # SQLite databases (auto-created)
├── test/                      # Test suite
├── config/
│   └── discovery.json        # Auto-discovery patterns
└── package.json
```

## Database

Uses SQLite for persistent storage:

- **memory.sqlite** - Memory entries with project scoping
- **kb.sqlite** - Knowledge base documents with FTS5

Databases are automatically created in the `data/` directory on first run.

## Development

### Run Tests

```bash
npm test
```

All 66 tests should pass:
- ✅ Memory tools — store, search, list, delete, update, tags, FTS5, expiry (15 tests)
- ✅ KB tools — add, search, vector, rollback, project scoping (4 tests)
- ✅ Project ID detection (6 tests)
- ✅ Project safety (11 tests)
- ✅ Project scoping (5 tests)
- ✅ Summary tools (4 tests)
- ✅ Dashboard (7 tests)
- ✅ Config, errors, performance, validation (14 tests)

### Project Detection

Test detection logic:

```javascript
import { detectProjectId } from './src/utils/projectId.js';

const result = detectProjectId('/path/to/project');
console.log(result);
// {
//   project_id: "my-project",
//   project_root: "/absolute/path/to/project",
//   detection_method: "package.json",
//   explicit_mismatch: false,
//   explicit_project_id: null
// }
```

## Configuration

### Auto-Discovery Patterns

Edit `config/discovery.json` to customize which files are auto-discovered:

```json
{
  "instructionFiles": [
    "README.md",
    "README",
    "ARCHITECTURE.md",
    "DESIGN.md",
    ".kiro/resources/*.md",
    "docs/**/*.md"
  ]
}
```

Supports glob patterns with `*` and `**`.

## Requirements

- **Node.js**: ≥18
- **Dependencies**: better-sqlite3, dotenv, joi, winston

## Architecture

### Memory Scoping

All memory entries are scoped by `project_id`:

```sql
CREATE TABLE memory (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  expires_at TEXT,
  project_id TEXT NOT NULL DEFAULT 'legacy'
);

-- FTS5 for full-text search with BM25 ranking
CREATE VIRTUAL TABLE memory_fts USING fts5(content, tags);

CREATE INDEX idx_memory_project_id ON memory(project_id);
CREATE INDEX idx_memory_expires_at ON memory(expires_at);
```

### Knowledge Base

Full-text search with FTS5, optional project scoping:

```sql
CREATE VIRTUAL TABLE kb_fts USING fts5(title, content, source);

-- Project scoping metadata
CREATE TABLE kb_meta (
  rowid INTEGER PRIMARY KEY,
  project_id TEXT DEFAULT NULL
);
```

## Security

- **Project Isolation**: Complete data isolation between projects
- **Path Validation**: Prevents directory traversal and invalid paths
- **XSS Protection**: All user content is HTML-escaped in dashboards
- **No External Resources**: Dashboards work offline, no CDN dependencies
- **Parameterized Queries**: SQL injection prevention

## Performance

- **Indexed Queries**: All project_id queries use indexes
- **FTS5 Search**: BM25-ranked full-text search on both memory and KB
- **LRU Query Cache**: 50-entry cache with 5-minute TTL, auto-invalidated on mutations
- **Throttled Maintenance**: Expired entry purge runs at most once per 60s per project
- **Efficient Aggregation**: Dashboard uses single query for stats
- **Configurable Limits**: Control result set sizes
- **Synchronous API**: better-sqlite3 is faster than async alternatives

## Error Handling

All errors include JSON-RPC error codes:

```javascript
{
  "error": {
    "code": -32602,
    "message": "project_root does not exist: /nonexistent"
  }
}
```

Common error codes:
- `-32602`: Invalid params (missing required fields, invalid paths)
- `-32601`: Method not found
- `-32000`: Server error

## Migration

### From v0.x (No Project Scoping)

Legacy entries are automatically assigned `project_id = 'legacy'`:

```javascript
// Access legacy data
memory.search({ project_id: "legacy", query: "" })
```

### Updating to Project Scoping

Simply provide `project_root` and the server will auto-detect:

```javascript
// Old (still works)
memory.store({ project_id: "my-project", content: "test" })

// New (recommended)
memory.store({ project_root: "/path/to/project", content: "test" })
```

## Documentation

- **README.md** - Main documentation (you are here)
- **EXAMPLES.md** - Practical prompts and usage examples for AI assistants
- **AUTOMATIC_PROJECT_ID.md** - Auto-detection feature guide
- **PROJECT_SAFETY_RULES.md** - Safety features documentation
- **DASHBOARD_FEATURE.md** - Dashboard usage guide
- **PROJECT_SCOPING.md** - Project scoping implementation details
- **IMPLEMENTATION_SUMMARY.md** - Recent changes summary

## Quick Start with AI Assistants

See **EXAMPLES.md** for practical prompts like:

```
"Store a memory that we're using JWT for authentication"
"Search my project memory for anything about the database"
"Generate a dashboard showing all my projects"
"What changed in my project since the last summary?"
```

The EXAMPLES.md file includes:
- Common usage patterns
- Workflow examples
- Prompt templates
- Best practices
- Troubleshooting tips

## Examples

### Store and Search Memory

```javascript
// Store
memory.store({
  project_root: "/path/to/project",
  content: "Implemented user authentication with JWT",
  tags: ["feature", "auth", "security"]
})

// Search
memory.search({
  project_root: "/path/to/project",
  query: "authentication"
})
```

### Generate Project Summary

```javascript
// Create snapshot
summary.project({
  project_root: "/path/to/project",
  auto_discover: true,
  include_memory: true,
  include_kb: true
})

// Store the summary
memory.store({
  project_root: "/path/to/project",
  scope: "project-summary",
  content: JSON.stringify(summaryResult),
  tags: ["project-summary"]
})

// Later, check what changed
summary.delta({
  project_root: "/path/to/project"
})
```

### Create Dashboard

```javascript
// Generate dashboard
const result = dashboard.projects({ limit: 20 });

console.log(`Dashboard URL: ${result.dashboard_url}`);
```

## Troubleshooting

### Database Locked

If you see `SQLITE_BUSY` errors:

```javascript
// The server uses WAL mode by default
// Ensure only one server instance is running
```

### Path Not Found

```javascript
// Use absolute paths or ensure current directory is correct
const path = require('path');
const absolutePath = path.resolve('./my-project');

memory.store({
  project_root: absolutePath,
  content: "test"
})
```

### Mismatch Warnings

If you see mismatch warnings:

```javascript
// Check your package.json name matches your expected project_id
// Or provide explicit project_id to override detection
memory.store({
  project_id: "my-preferred-id",
  project_root: "/path/to/project",
  content: "test"
})
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## License

MIT

## Version History

### v1.1.0 (Current)
- ✅ memory.delete — remove outdated memories
- ✅ memory.update — upsert content, tags, expiry
- ✅ memory.list — paginated listing with total_count
- ✅ Tag-based filtering on memory.search
- ✅ FTS5 full-text search on memory (BM25 ranking)
- ✅ KB project scoping (optional project_id)
- ✅ TTL / expiry on memory entries (auto-purge)
- ✅ LRU query cache with mutation invalidation
- ✅ 66 comprehensive tests

### v1.0.0
- ✅ Automatic project_id detection
- ✅ Project switching safety rules
- ✅ Interactive HTML dashboards with Dark/Light mode
- ✅ Interactive Knowledge Base management
- ✅ Markdown rendering support
- ✅ Complete project scoping
- ✅ Path validation and normalization
- ✅ Mismatch detection and warnings
- ✅ 42 comprehensive tests

### v0.x (Legacy)
- Basic memory and KB functionality
- No project scoping
- Manual project_id required

## Support

For issues, questions, or contributions, please open an issue on GitHub.

## Acknowledgments

Built with:
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Fast SQLite driver
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- D.E.R.E.K workflow - Structured development methodology
