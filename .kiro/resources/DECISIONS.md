# Decision Log

## Purpose

This document tracks significant technical and architectural decisions made during development. Each decision includes context, alternatives considered, rationale, and impact assessment.

## Decision Index

| ID | Date | Decision | Status | Reversible |
|----|------|----------|--------|------------|
| D001 | 2026-01-19 | D.E.R.E.K Memory System | ✅ Active | Yes |
| D002 | 2024 | Project Scoping Implementation | ✅ Active | No |
| D003 | 2024 | SQLite for Storage | ✅ Active | Difficult |
| D004 | 2024 | Synchronous Database API | ✅ Active | Yes |
| D005 | 2024 | ES Modules | ✅ Active | Difficult |

---

## D001: D.E.R.E.K Memory System

**Date**: 2026-01-19  
**Status**: ✅ Active  
**Category**: Development Workflow

### Decision
Adopt D.E.R.E.K (Design · Evaluate · Review · Execute · Knowledge) structured development workflow with persistent memory system in `.kiro/resources/`.

### Context
- Need for structured approach to prevent "vibe coding"
- Requirement for context retention across sessions
- Desire for explicit approval gates before code changes
- Need to track decisions, progress, and learnings

### Alternatives Considered
1. **Ad-hoc development**: No structure, just code
2. **README-only documentation**: Single file for everything
3. **External project management tools**: Jira, Trello, etc.

### Rationale
- D.E.R.E.K provides structured workflow with approval gates
- Persistent memory files enable context retention
- Markdown files are version-controllable and human-readable
- Integrated with development environment (Kiro)
- Supports both quick tasks and complex feature planning

### Impact
- **Positive**: Better planning, fewer mistakes, knowledge retention
- **Neutral**: Requires discipline to maintain files
- **Negative**: Slight overhead for very simple tasks

### Reversible
Yes - Can remove `.kiro/resources/` and return to ad-hoc development

---

## D002: Project Scoping Implementation

**Date**: 2024 (exact date unknown)  
**Status**: ✅ Active  
**Category**: Architecture

### Decision
Implement full project scoping with required `project_id` parameter on all memory and summary tools.

### Context
- Bug: Cross-project data contamination when multiple projects used same MCP server
- Delta summaries were comparing data across different projects
- No isolation between projects

### Alternatives Considered
1. **Separate database per project**: More complex, harder to manage
2. **Optional project_id**: Wouldn't enforce isolation
3. **Client-side filtering**: Not reliable, security risk

### Rationale
- Required parameter enforces isolation at tool level
- Database-level filtering with indexes ensures performance
- Backward compatible via `project_id = 'legacy'` for old data
- Explicit is better than implicit

### Impact
- **Positive**: Complete project isolation, accurate delta summaries
- **Neutral**: Breaking API change (requires client updates)
- **Negative**: None significant

### Reversible
No - Would break existing clients and lose isolation guarantees

---

## D003: SQLite for Storage

**Date**: 2024 (exact date unknown)  
**Status**: ✅ Active  
**Category**: Technology Choice

### Decision
Use SQLite (via better-sqlite3) for persistent storage instead of in-memory or other databases.

### Context
- Need for persistent storage across server restarts
- MCP server is single-process, local to user's machine
- No need for network database or multi-user access

### Alternatives Considered
1. **In-memory storage**: Lost on restart
2. **PostgreSQL/MySQL**: Overkill for local single-user
3. **JSON files**: Poor query performance, no transactions
4. **LevelDB/RocksDB**: More complex, less SQL-friendly

### Rationale
- SQLite is perfect for local, single-user applications
- Full SQL support with indexes for fast queries
- Zero configuration, no separate server process
- Excellent Node.js support via better-sqlite3
- ACID transactions built-in

### Impact
- **Positive**: Reliable, fast, zero-config persistence
- **Neutral**: File-based storage in `data/` directory
- **Negative**: Not suitable for multi-user (not a requirement)

### Reversible
Difficult - Would require data migration and significant refactoring

---

## D004: Synchronous Database API

**Date**: 2024 (exact date unknown)  
**Status**: ✅ Active  
**Category**: Implementation

### Decision
Use better-sqlite3's synchronous API instead of async alternatives.

### Context
- better-sqlite3 offers both sync and async APIs
- MCP server handles one request at a time (stdio protocol)
- No concurrent request handling needed

### Alternatives Considered
1. **Async API**: More "Node.js idiomatic" but unnecessary complexity
2. **Different driver**: Other drivers are slower or less maintained

### Rationale
- Synchronous code is simpler and easier to reason about
- No performance penalty (single-threaded request handling)
- better-sqlite3 sync API is actually faster than async alternatives
- Reduces callback/promise complexity

### Impact
- **Positive**: Simpler code, better performance
- **Neutral**: Less "idiomatic" for Node.js developers
- **Negative**: None for this use case

### Reversible
Yes - Could switch to async API with moderate refactoring

---

## D005: ES Modules

**Date**: 2024 (exact date unknown)  
**Status**: ✅ Active  
**Category**: Technology Choice

### Decision
Use ES Modules (`import`/`export`) instead of CommonJS (`require`/`module.exports`).

### Context
- Node.js ≥18 has excellent ES Module support
- Modern JavaScript standard
- Better static analysis and tree-shaking

### Alternatives Considered
1. **CommonJS**: Traditional Node.js module system
2. **Mixed approach**: Some ESM, some CJS (confusing)

### Rationale
- ES Modules are the future of JavaScript
- Better tooling support and static analysis
- Cleaner syntax
- Required `"type": "module"` in package.json

### Impact
- **Positive**: Modern, clean, future-proof
- **Neutral**: Requires Node.js ≥18 (acceptable requirement)
- **Negative**: Some older tools may not support ESM

### Reversible
Difficult - Would require rewriting all imports/exports

---

## Template for New Decisions

```markdown
## DXXX: [Decision Title]

**Date**: YYYY-MM-DD  
**Status**: 🟡 Proposed / ✅ Active / 🔴 Deprecated  
**Category**: Architecture / Technology / Process / etc.

### Decision
[What was decided]

### Context
[Why this decision was needed]

### Alternatives Considered
1. **Option 1**: Description
2. **Option 2**: Description

### Rationale
[Why this decision was made]

### Impact
- **Positive**: [Benefits]
- **Neutral**: [Neutral effects]
- **Negative**: [Drawbacks]

### Reversible
Yes/No/Difficult - [Explanation]
```


---

## D006: Automatic project_id Detection

**Date**: 2026-01-19  
**Status**: ✅ Active  
**Category**: Developer Experience

### Decision
Implement automatic project_id detection from project_root, making project_id optional when project_root is provided.

### Context
- Users must manually provide `project_id` for every tool call
- This creates friction and repetitive boilerplate
- project_root is already required for summary tools
- Detection can be reliable using multiple strategies

### Alternatives Considered
1. **Keep project_id required**: Simple but poor UX
2. **Use environment variable**: Not portable across projects
3. **Global configuration file**: Adds complexity, not per-project

### Rationale
- Reduces friction for common use case (single project)
- Detection strategies are reliable (package.json → git → directory)
- Explicit project_id still works for edge cases
- Backward compatible (existing code still works)
- Sanitization ensures valid identifiers

### Impact
- **Positive**: Better UX, less boilerplate, easier to use
- **Neutral**: Adds detection logic, minimal performance impact
- **Negative**: None significant (explicit override available)

### Reversible
Yes - Could make project_id required again, but would break new usage patterns


---

## D007: Project Switching Safety Rules

**Date**: 2026-01-19  
**Status**: ✅ Active  
**Category**: Security / Data Integrity

### Decision
Implement comprehensive safety rules to validate project_root paths and detect mismatches between explicit and auto-detected project_id values.

### Context
- With auto-detection, users might accidentally use wrong project_root
- Risk of cross-project data contamination
- Need early error detection for invalid paths
- Need to warn when configuration may be incorrect

### Alternatives Considered
1. **No validation**: Trust user input (risky)
2. **Validation only**: Check paths but no mismatch detection
3. **Strict mode**: Reject mismatches instead of warning

### Rationale
- Validation prevents most common errors (typos, non-existent paths)
- Mismatch detection helps identify configuration issues
- Warnings (not errors) for mismatches preserve flexibility
- Path normalization ensures consistency across platforms
- Rich metadata aids debugging and auditing

### Impact
- **Positive**: Prevents data contamination, early error detection, better debugging
- **Neutral**: Slight performance overhead for validation (negligible)
- **Negative**: None significant (all backward compatible)

### Reversible
Yes - Could remove validation, but would lose safety benefits


---

## D008: Summary-per-project Dashboards

**Date**: 2026-01-19  
**Status**: ✅ Active  
**Category**: User Experience / Visualization

### Decision
Create an interactive HTML dashboard tool that provides visual overview of all projects, their memory entries, summaries, and activity.

### Context
- No easy way to see what data exists for each project
- Users want visual overview of project status
- Need to share project information with team
- Want to monitor activity across projects

### Alternatives Considered
1. **JSON-only output**: Simple but not visual
2. **External dashboard app**: Complex, requires separate server
3. **CLI tool**: Limited interactivity
4. **Static HTML**: Chosen - self-contained, shareable, interactive

### Rationale
- Self-contained HTML requires no server or dependencies
- Interactive search/filter improves usability
- Visual design makes data easier to understand
- Shareable - can send file to anyone
- Secure - XSS protection, no external resources
- Fast - efficient queries, optimized rendering

### Impact
- **Positive**: Better visibility, easy sharing, no setup required
- **Neutral**: Adds new tool, increases codebase slightly
- **Negative**: None significant (read-only, optional feature)

### Reversible
Yes - Can remove tool without affecting other functionality
