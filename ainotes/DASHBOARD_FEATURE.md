# Project Dashboard Feature

## Overview

The MCP Knowledge Base Server now includes an interactive HTML dashboard that provides a visual overview of all projects, their memory entries, summaries, and activity.

## What's New

### New Tool: `dashboard.projects`

Generates a comprehensive HTML dashboard showing:
- **Project Statistics**: Total projects, memory entries, summaries, KB documents
- **Per-Project Views**: Memory counts, recent activity, latest summaries
- **Interactive Features**: Search/filter projects, responsive design
- **Visual Design**: Modern gradient UI with cards and badges

## Usage

### Generate Dashboard

```javascript
// Basic usage
dashboard.projects({})

// With custom limit for recent entries
dashboard.projects({ limit: 20 })
```

### Response Format

```javascript
{
  projects: [
    {
      project_id: "my-project",
      total_entries: 42,
      summary_count: 3,
      last_activity: "2026-01-19T..."
    }
  ],
  kb_documents: 15,
  html_dashboard: "<!DOCTYPE html>...",
  instructions: "Use the 'html_dashboard' field to save as an HTML file..."
}
```

### Save Dashboard to File

```javascript
const result = dashboard.projects({});
fs.writeFileSync('dashboard.html', result.html_dashboard);
// Open dashboard.html in browser
```

## Dashboard Features

### 1. Overview Statistics

Top-level metrics displayed in cards:
- **Total Projects**: Number of unique projects
- **Total Memory Entries**: Sum of all memory entries across projects
- **Project Summaries**: Count of project summary entries
- **KB Documents**: Total documents in knowledge base

### 2. Project Cards

Each project displays:
- **Project Name**: Prominently displayed with color
- **Entry Count**: Total memory entries badge
- **Summary Count**: Number of summaries badge (if any)
- **Latest Summary**: Most recent project summary with timestamp
- **Recent Activity**: Configurable number of recent entries

### 3. Interactive Search

- **Real-time Filtering**: Search projects by name or content
- **Instant Results**: No page reload needed
- **Highlight Matches**: Filtered projects remain visible

### 4. Entry Details

Each memory entry shows:
- **Scope**: Entry scope (default, project-summary, etc.)
- **Timestamp**: When the entry was created
- **Content**: Entry content (truncated if long)
- **Tags**: Visual tags for categorization

### 5. Visual Design

- **Modern Gradient**: Purple gradient background
- **Card-Based Layout**: Clean, organized cards
- **Responsive**: Works on desktop and mobile
- **Hover Effects**: Interactive feedback
- **Color-Coded Badges**: Different colors for different metrics

## Dashboard Sections

### Header
```
🗂️ MCP Knowledge Base Dashboard
Generated: 2026-01-19T...
```

### Statistics Grid
```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│ Total Projects  │ Total Memory    │ Project         │ KB Documents    │
│       5         │ Entries: 127    │ Summaries: 8    │      15         │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

### Search Bar
```
🔍 Search projects...
```

### Project Cards
```
┌─────────────────────────────────────────────────────────────────┐
│ my-awesome-project                    [42 entries] [3 summaries]│
├─────────────────────────────────────────────────────────────────┤
│ 📊 Latest Summary (Jan 19, 2026, 10:30 AM)                     │
│ Project overview: This project implements...                    │
├─────────────────────────────────────────────────────────────────┤
│ 📝 Recent Activity                                              │
│                                                                 │
│ ┌─ default ──────────────────────── Jan 19, 2026, 10:25 AM ─┐ │
│ │ Added new feature for user authentication...               │ │
│ │ [feature] [auth]                                           │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─ project-summary ──────────────── Jan 19, 2026, 10:20 AM ─┐ │
│ │ Updated project summary with latest changes...             │ │
│ │ [project-summary]                                          │ │
│ └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Use Cases

### 1. Project Overview

**Scenario**: Get a quick overview of all projects

```javascript
const result = dashboard.projects({});
console.log(`Total projects: ${result.projects.length}`);
console.log(`Total entries: ${result.projects.reduce((sum, p) => sum + p.total_entries, 0)}`);

// Save HTML for viewing
fs.writeFileSync('overview.html', result.html_dashboard);
```

### 2. Recent Activity Monitoring

**Scenario**: See what's been happening across projects

```javascript
// Show last 20 entries per project
const result = dashboard.projects({ limit: 20 });

// Open in browser to see recent activity
fs.writeFileSync('activity.html', result.html_dashboard);
```

### 3. Project Health Check

**Scenario**: Identify projects with summaries vs those without

```javascript
const result = dashboard.projects({});

const withSummaries = result.projects.filter(p => p.summary_count > 0);
const withoutSummaries = result.projects.filter(p => p.summary_count === 0);

console.log(`Projects with summaries: ${withSummaries.length}`);
console.log(`Projects needing summaries: ${withoutSummaries.length}`);
```

### 4. Data Audit

**Scenario**: Review all data for a specific project

```javascript
const result = dashboard.projects({ limit: 100 });

// Open HTML and use search to filter to specific project
fs.writeFileSync('audit.html', result.html_dashboard);
// In browser: Search for "my-project"
```

### 5. Sharing Project Status

**Scenario**: Share project status with team

```javascript
const result = dashboard.projects({});

// Save dashboard
fs.writeFileSync('project-status.html', result.html_dashboard);

// Share file with team - they can open in any browser
// No server needed, fully self-contained HTML
```

## Technical Details

### HTML Generation

The dashboard is a fully self-contained HTML file:
- **No External Dependencies**: All CSS and JavaScript embedded
- **Offline Capable**: Works without internet connection
- **Cross-Platform**: Opens in any modern browser
- **Responsive**: Adapts to screen size

### Security

- **XSS Protection**: All user content is HTML-escaped
- **No External Resources**: No CDN dependencies
- **Read-Only**: Dashboard doesn't modify data
- **Safe to Share**: No sensitive credentials embedded

### Performance

- **Efficient Queries**: Uses indexed database queries
- **Configurable Limits**: Control number of entries shown
- **Lazy Loading**: Only loads what's needed
- **Fast Rendering**: Optimized HTML generation

### Data Freshness

- **Snapshot**: Dashboard shows data at generation time
- **Regenerate**: Run tool again to get latest data
- **Timestamps**: All entries show creation time
- **Last Activity**: Projects sorted by most recent activity

## Implementation Details

### Tool Schema

```javascript
{
  name: "dashboard.projects",
  inputSchema: {
    type: "object",
    properties: {
      limit: { 
        type: "number", 
        default: 10,
        description: "Number of recent entries to show per project" 
      }
    }
  }
}
```

### Database Queries

**Project Statistics**:
```sql
SELECT 
  project_id,
  COUNT(*) as total_entries,
  SUM(CASE WHEN scope = 'project-summary' THEN 1 ELSE 0 END) as summary_count,
  MAX(created_at) as last_activity
FROM memory
GROUP BY project_id
ORDER BY last_activity DESC
```

**Recent Entries**:
```sql
SELECT id, scope, content, tags, created_at
FROM memory
WHERE project_id = ?
ORDER BY created_at DESC
LIMIT ?
```

**Latest Summary**:
```sql
SELECT content, created_at
FROM memory
WHERE project_id = ? AND scope = 'project-summary'
ORDER BY created_at DESC
LIMIT 1
```

### HTML Structure

```html
<!DOCTYPE html>
<html>
  <head>
    <style>/* Embedded CSS */</style>
  </head>
  <body>
    <div class="container">
      <div class="header">...</div>
      <div class="stats-grid">...</div>
      <div class="filter-bar">...</div>
      <div class="projects-grid">...</div>
    </div>
    <script>/* Embedded JavaScript */</script>
  </body>
</html>
```

## Testing

All 7 dashboard tests pass:

- ✅ Returns project statistics
- ✅ Generates HTML
- ✅ Respects limit parameter
- ✅ Shows project summaries
- ✅ Handles empty database
- ✅ Includes KB document count
- ✅ Escapes HTML in content (XSS protection)

## Examples

### Example 1: Basic Dashboard

```javascript
const result = dashboard.projects({});
fs.writeFileSync('dashboard.html', result.html_dashboard);
```

**Output**: Interactive HTML dashboard with all projects

### Example 2: Detailed View

```javascript
const result = dashboard.projects({ limit: 50 });
fs.writeFileSync('detailed-dashboard.html', result.html_dashboard);
```

**Output**: Dashboard showing up to 50 recent entries per project

### Example 3: Programmatic Analysis

```javascript
const result = dashboard.projects({});

// Find most active project
const mostActive = result.projects.reduce((max, p) => 
  p.total_entries > max.total_entries ? p : max
);

console.log(`Most active project: ${mostActive.project_id}`);
console.log(`Entries: ${mostActive.total_entries}`);
console.log(`Last activity: ${mostActive.last_activity}`);
```

## Future Enhancements

Potential improvements:
1. **Export Options**: JSON, CSV, PDF export
2. **Time Range Filters**: Show activity for specific date ranges
3. **Charts**: Visual charts for trends over time
4. **Comparison View**: Compare multiple projects side-by-side
5. **Auto-Refresh**: Periodic dashboard updates
6. **Custom Themes**: Light/dark mode, custom colors
7. **Drill-Down**: Click to see full entry details
8. **Pagination**: Handle very large datasets

## Benefits

1. **Visual Overview**: See all projects at a glance
2. **No Setup**: Self-contained HTML, no server needed
3. **Shareable**: Send HTML file to anyone
4. **Interactive**: Search and filter in real-time
5. **Secure**: XSS protection, no external dependencies
6. **Fast**: Efficient queries, optimized rendering
7. **Responsive**: Works on any device
8. **Offline**: No internet connection required

## Migration

No migration needed! This is a new feature that doesn't affect existing functionality.

```javascript
// Old code still works
memory.store({ project_id: "my-project", content: "test" })
memory.search({ project_id: "my-project", query: "test" })

// New dashboard tool available
dashboard.projects({})
```
