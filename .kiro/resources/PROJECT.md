# MCP Knowledge Base Server

## 🎯 Quick Summary

**Name**: mcp-kb-server  
**Type**: Model Context Protocol (MCP) Server  
**Domain**: Knowledge Management & Memory Storage  
**Status**: ✅ Production-Ready (v1.0.0)  
**Purpose**: Provides persistent memory and knowledge base capabilities for MCP clients with full project scoping to prevent cross-project contamination

## 🏗️ Technology Stack

### Core Technologies
- **Runtime**: Node.js ≥18
- **Language**: JavaScript (ES Modules)
- **Database**: SQLite3 (via better-sqlite3)
- **Protocol**: Model Context Protocol (MCP)

### Dependencies
```json
{
  "better-sqlite3": "^9.4.5"  // SQLite database driver
}
```

### Infrastructure
- **Storage**: Local SQLite databases in `data/` directory
- **Execution**: CLI tool via `bin` entry point
- **Testing**: Node.js native test runner

## 📐 Architecture

### Pattern
**Service-Oriented Architecture** with tool-based API surface

```
┌─────────────────────────────────────────────────────┐
│                   MCP Client                        │
│              (Kiro, Claude Desktop, etc)            │
└────────────────────┬────────────────────────────────┘
                     │ MCP Protocol
┌────────────────────▼────────────────────────────────┐
│                  src/server.js                      │
│              (MCP Server Handler)                   │
└─────────┬───────────────────────────┬───────────────┘
          │                           │
┌─────────▼──────────┐    ┌──────────▼──────────────┐
│   src/tools/       │    │   src/storage/db.js     │
│   - memory.js      │◄───┤   (Database Layer)      │
│   - kb.js          │    │                         │
│   - summary.js     │    │   data/memory.sqlite    │
│   - summaryDelta.js│    │   data/kb.sqlite        │
└────────────────────┘    └─────────────────────────┘
```

### Directory Structure
```
mcp-kb-server/
├── src/
│   ├── server.js           # MCP server entry point
│   ├── storage/
│   │   └── db.js          # Database initialization & schema
│   └── tools/
│       ├── memory.js      # Long-term memory storage/search
│       ├── kb.js          # Knowledge base add/search
│       ├── summary.js     # Project summary generation
│       └── summaryDelta.js # Delta summary (changes since last)
├── data/                   # SQLite databases (auto-created)
├── test/                   # Node.js test suite
├── config/                 # Configuration files
└── package.json
```

### Key Components

| Component | Purpose | Database |
|-----------|---------|----------|
| **memory.js** | Store/search long-term memory with project scoping | memory.sqlite |
| **kb.js** | Add/search knowledge base documents | kb.sqlite |
| **summary.js** | Generate project snapshots from files + memory + kb | memory.sqlite |
| **summaryDelta.js** | Compare current state vs last summary | memory.sqlite |
| **db.js** | Database initialization, migrations, schema management | Both |

## 🚀 Entry Points

### Application Entry
```bash
# Start MCP server (stdio mode)
npm start

# Or via bin
./src/server.js
```

### Configuration
- **MCP Config**: Clients configure via their MCP settings (e.g., `.kiro/settings/mcp.json`)
- **Database Location**: `data/` directory (auto-created)
- **No environment variables required**

## 💻 Development Commands

### Setup
```bash
npm install
```

### Testing
```bash
npm test                    # Run all tests (18 tests)
node --test test/memory.test.js          # Memory tests
node --test test/kb.test.js              # KB tests
node --test test/summary.test.js         # Summary tests
node --test test/summary-delta.test.js   # Delta tests
node --test test/project-scoping.test.js # Isolation tests
```

### Quality
- **Linting**: Not configured (consider adding ESLint)
- **Formatting**: Not configured (consider adding Prettier)
- **Type Checking**: Not configured (pure JavaScript)

## 📏 Code Conventions

### Naming
- **Files**: kebab-case (`summary-delta.js`)
- **Functions**: camelCase (`createMemoryTools`, `searchMemory`)
- **Constants**: UPPER_SNAKE_CASE (not heavily used)

### Organization
- **Tools**: Each tool exports a factory function that returns MCP tool definitions
- **Database**: Centralized in `db.js` with migration logic
- **Tests**: Mirror source structure (`test/memory.test.js` ↔ `src/tools/memory.js`)

### Patterns
- **ES Modules**: All files use `import`/`export`
- **Factory Functions**: Tools created via factory pattern
- **Synchronous DB**: Uses better-sqlite3 sync API
- **Error Handling**: JSON-RPC error codes (-32602 for invalid params)

## 🔗 External Integrations

### MCP Protocol
- **Version**: Compatible with MCP specification
- **Transport**: stdio (standard input/output)
- **Tools Exposed**: 6 tools (memory.store, memory.search, kb.add, kb.search, summary.project, summary.delta)

### File System
- **Reads**: Project files for summary generation (via `include_files` or `auto_discover`)
- **Writes**: SQLite databases in `data/` directory
- **Discovery**: Scans for common instruction files (README, ARCHITECTURE, etc.)

## ⚠️ Important Notes

### Project Scoping (Critical Feature)
- **All tools require `project_id`**: Prevents cross-project contamination
- **Summary tools require `project_root`**: Uses provided path, not `process.cwd()`
- **Legacy data**: Pre-scoping entries use `project_id = 'legacy'`
- **Isolation**: Projects cannot read each other's data

### Performance
- **Indexed Queries**: `project_id` column is indexed for fast filtering
- **Synchronous DB**: better-sqlite3 is faster than async alternatives for this use case
- **No Connection Pooling**: SQLite handles concurrency internally

### Security
- **Project Boundaries**: Enforced at tool level, no bypass mechanism
- **File Access**: Summary tools only read files, never write
- **SQL Injection**: Parameterized queries prevent injection

### Gotchas
- **Database Location**: `data/` must be writable (auto-created on first run)
- **Migration**: Schema updates run automatically on server start
- **Node Version**: Requires Node.js ≥18 for native test runner
- **MCP Client**: Must be configured to call this server via stdio

### Recent Changes
- ✅ **v1.0.0**: Added full project scoping to fix cross-project contamination bug
- ✅ Added `project_id` to memory schema with indexes
- ✅ Made `project_id` required for all memory/summary tools
- ✅ Added `project_root` parameter to summary tools
- ✅ Comprehensive test coverage (18 tests, 100% pass rate)

## 📚 Documentation
- `PROJECT_SCOPING.md`: Detailed implementation of project scoping feature
- `IMPLEMENTATION_SUMMARY.md`: Summary of recent changes and API updates
- Test files serve as usage examples
