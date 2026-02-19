# Knowledge Base

## Purpose

This document captures finalized learnings, patterns, and best practices discovered during development. It serves as a reference for future work and helps avoid repeating mistakes.

## Quick Reference

### Common Commands
```bash
# Start MCP server
npm start

# Run all tests
npm test

# Run specific test file
node --test test/memory.test.js

# Check Node version
node --version  # Must be ≥18
```

### Database Queries
```javascript
// Search memory for a project
db.prepare(`
  SELECT * FROM memory 
  WHERE project_id = ? 
  AND (content LIKE ? OR tags LIKE ?)
  ORDER BY created_at DESC 
  LIMIT ?
`).all(project_id, `%${query}%`, `%${query}%`, limit);

// Get latest summary for a project
db.prepare(`
  SELECT content FROM memory 
  WHERE project_id = ? 
  AND scope = 'project-summary' 
  ORDER BY created_at DESC 
  LIMIT 1
`).get(project_id);
```

## Architecture Patterns

### Tool Factory Pattern
Each tool file exports a factory function that creates MCP tool definitions:

```javascript
// src/tools/memory.js
export function createMemoryTools(db) {
  return {
    memory_store: {
      description: "Store long-term memory",
      inputSchema: { /* ... */ },
      handler: async (args) => { /* ... */ }
    },
    memory_search: {
      description: "Search long-term memory",
      inputSchema: { /* ... */ },
      handler: async (args) => { /* ... */ }
    }
  };
}
```

**Benefits**:
- Dependency injection (database passed in)
- Easy to test (mock database)
- Clean separation of concerns

### Database Migration Pattern
Migrations run automatically on server start:

```javascript
// Check if column exists
const hasColumn = db.prepare(`
  SELECT COUNT(*) as count 
  FROM pragma_table_info('memory') 
  WHERE name = 'project_id'
`).get().count > 0;

// Add column if missing
if (!hasColumn) {
  db.exec(`
    ALTER TABLE memory ADD COLUMN project_id TEXT NOT NULL DEFAULT 'legacy';
    CREATE INDEX idx_memory_project_id ON memory(project_id);
  `);
}
```

**Benefits**:
- Zero-downtime updates
- Backward compatible
- No manual migration steps

### Project Scoping Pattern
All tools enforce project isolation:

```javascript
// Validate project_id
if (typeof project_id !== 'string' || !project_id) {
  throw new Error('project_id must be a non-empty string');
}

// Filter by project_id in all queries
WHERE project_id = ?
```

**Benefits**:
- Complete data isolation
- Prevents cross-project contamination
- Explicit project identity

## Gotchas & Pitfalls

### Database

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Database locked** | `SQLITE_BUSY` error | Use WAL mode: `PRAGMA journal_mode=WAL` |
| **Missing indexes** | Slow queries | Add indexes on frequently queried columns |
| **Schema changes** | Breaking changes | Use migration pattern with version checks |

### MCP Protocol

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Invalid JSON-RPC** | Client errors | Return proper error codes (-32602 for invalid params) |
| **Missing parameters** | Undefined errors | Validate all required parameters upfront |
| **Large responses** | Slow performance | Limit result sets (default: 5 items) |

### Testing

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Test pollution** | Tests affect each other | Use temporary databases per test |
| **Async timing** | Flaky tests | Use synchronous better-sqlite3 API |
| **Missing cleanup** | Temp files left behind | Always clean up in test teardown |

## Useful Snippets

### Debugging: Inspect Database
```javascript
// List all tables
const tables = db.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='table'
`).all();

// Show table schema
const schema = db.prepare(`
  SELECT sql FROM sqlite_master 
  WHERE type='table' AND name=?
`).get('memory');

// Count records by project
const counts = db.prepare(`
  SELECT project_id, COUNT(*) as count 
  FROM memory 
  GROUP BY project_id
`).all();
```

### Performance: Analyze Query
```javascript
// Explain query plan
const plan = db.prepare(`
  EXPLAIN QUERY PLAN
  SELECT * FROM memory WHERE project_id = ?
`).all('test-project');

// Check if index is used
// Look for "USING INDEX" in plan output
```

### Testing: Create Temp Database
```javascript
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Create temp directory
const tempDir = mkdtempSync(join(tmpdir(), 'test-'));

// Initialize database
const db = initializeDatabase(tempDir);

// Cleanup after test
rmSync(tempDir, { recursive: true, force: true });
```

## Lessons Learned

### 1. Project Scoping is Critical
**Problem**: Cross-project contamination caused incorrect delta summaries.

**Solution**: Made `project_id` required on all tools, enforced at database level.

**Lesson**: Always scope data by project/tenant from day one. Retrofitting is harder.

### 2. Synchronous is Simpler
**Problem**: Async code added complexity without benefits.

**Solution**: Used better-sqlite3's synchronous API.

**Lesson**: Don't use async just because it's "idiomatic". Choose based on requirements.

### 3. Migrations Must Be Automatic
**Problem**: Manual migrations are error-prone and forgotten.

**Solution**: Run migrations on server start, check before applying.

**Lesson**: Automate schema updates. Make them idempotent and backward compatible.

### 4. Test with Real Scenarios
**Problem**: Unit tests passed but integration failed.

**Solution**: Added end-to-end tests with multiple projects.

**Lesson**: Test the actual use cases, not just individual functions.

### 5. Explicit is Better Than Implicit
**Problem**: Using `process.cwd()` caused wrong directory to be scanned.

**Solution**: Added explicit `project_root` parameter.

**Lesson**: Don't rely on implicit context. Make parameters explicit.

## External Resources

### Documentation
- [MCP Specification](https://modelcontextprotocol.io/docs)
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [Node.js Test Runner](https://nodejs.org/api/test.html)

### Tools
- [SQLite Browser](https://sqlitebrowser.org/) - GUI for inspecting databases
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) - Debug MCP servers

### Related Projects
- [mcp-memory-service](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) - Official MCP memory server
- [mcp-filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) - File system MCP server

## Pattern Library

### Error Handling Pattern
```javascript
try {
  // Validate inputs
  if (!project_id) {
    throw new Error('project_id is required');
  }
  
  // Execute operation
  const result = db.prepare(query).all(project_id);
  
  // Return success
  return { success: true, data: result };
  
} catch (error) {
  // Return JSON-RPC error
  return {
    error: {
      code: -32602,
      message: error.message
    }
  };
}
```

### Input Validation Pattern
```javascript
// Validate required string
if (typeof project_id !== 'string' || !project_id) {
  throw new Error('project_id must be a non-empty string');
}

// Validate optional number with default
const limit = typeof args.limit === 'number' ? args.limit : 5;

// Validate optional boolean with default
const autoDiscover = args.auto_discover === true;

// Validate array
if (!Array.isArray(tags)) {
  throw new Error('tags must be an array');
}
```

### Database Transaction Pattern
```javascript
// Start transaction
const insert = db.prepare('INSERT INTO memory VALUES (?, ?, ?)');
const update = db.prepare('UPDATE memory SET content = ? WHERE id = ?');

const transaction = db.transaction((items) => {
  for (const item of items) {
    insert.run(item.id, item.content, item.project_id);
  }
});

// Execute transaction (all or nothing)
transaction(items);
```

## Future Improvements

### Potential Enhancements
1. **Vector Search**: Add semantic search using embeddings
2. **Full-Text Search**: Use SQLite FTS5 for better text search
3. **Export/Import**: Allow backing up and restoring memory
4. **Compression**: Compress old entries to save space
5. **TTL**: Add time-to-live for temporary entries

### Code Quality
1. **ESLint**: Add linting for code consistency
2. **Prettier**: Add formatting for code style
3. **TypeScript**: Migrate to TypeScript for type safety
4. **JSDoc**: Add comprehensive documentation comments

### Testing
1. **Coverage**: Add code coverage reporting
2. **Integration Tests**: More end-to-end scenarios
3. **Performance Tests**: Benchmark query performance
4. **Stress Tests**: Test with large datasets

## Version History

### v1.0.0 (2024)
- ✅ Initial release with project scoping
- ✅ Memory storage and search
- ✅ Knowledge base add and search
- ✅ Project summary generation
- ✅ Delta summary with project isolation
- ✅ Comprehensive test suite (18 tests)
- ✅ Full documentation

### Future Versions
- v1.1.0: Enhanced search capabilities
- v1.2.0: Export/import functionality
- v2.0.0: TypeScript migration


## Recent Learnings

### Automatic project_id Detection (2026-01-19)

**Pattern**: Multi-strategy detection with fallback

```javascript
// Detection order: package.json → git remote → directory basename
export function detectProjectId(project_root) {
  // 1. Try package.json
  const pkg = readPackageJson(project_root);
  if (pkg?.name) return sanitize(pkg.name);
  
  // 2. Try git remote
  const remote = getGitRemote(project_root);
  if (remote) return sanitize(extractRepoName(remote));
  
  // 3. Fallback to directory name
  return sanitize(path.basename(project_root));
}
```

**Benefits**:
- Reliable: Multiple strategies increase success rate
- Predictable: Clear fallback order
- Safe: Sanitization ensures valid identifiers

**Gotchas**:
- Git commands can be slow (use try/catch)
- Directory names may not be unique (explicit override available)
- Sanitization may change user's expected name

**Testing Strategy**:
- Test each detection strategy independently
- Test fallback chain
- Test sanitization edge cases
- Test with real project structures

### Making Parameters Optional with Auto-Detection

**Pattern**: Optional parameter with detection fallback

```javascript
handler: (args) => {
  let project_id = args?.project_id;
  const project_root = args?.project_root;
  
  // Auto-detect if not provided
  if (!project_id && project_root) {
    expectString(project_root, "project_root");
    project_id = detectProjectId(project_root);
  }
  
  // Validate after detection
  expectString(project_id, "project_id");
  // ... rest of handler
}
```

**Benefits**:
- Backward compatible (explicit still works)
- Better UX (less boilerplate)
- Clear error messages (validation after detection)

**Lesson**: When adding auto-detection, validate AFTER detection, not before. This gives better error messages.


### Project Switching Safety Rules (2026-01-19)

**Pattern**: Validate early, fail fast, provide context

```javascript
// Validation function with clear error messages
export function validateProjectRoot(project_root) {
  // 1. Type check
  if (typeof project_root !== "string" || !project_root.trim()) {
    throw error("project_root must be a non-empty string");
  }
  
  // 2. Normalize path
  const normalized = path.resolve(project_root);
  
  // 3. Check existence
  if (!fs.existsSync(normalized)) {
    throw error(`project_root does not exist: ${project_root}`);
  }
  
  // 4. Check type
  const stats = fs.statSync(normalized);
  if (!stats.isDirectory()) {
    throw error(`project_root is not a directory: ${project_root}`);
  }
  
  return normalized;
}
```

**Benefits**:
- Fails fast with actionable error messages
- Normalizes paths for consistency
- Prevents common mistakes (typos, wrong paths)

**Enhanced Detection with Metadata**:

```javascript
// Returns rich metadata instead of just string
export function detectProjectId(project_root, options = {}) {
  const { explicitProjectId } = options;
  
  // Validate first
  const normalizedRoot = validateProjectRoot(project_root);
  
  // Detect using strategies...
  const detectedId = /* detection logic */;
  const detectionMethod = /* how it was detected */;
  
  // Check for mismatch
  const mismatch = explicitProjectId && 
                   explicitProjectId !== detectedId;
  
  return {
    project_id: detectedId,
    project_root: normalizedRoot,
    detection_method: detectionMethod,
    explicit_mismatch: mismatch || false,
    explicit_project_id: explicitProjectId || null
  };
}
```

**Benefits**:
- Rich metadata for debugging
- Mismatch detection for safety
- Normalized paths for consistency
- Detection method for transparency

**Mismatch Warning Pattern**:

```javascript
// In tool handlers
if (!project_id && project_root) {
  const detection = detectProjectId(project_root, { 
    explicitProjectId: project_id 
  });
  project_id = detection.project_id;
  
  // Warn on mismatch (don't error - preserve flexibility)
  if (detection.explicit_mismatch) {
    console.warn(
      `[SAFETY WARNING] Explicit project_id "${detection.explicit_project_id}" ` +
      `differs from detected "${detection.project_id}" (${detection.detection_method}). ` +
      `Using explicit project_id.`
    );
  }
}
```

**Benefits**:
- Alerts user to potential configuration issues
- Doesn't break existing workflows
- Provides context (detection method)
- Clear action (using explicit)

**Gotchas**:
- Validation adds slight overhead (but prevents bigger issues)
- Symlinks are resolved (may surprise users)
- Relative paths converted to absolute (good for consistency)
- Mismatch warnings go to console (may be missed in logs)

**Testing Strategy**:
- Test each validation check independently
- Test path normalization (relative, absolute, symlinks)
- Test mismatch detection (match, mismatch, no explicit)
- Test error messages are clear and actionable
- Test cross-platform compatibility (Unix/Windows)

**Lesson**: Validation is cheap insurance. Fail fast with clear messages. Return rich metadata for debugging. Warn (don't error) for ambiguous cases.


### Dashboard Generation (2026-01-19)

**Pattern**: Self-contained HTML with embedded CSS/JS

```javascript
// Generate complete HTML dashboard
function generateDashboardHTML(data) {
  return `<!DOCTYPE html>
<html>
<head>
  <style>/* All CSS embedded */</style>
</head>
<body>
  <div class="container">
    ${generateContent(data)}
  </div>
  <script>/* All JavaScript embedded */</script>
</body>
</html>`;
}
```

**Benefits**:
- No external dependencies (CDN, libraries)
- Works offline
- Easy to share (single file)
- Cross-platform (any browser)

**XSS Protection Pattern**:

```javascript
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Always escape user content
html += `<div>${escapeHtml(userContent)}</div>`;
```

**Benefits**:
- Prevents XSS attacks
- Safe to display any user content
- Simple and reliable

**Efficient Dashboard Queries**:

```sql
-- Single query for all project stats
SELECT 
  project_id,
  COUNT(*) as total_entries,
  SUM(CASE WHEN scope = 'project-summary' THEN 1 ELSE 0 END) as summary_count,
  MAX(created_at) as last_activity
FROM memory
GROUP BY project_id
ORDER BY last_activity DESC
```

**Benefits**:
- Single query instead of N queries
- Uses aggregation for efficiency
- Sorted by activity (most recent first)

**Graceful Degradation Pattern**:

```javascript
// Handle missing tables gracefully
let kbStats = { total_documents: 0 };
try {
  kbStats = kbDb.prepare(`SELECT COUNT(*) as total_documents FROM kb`).get();
} catch (err) {
  // KB table might not exist yet
  kbStats = { total_documents: 0 };
}
```

**Benefits**:
- Doesn't crash if table missing
- Returns sensible defaults
- Works with partial data

**Gotchas**:
- HTML generation can be memory-intensive for large datasets
- Embedded CSS/JS increases file size (but improves portability)
- Search is client-side (works for moderate datasets)
- No pagination yet (limit parameter helps)

**Testing Strategy**:
- Test with empty database
- Test with multiple projects
- Test HTML generation
- Test XSS protection (malicious content)
- Test limit parameter
- Test KB stats (with/without KB data)

**Lesson**: Self-contained HTML is powerful for dashboards. Escape all user content. Use efficient aggregation queries. Handle missing data gracefully.
