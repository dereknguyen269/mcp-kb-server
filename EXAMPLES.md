# MCP Knowledge Base Server — Examples

Practical prompts and usage patterns for AI assistants (Kiro, Claude Code, Claude Desktop, etc.).

## Table of Contents

- [Quick Start](#quick-start)
- [Initializing a Project](#initializing-a-project)
- [Memory Management](#memory-management)
- [Knowledge Base](#knowledge-base)
- [Sources](#sources)
- [Wiki Links & Lint](#wiki-links--lint)
- [Dashboard](#dashboard)
- [Workflows](#workflows)
- [Prompt Templates](#prompt-templates)
- [Tips](#tips)

---

## Quick Start

### First time on a project

```
I'm starting work on /Users/me/my-app.
1. Run kb.init to import all markdown docs into the KB
2. Store a memory that this is a React + TypeScript app
3. Open the dashboard so I can browse everything
```

**What happens:**
- `kb.init` scans `**/*.md` and `**/*.txt`, bulk-imports them scoped to the project
- Memory entry stored with auto-detected `project_id`
- Dashboard URL returned — open in browser

---

## Initializing a Project

### Import all docs in one shot

```
Run kb.init on /Users/me/my-app to import all markdown files into the knowledge base.
```

```json
{
  "tool": "kb.init",
  "arguments": {
    "project_root": "/Users/me/my-app"
  }
}
```

Returns:
```json
{
  "project_id": "my-app",
  "scanned": 42,
  "added": 38,
  "skipped": 4,
  "added_titles": ["Getting Started", "API Reference", "Contributing", "..."]
}
```

### Import only specific folders

```
Import only the docs/ and .kiro/resources/ folders from /Users/me/my-app into the KB.
```

```json
{
  "tool": "kb.init",
  "arguments": {
    "project_root": "/Users/me/my-app",
    "patterns": ["docs/**/*.md", ".kiro/resources/*.md"]
  }
}
```

### Re-import after docs update

```
Re-import all docs for /Users/me/my-app, overwriting existing entries.
```

```json
{
  "tool": "kb.init",
  "arguments": {
    "project_root": "/Users/me/my-app",
    "overwrite": true
  }
}
```

---

## Memory Management

### Store a decision

```
Store this decision for my project at /Users/me/my-app:
We use JWT for authentication instead of sessions because we need
stateless API support for mobile clients.
Tag it: architecture, auth, decision
```

### Store a bug fix

```
Remember this bug fix:
The login form was submitting twice — both onSubmit on the form
and onClick on the button were firing. Fix: remove onClick from button.
Tags: bug, frontend, forms
```

### Store a code pattern

```
Remember this pattern: all API routes must use validateRequest middleware
before the handler. Example: router.post('/api/users', validateRequest, createUser)
Tags: pattern, api, validation
```

### Search memory

```
Search my project memory for anything about authentication.
```

```
What decisions have I made about the database schema?
```

```
Find all memories tagged "bug" from the last sprint.
```

### List all memories with pagination

```json
{
  "tool": "memory.list",
  "arguments": {
    "project_root": "/Users/me/my-app",
    "limit": 50,
    "offset": 0,
    "scope": "decisions"
  }
}
```

### Update a memory

```
Update memory entry <uuid> — change the content to reflect that
we switched from JWT to session cookies after the mobile app was dropped.
```

### Set an expiry

```
Store a memory that the staging DB password is "temp1234",
but make it expire in 7 days.
```

---

## Knowledge Base

### Add a single document

```
Add this to the KB for my-app:
Title: Deployment Checklist
Content: [paste checklist]
Source: docs/deploy.md
```

### Search the KB

```
Search the knowledge base for information about rate limiting.
```

### Import from the dashboard

1. Open the dashboard (`dashboard.projects`)
2. Switch to the KB tab
3. Click **Import** in the toolbar
4. Upload a `.json` file:

```json
[
  {
    "title": "Getting Started",
    "content": "## Overview\nThis project uses...",
    "source": "docs/intro.md"
  },
  {
    "title": "API Reference",
    "content": "## POST /api/users\n..."
  }
]
```

Or upload a single `.md` file — it's imported as one document using the filename as title.

### Export KB as Markdown

From the dashboard: click the download icon in the KB sidebar header.

Downloads `kb-{project}-{date}.md`:

```markdown
# Knowledge Base — my-app

> Exported 2026-04-12 · 38 documents

---

## Getting Started

**Source:** docs/intro.md
**ID:** 1

## Overview
This project uses...
```

---

## Sources

### Ingest a file

```
Ingest the file spec.pdf from /Users/me/my-app/docs into the sources layer
for project my-app.
```

```json
{
  "tool": "source.ingest",
  "arguments": {
    "project_root": "/Users/me/my-app",
    "filename": "spec.pdf",
    "content": "<base64-encoded-pdf>",
    "file_type": "pdf"
  }
}
```

### Search sources

```
Search sources for "authentication flow" in my-app.
```

---

## Wiki Links & Lint

### Link a memory to a KB doc

```
Create a wiki link from memory entry <mem-uuid> to KB document 42,
with relation "implements".
```

```json
{
  "tool": "wiki.link",
  "arguments": {
    "project_root": "/Users/me/my-app",
    "source_id": "mem-uuid",
    "source_type": "memory",
    "target_id": "42",
    "target_type": "kb",
    "relation": "implements"
  }
}
```

### Look up links for an entry

```
Show all wiki links for memory entry <uuid> in my-app.
```

### Run a health check

```
Run wiki.lint on /Users/me/my-app and show me any orphans or broken links.
```

Returns:
```json
{
  "orphan_memory": [...],
  "broken_links": [...],
  "stale_sources": [...],
  "summary": "2 orphans, 0 broken links, 1 stale source"
}
```

### Export everything as markdown

```
Export the full wiki for /Users/me/my-app to ./wiki-export.
```

---

## Dashboard

### Open the dashboard

```
Open the dashboard for my projects.
```

```json
{ "tool": "dashboard.projects", "arguments": { "limit": 20 } }
```

Returns a local URL — open it in your browser.

### Auto-start on server boot

Set `DASHBOARD_PORT=4242` in your MCP config env:

```json
{
  "mcpServers": {
    "kb-server": {
      "command": "npx",
      "args": ["mcp-kb-server"],
      "env": { "DASHBOARD_PORT": "4242" }
    }
  }
}
```

Dashboard is then always available at `http://127.0.0.1:4242`.

### Dashboard features at a glance

| Tab | Left panel | Right panel |
|---|---|---|
| KB | Paginated doc list + search | Doc viewer with Edit/Delete |
| Memory | Paginated entry list | Full markdown + Delete |
| Sources | Paginated file list + search | Inline file content |
| Links | Entry ID lookup | Inbound/outbound links |
| Lint | — | Orphans, broken links, stale sources |

Toolbar actions: **New Document**, **Import**, **Export KB**, **Export Memory**, **New Project**, **Delete Project**.

---

## Workflows

### Onboarding a new project

```
I just cloned /Users/me/new-project.
1. Run kb.init to import all docs
2. Generate a project summary
3. Store a memory that I started working on this today
4. Open the dashboard
```

### Starting a feature

```
I'm starting the user profile feature in /Users/me/my-app.
1. Search memory for any existing user-related decisions
2. Search KB for user data documentation
3. Store a memory that I'm working on this feature
```

### Daily standup prep

```
What have I been working on in the last 3 days in /Users/me/my-app?
Search recent memories and show activity.
```

### End of sprint

```
Generate a delta summary for /Users/me/my-app showing what changed this sprint.
Then run wiki.lint to check for any orphaned entries.
```

### Project handoff

```
I'm handing off /Users/me/my-app.
1. Run kb.init with overwrite to refresh all docs
2. Generate a comprehensive project summary
3. Run wiki.lint and fix any broken links
4. Export KB and memory as markdown for the handoff package
5. Open the dashboard
```

### Architecture Decision Record

```
Store this ADR for /Users/me/my-app:
Decision: Use PostgreSQL instead of MongoDB
Context: Need ACID transactions for financial data
Alternatives considered: MongoDB, MySQL
Rationale: Best JSON support + ACID guarantees
Tags: adr, database, architecture, decision
```

### Bug investigation

```
I'm investigating a login bug in /Users/me/my-app.
1. Search memory for previous login-related bugs
2. Search KB for authentication documentation
3. Store a memory documenting what I've tried so far
```

---

## Prompt Templates

### Decision

```
Store this decision for [PROJECT_PATH]:
[DECISION]
Context: [WHY IT WAS NEEDED]
Alternatives: [WHAT ELSE WAS CONSIDERED]
Rationale: [WHY THIS WAS CHOSEN]
Tags: decision, [RELEVANT TAGS]
```

### Pattern

```
Remember this pattern for [PROJECT_PATH]:
[PATTERN DESCRIPTION]
Example: [CODE EXAMPLE]
Use when: [WHEN TO USE IT]
Tags: pattern, [RELEVANT TAGS]
```

### Bug fix

```
Store this bug fix for [PROJECT_PATH]:
Bug: [DESCRIPTION]
Symptoms: [WHAT WAS HAPPENING]
Root cause: [WHY IT HAPPENED]
Fix: [HOW IT WAS RESOLVED]
Tags: bug, [RELEVANT TAGS]
```

### Context retrieval

```
I'm working on [FEATURE/BUG] in [PROJECT_PATH].
Search memory and KB for:
- Related decisions
- Similar patterns
- Previous bugs
- Relevant documentation
```

---

## Tips

### Use specific tags

```
# Good
tags: ["auth", "jwt", "security", "api-design"]

# Too vague
tags: ["stuff", "important"]
```

### Include context in memories

```
# Good
"We switched from REST to GraphQL because the mobile team needed
flexible field selection to reduce payload size on 3G connections."

# Too thin
"Using GraphQL now."
```

### Scope memories by type

Use `scope` to organize entries:

| Scope | What to store |
|---|---|
| `decisions` | Architecture and design choices |
| `patterns` | Reusable code patterns |
| `bugs` | Bug fixes and root causes |
| `notes` | General observations |
| `project-summary` | Snapshots from `summary.project` |

### Use kb.init at session start

Running `kb.init` at the start of a session ensures the AI has the latest docs indexed and searchable — especially useful after pulling new changes.

```
Before we start, run kb.init on /Users/me/my-app to refresh the KB.
```

### Export before deleting a project

```
Before deleting the old-project, export its KB and memory as markdown,
then delete the project from the dashboard.
```
