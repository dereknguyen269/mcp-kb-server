# MCP Knowledge Base Server - Example Prompts

This guide provides practical examples of how to use the MCP Knowledge Base Server with AI assistants like Claude Desktop, Kiro, or other MCP-compatible clients.

## Table of Contents

- [Getting Started](#getting-started)
- [Memory Management](#memory-management)
- [Project Summaries](#project-summaries)
- [Knowledge Base](#knowledge-base)
- [Dashboards](#dashboards)
- [Workflows](#workflows)
- [Advanced Usage](#advanced-usage)

---

## Getting Started

### Initial Setup

**Prompt:**
```
I'm working on a new project at /Users/me/my-app. 
Store a memory that this is a React + TypeScript web application.
```

**What happens:**
- Auto-detects project_id from directory/package.json
- Stores memory with project scoping
- Returns confirmation with detected project_id

---

## Memory Management

### Storing Important Information

**Prompt:**
```
Store this decision: We're using JWT for authentication instead of sessions 
because we need stateless API support for mobile apps.
Tag it with: architecture, auth, decision
```

**What happens:**
- Stores memory with tags
- Associates with current project
- Searchable later

### Remembering Code Patterns

**Prompt:**
```
Remember this pattern: All API routes should use the validateRequest middleware 
before processing. Example: router.post('/api/users', validateRequest, createUser)
```

**What happens:**
- Stores code pattern
- Can be retrieved when working on similar features

### Storing Bug Fixes

**Prompt:**
```
Store this bug fix: The login form was submitting twice because we had both 
onSubmit on the form and onClick on the button. Solution: Remove onClick from button.
Tag: bug, frontend, forms
```

**What happens:**
- Documents bug and solution
- Prevents repeating same mistake
- Searchable by tags

### Searching Memory

**Prompt:**
```
Search my project memory for anything about authentication
```

**What happens:**
- Searches all memory entries for "authentication"
- Returns relevant entries with context
- Shows tags and timestamps

**Prompt:**
```
What decisions have I made about the database?
```

**What happens:**
- Searches for "database" in memory
- Returns decision entries
- Helps maintain consistency

---

## Project Summaries

### Creating Initial Summary

**Prompt:**
```
Create a comprehensive summary of my project at /Users/me/my-app. 
Include all README files, architecture docs, and my stored memories.
```

**What happens:**
- Auto-discovers instruction files
- Includes memory entries
- Generates comprehensive snapshot
- Stores as project-summary

### Checking What Changed

**Prompt:**
```
What has changed in my project since the last summary?
```

**What happens:**
- Compares current state vs last summary
- Shows new files, updated docs, new memories
- Highlights conflicts or changes

### Regular Project Updates

**Prompt:**
```
Generate a delta summary for my project and store it. 
I want to track what I've been working on this week.
```

**What happens:**
- Creates delta summary
- Stores as memory entry
- Tracks project evolution

---

## Knowledge Base

### Adding Documentation

**Prompt:**
```
Add this API documentation to the knowledge base:
Title: User Authentication API
Content: [paste your API docs]
Source: docs/api/auth.md
```

**What happens:**
- Stores in knowledge base
- Indexed for full-text search
- Available across all projects

### Searching Documentation

**Prompt:**
```
Search the knowledge base for information about JWT token expiration
```

**What happens:**
- Full-text search across all KB documents
- Returns relevant excerpts
- Shows source references

### Storing Code Snippets

**Prompt:**
```
Add this to the knowledge base:
Title: React Custom Hook - useLocalStorage
Content: [paste hook code]
This is a reusable hook for syncing state with localStorage
```

**What happens:**
- Stores reusable code snippet
- Searchable across projects
- Can be referenced later

---

## Dashboards

### Viewing All Projects

**Prompt:**
```
Generate a dashboard showing all my projects and their activity
```

**What happens:**
- Creates HTML dashboard
- Shows all projects with statistics
- Includes recent activity
- Returns HTML file to save

### Detailed Project View

**Prompt:**
```
Create a detailed dashboard showing the last 50 entries for each project
```

**What happens:**
- Generates dashboard with more detail
- Shows extensive recent activity
- Useful for deep project review

### Sharing Project Status

**Prompt:**
```
Generate a dashboard I can share with my team showing our project status
```

**What happens:**
- Creates shareable HTML file
- No sensitive data (just summaries)
- Team can open in any browser

---

## Workflows

### Starting a New Feature

**Prompt:**
```
I'm starting work on a new user profile feature. 
1. Search my memory for any existing user-related code patterns
2. Check if we have any design decisions about user data
3. Store a memory that I'm working on this feature today
```

**What happens:**
- Searches existing knowledge
- Retrieves relevant decisions
- Documents current work
- Maintains context

### Daily Standup Preparation

**Prompt:**
```
What have I been working on in the last 3 days? 
Search my project memories and show recent activity.
```

**What happens:**
- Searches recent memories
- Shows what you've been doing
- Helps prepare standup updates

### Code Review Context

**Prompt:**
```
I'm reviewing a PR about authentication. 
Search my memory for our authentication decisions and patterns.
```

**What happens:**
- Retrieves relevant context
- Shows past decisions
- Helps ensure consistency

### Onboarding New Team Member

**Prompt:**
```
Generate a comprehensive project summary including:
- All architecture documentation
- Key decisions from memory
- Code patterns we follow
Then create a dashboard showing project structure.
```

**What happens:**
- Creates complete project overview
- Visual dashboard for exploration
- Helps new team members get up to speed

### End of Sprint Review

**Prompt:**
```
Create a delta summary showing what changed this sprint.
Include all new memories and updated documentation.
```

**What happens:**
- Shows sprint progress
- Documents changes
- Useful for retrospectives

---

## Advanced Usage

### Multi-Project Context

**Prompt:**
```
I'm working on two related projects: frontend at /Users/me/app-frontend 
and backend at /Users/me/app-backend. 

Store a memory in the frontend project that the API base URL is http://localhost:3000
Store a memory in the backend project that it serves the frontend at port 3000
```

**What happens:**
- Stores project-specific memories
- Maintains separate contexts
- Prevents cross-project confusion

### Architecture Decision Records

**Prompt:**
```
Store this ADR (Architecture Decision Record):
Decision: Use PostgreSQL instead of MongoDB
Context: We need ACID transactions for financial data
Alternatives: MongoDB, MySQL
Rationale: PostgreSQL has best JSON support + ACID guarantees
Tag: adr, database, architecture
```

**What happens:**
- Documents decision with full context
- Searchable by ADR tag
- Maintains decision history

### Bug Investigation

**Prompt:**
```
I'm investigating a bug where users can't log in.
1. Search memory for previous login-related bugs
2. Search KB for authentication documentation
3. Store this investigation so I don't forget what I tried
```

**What happens:**
- Retrieves historical context
- Finds relevant documentation
- Documents investigation process

### Refactoring Planning

**Prompt:**
```
I'm planning to refactor the authentication system.
1. Create a project summary to capture current state
2. Search memory for all auth-related decisions
3. Store a memory about the refactoring plan
```

**What happens:**
- Captures baseline
- Retrieves context
- Documents plan
- Can compare after refactoring

### Learning and Documentation

**Prompt:**
```
I just learned that React 18 has automatic batching.
Add this to the knowledge base with examples so I can reference it later.
```

**What happens:**
- Stores learning in KB
- Available across projects
- Builds personal knowledge base

### Project Handoff

**Prompt:**
```
I'm handing off this project to another developer.
1. Generate a comprehensive project summary
2. Create a dashboard showing all activity
3. Search memory for any gotchas or important notes
```

**What happens:**
- Complete project documentation
- Visual overview
- Important context captured
- Smooth handoff

---

## Prompt Templates

### For Storing Decisions

```
Store this decision: [DECISION]
Context: [WHY IT WAS NEEDED]
Alternatives: [WHAT ELSE WAS CONSIDERED]
Rationale: [WHY THIS WAS CHOSEN]
Tag: decision, [RELEVANT TAGS]
```

### For Storing Patterns

```
Remember this pattern: [PATTERN DESCRIPTION]
Example: [CODE EXAMPLE]
Use when: [WHEN TO USE IT]
Tag: pattern, [RELEVANT TAGS]
```

### For Storing Bugs

```
Store this bug fix: [BUG DESCRIPTION]
Symptoms: [WHAT WAS HAPPENING]
Root cause: [WHY IT HAPPENED]
Solution: [HOW IT WAS FIXED]
Tag: bug, [RELEVANT TAGS]
```

### For Project Reviews

```
Generate a project summary for [PROJECT PATH]
Include: architecture docs, decisions, recent changes
Then create a dashboard showing activity
```

### For Context Retrieval

```
I'm working on [FEATURE/BUG].
Search memory for:
- Related decisions
- Similar patterns
- Previous bugs
- Relevant documentation
```

---

## Tips for Effective Usage

### 1. Be Specific with Tags

**Good:**
```
Tag: auth, jwt, security, api
```

**Less Good:**
```
Tag: stuff, important
```

### 2. Include Context

**Good:**
```
Store: We're using Redis for session storage because we need 
distributed sessions across multiple servers. Alternative was 
sticky sessions but that doesn't work with our load balancer.
```

**Less Good:**
```
Store: Using Redis for sessions
```

### 3. Regular Summaries

**Good Practice:**
```
Every Friday: "Generate a delta summary showing this week's changes"
```

**Why:** Tracks progress, maintains context, helps with reviews

### 4. Search Before Storing

**Good Practice:**
```
Before making a decision: "Search memory for existing decisions about [TOPIC]"
```

**Why:** Maintains consistency, avoids contradictions

### 5. Use Dashboards for Overview

**Good Practice:**
```
Monthly: "Generate a dashboard showing all projects and their health"
```

**Why:** Visual overview, identifies stale projects, tracks activity

---

## Common Scenarios

### Scenario 1: Starting Your Day

**Prompt:**
```
What was I working on yesterday? Show my recent project activity.
```

### Scenario 2: Context Switch

**Prompt:**
```
I'm switching from project A to project B. 
Generate a summary of project B to refresh my memory.
```

### Scenario 3: Making a Decision

**Prompt:**
```
I need to decide between REST and GraphQL for our API.
1. Search memory for any existing API decisions
2. Search KB for API documentation
3. After I decide, store the decision with full context
```

### Scenario 4: Bug Hunting

**Prompt:**
```
I'm seeing a bug with form validation.
Search memory for previous form-related bugs and their solutions.
```

### Scenario 5: Code Review

**Prompt:**
```
I'm reviewing a PR that changes our error handling.
Search memory for our error handling patterns and decisions.
```

### Scenario 6: Documentation

**Prompt:**
```
Generate a comprehensive project summary and dashboard.
I need to document the current state for the team.
```

---

## Integration Examples

### With Kiro IDE

```
# In Kiro chat:
"Store a memory that we're using Tailwind CSS for styling"

# Kiro will:
- Auto-detect project from current workspace
- Store memory with project scoping
- Confirm storage
```

### With Claude Desktop

```
# In Claude Desktop:
"Search my project memory for authentication patterns"

# Claude will:
- Use MCP to search memory
- Return relevant entries
- Provide context and examples
```

### With Custom Scripts

```javascript
// Node.js script using MCP client
const result = await mcpClient.callTool('memory.search', {
  project_root: process.cwd(),
  query: 'authentication'
});

console.log(result);
```

---

## Best Practices

### 1. Consistent Tagging

Create a tagging system:
- `decision` - Architecture decisions
- `pattern` - Code patterns
- `bug` - Bug fixes
- `feature` - Feature notes
- `config` - Configuration notes
- `gotcha` - Important gotchas

### 2. Regular Summaries

Schedule regular summaries:
- **Daily**: Quick delta summary
- **Weekly**: Comprehensive summary
- **Monthly**: Dashboard review

### 3. Search First

Before storing, search to:
- Avoid duplicates
- Find related information
- Maintain consistency

### 4. Rich Context

Always include:
- **What**: What was done
- **Why**: Why it was done
- **How**: How it was implemented
- **When**: Timestamp (automatic)

### 5. Use Scopes

Organize by scope:
- `default` - General notes
- `project-summary` - Summaries
- `adr` - Architecture decisions
- `bug-fix` - Bug fixes

---

## Troubleshooting Prompts

### Can't Find Information

**Prompt:**
```
I can't find information about [TOPIC].
1. Search memory with different keywords
2. Search knowledge base
3. Generate a project summary to see if it's in docs
```

### Wrong Project Context

**Prompt:**
```
I think you're using the wrong project context.
My current project is at [PATH]. 
Search memory for this specific project.
```

### Need to See Everything

**Prompt:**
```
Generate a dashboard showing all my projects.
I need to see what data exists across all projects.
```

---

## Quick Reference

### Memory Commands
- `Store a memory that...`
- `Remember that...`
- `Search my memory for...`
- `What do I know about...`

### Summary Commands
- `Generate a project summary`
- `What changed since last summary?`
- `Create a delta summary`
- `Summarize my project`

### Dashboard Commands
- `Generate a dashboard`
- `Show all my projects`
- `Create a visual overview`
- `Dashboard with recent activity`

### Knowledge Base Commands
- `Add to knowledge base...`
- `Search knowledge base for...`
- `Store this documentation...`
- `Find information about...`

---

## Example Session

Here's a complete example session showing typical usage:

```
You: I'm starting a new React project at /Users/me/my-app

AI: I'll help you set up. Let me store some initial context.
[Stores memory about new React project]

You: Store a memory that we're using TypeScript, Tailwind CSS, and Vite

AI: Stored! I've noted your tech stack.
[Stores memory with tags: tech-stack, typescript, tailwind, vite]

You: I'm implementing authentication. Search my memory for any auth patterns

AI: I found 3 relevant entries:
1. JWT pattern from previous project
2. Decision to use httpOnly cookies
3. Auth middleware pattern
[Returns search results]

You: Great! Store a memory that I'm using the JWT + httpOnly cookie pattern for this project

AI: Stored! I've documented your authentication approach.
[Stores memory with tags: auth, jwt, cookies, decision]

You: Generate a project summary so I have a baseline

AI: I've created a comprehensive summary including:
- Tech stack (React, TypeScript, Tailwind, Vite)
- Authentication approach (JWT + httpOnly cookies)
- Project structure
[Generates and stores summary]

You: Create a dashboard showing my project status

AI: I've generated an HTML dashboard. Here's what it shows:
- 1 project (my-app)
- 4 memory entries
- Latest summary from today
[Returns HTML dashboard]
```

---

## Conclusion

The MCP Knowledge Base Server is most powerful when used consistently throughout your development workflow. Start with simple memory storage, gradually add summaries and dashboards, and build up your project knowledge over time.

Remember: The more context you provide, the more helpful the AI can be in maintaining consistency and helping you make informed decisions.

Happy coding! 🚀
