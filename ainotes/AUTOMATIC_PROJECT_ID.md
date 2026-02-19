# Automatic project_id Detection

## Overview

The MCP Knowledge Base Server now automatically detects `project_id` from `project_root`, eliminating the need to manually specify it for every tool call.

## What Changed

### Before (Required project_id)
```javascript
// Memory tools
memory.store({ project_id: "my-project", content: "test" })
memory.search({ project_id: "my-project", query: "test" })

// Summary tools
summary.project({ 
  project_id: "my-project", 
  project_root: "/path/to/project" 
})
summary.delta({ 
  project_id: "my-project", 
  project_root: "/path/to/project" 
})
```

### After (Auto-detected)
```javascript
// Memory tools - provide project_root for auto-detection
memory.store({ 
  project_root: "/path/to/project", 
  content: "test" 
})
memory.search({ 
  project_root: "/path/to/project", 
  query: "test" 
})

// Summary tools - project_id auto-detected from project_root
summary.project({ 
  project_root: "/path/to/project" 
})
summary.delta({ 
  project_root: "/path/to/project" 
})

// Explicit project_id still works
memory.store({ 
  project_id: "custom-id", 
  project_root: "/path/to/project", 
  content: "test" 
})
```

## Detection Strategy

The system detects `project_id` using multiple strategies in order:

1. **package.json "name" field** (most reliable for Node.js projects)
   - Reads `package.json` in project_root
   - Uses the "name" field if present

2. **Git remote URL** (for git repositories)
   - Runs `git remote get-url origin`
   - Extracts repository name from URL
   - Examples:
     - `https://github.com/user/repo.git` → `repo`
     - `git@github.com:user/repo.git` → `repo`

3. **Directory basename** (fallback)
   - Uses the directory name as project_id
   - Always succeeds

### Sanitization

All detected project_ids are sanitized to valid identifiers:
- Converted to lowercase
- Invalid characters replaced with hyphens
- Leading/trailing hyphens removed
- Multiple hyphens collapsed to single hyphen
- Empty results fallback to `"unknown-project"`

**Examples**:
- `"My Project!"` → `"my-project"`
- `"@scope/package"` → `"scope-package"`
- `"project___name"` → `"project-name"`
- `"UPPERCASE"` → `"uppercase"`

## Updated Tool Schemas

### memory.store
```json
{
  "properties": {
    "project_id": { 
      "type": "string", 
      "description": "Project identifier (auto-detected from project_root if not provided)" 
    },
    "project_root": { 
      "type": "string", 
      "description": "Project root directory (required for auto-detection if project_id not provided)" 
    },
    "content": { "type": "string" },
    "scope": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["content"]
}
```

### memory.search
```json
{
  "properties": {
    "project_id": { 
      "type": "string", 
      "description": "Project identifier (auto-detected from project_root if not provided)" 
    },
    "project_root": { 
      "type": "string", 
      "description": "Project root directory (required for auto-detection if project_id not provided)" 
    },
    "query": { "type": "string" },
    "scope": { "type": "string" },
    "limit": { "type": "number", "default": 5 }
  },
  "required": ["query"]
}
```

### summary.project & summary.delta
```json
{
  "properties": {
    "project_id": { 
      "type": "string", 
      "description": "Project identifier (auto-detected from project_root if not provided)" 
    },
    "project_root": { "type": "string" },
    "include_files": { "type": "array", "items": { "type": "string" } },
    "auto_discover": { "type": "boolean", "default": false },
    "include_memory": { "type": "boolean", "default": true },
    "include_kb": { "type": "boolean", "default": true }
  },
  "required": ["project_root"]
}
```

## Benefits

1. **Reduced Boilerplate**: No need to specify project_id repeatedly
2. **Better UX**: More intuitive API for common use case
3. **Backward Compatible**: Explicit project_id still works
4. **Reliable Detection**: Multiple strategies ensure success
5. **Safe Fallback**: Always produces valid identifier

## Edge Cases

### Multiple Projects in Same Directory
If you have multiple projects in the same directory, provide explicit `project_id`:

```javascript
memory.store({ 
  project_id: "project-a", 
  project_root: "/path/to/projects",
  content: "test" 
})
```

### Custom Project Identifiers
If you want a specific project_id different from auto-detection:

```javascript
summary.project({ 
  project_id: "my-custom-id", 
  project_root: "/path/to/project" 
})
```

### No package.json or Git
The system will fallback to directory basename, which always succeeds.

## Testing

All 24 tests pass, including:
- ✅ Detection from package.json
- ✅ Detection from git remote
- ✅ Fallback to directory basename
- ✅ Sanitization of invalid characters
- ✅ Backward compatibility with explicit project_id
- ✅ Error handling for missing parameters

## Implementation Details

### New File: `src/utils/projectId.js`

```javascript
export function detectProjectId(project_root)
export function sanitizeProjectId(raw)
```

### Updated Files
- `src/tools/memory.js` - Auto-detection in both tools
- `src/tools/summary.js` - Auto-detection in summary.project
- `src/tools/summaryDelta.js` - Auto-detection in summary.delta

### New Tests: `test/project-id-detection.test.js`
- 6 comprehensive tests for detection logic

## Migration Guide

### For Existing Code

**Option 1: Keep using explicit project_id** (no changes needed)
```javascript
// This still works exactly as before
memory.store({ project_id: "my-project", content: "test" })
```

**Option 2: Switch to auto-detection**
```javascript
// Remove project_id, add project_root
memory.store({ 
  project_root: "/path/to/project", 
  content: "test" 
})
```

### For Summary Tools

Summary tools already required `project_root`, so you can simply remove `project_id`:

```javascript
// Before
summary.project({ 
  project_id: "my-project", 
  project_root: "/path/to/project" 
})

// After
summary.project({ 
  project_root: "/path/to/project" 
})
```

## Performance

- Detection is fast (< 1ms for package.json)
- Git command may be slower (10-50ms) but only runs if package.json missing
- Directory basename is instant
- No caching implemented (detection runs each time)

## Future Enhancements

Potential improvements for future versions:
1. Cache detected project_id per project_root
2. Support more detection strategies (Cargo.toml, go.mod, etc.)
3. Configuration file for custom detection rules
4. Async detection for better performance
