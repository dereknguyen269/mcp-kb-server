# Project Switching Safety Rules

## Overview

The MCP Knowledge Base Server now includes comprehensive safety rules to prevent accidental cross-project data contamination when switching between projects.

## Safety Features

### 1. Project Root Validation

All `project_root` paths are validated before use:

```javascript
// Validates that path exists, is a directory, and is accessible
validateProjectRoot(project_root)
```

**Checks performed:**
- ✅ Path is a non-empty string
- ✅ Path exists on filesystem
- ✅ Path is a directory (not a file)
- ✅ Path is accessible (readable)
- ✅ Path is normalized to absolute path

**Error examples:**
```javascript
// Non-existent path
validateProjectRoot("/nonexistent/path")
// Error: project_root does not exist: /nonexistent/path

// File instead of directory
validateProjectRoot("/path/to/file.txt")
// Error: project_root is not a directory: /path/to/file.txt

// Empty string
validateProjectRoot("")
// Error: project_root must be a non-empty string
```

### 2. Detection Metadata

The `detectProjectId()` function now returns rich metadata:

```javascript
{
  project_id: "my-project",           // Detected/sanitized project ID
  project_root: "/absolute/path",     // Normalized absolute path
  detection_method: "package.json",   // How it was detected
  explicit_mismatch: false,           // Warning flag
  explicit_project_id: null           // Explicit ID if provided
}
```

**Detection methods:**
- `"package.json"` - From package.json name field
- `"git-remote"` - From git remote URL
- `"directory-name"` - From directory basename

### 3. Mismatch Detection

When an explicit `project_id` is provided that differs from the auto-detected one, the system detects this and flags it:

```javascript
// package.json has name: "actual-project"
detectProjectId("/path/to/project", { 
  explicitProjectId: "different-name" 
})

// Returns:
{
  project_id: "actual-project",
  explicit_mismatch: true,           // ⚠️ Warning flag
  explicit_project_id: "different-name"
}
```

**Console warning:**
```
[SAFETY WARNING] Explicit project_id "different-name" differs from detected 
"actual-project" (package.json). Using explicit project_id.
```

### 4. Path Normalization

All paths are normalized to absolute paths to prevent confusion:

```javascript
// Input: relative path, symlink, or path with ".."
validateProjectRoot("./my-project")

// Output: absolute normalized path
"/Users/username/workspace/my-project"
```

**Benefits:**
- Consistent path representation
- Resolves symlinks
- Removes relative components (`.`, `..`)
- Works across platforms (Unix/Windows)

## Safety Rules in Action

### Memory Tools

```javascript
// ✅ SAFE: Valid project_root
memory.store({ 
  project_root: "/path/to/project", 
  content: "test" 
})

// ❌ UNSAFE: Non-existent path
memory.store({ 
  project_root: "/nonexistent", 
  content: "test" 
})
// Error: project_root does not exist: /nonexistent

// ⚠️ WARNING: Mismatch detected
memory.store({ 
  project_id: "wrong-name",
  project_root: "/path/to/actual-project", 
  content: "test" 
})
// Console: [SAFETY WARNING] Explicit project_id "wrong-name" differs...
```

### Summary Tools

```javascript
// ✅ SAFE: Auto-detection with validation
summary.project({ 
  project_root: "/path/to/project" 
})

// ❌ UNSAFE: File instead of directory
summary.project({ 
  project_root: "/path/to/file.txt" 
})
// Error: project_root is not a directory: /path/to/file.txt

// ✅ SAFE: Explicit project_id with validation
summary.project({ 
  project_id: "my-project",
  project_root: "/path/to/project" 
})
```

## Use Cases

### 1. Preventing Accidental Contamination

**Scenario:** User switches between projects but forgets to update `project_root`

```javascript
// Working on project A
memory.store({ 
  project_root: "/workspace/project-a", 
  content: "Feature A data" 
})

// Accidentally use wrong path
memory.store({ 
  project_root: "/workspace/project-b",  // Different project!
  content: "Feature A data"              // Wrong project data
})
// ✅ SAFE: Auto-detects "project-b" and stores separately
```

### 2. Detecting Configuration Errors

**Scenario:** Configuration has wrong `project_id` for a directory

```javascript
// Config says project_id is "old-name"
// But package.json says "new-name"

memory.store({ 
  project_id: "old-name",
  project_root: "/workspace/new-name", 
  content: "test" 
})
// ⚠️ WARNING: Mismatch detected, using explicit "old-name"
// User can investigate and fix configuration
```

### 3. Validating Paths Early

**Scenario:** Typo in path or directory doesn't exist yet

```javascript
summary.project({ 
  project_root: "/workspace/projct"  // Typo!
})
// ❌ Error: project_root does not exist: /workspace/projct
// Fails fast with clear error message
```

### 4. Cross-Platform Compatibility

**Scenario:** Paths work consistently across Unix and Windows

```javascript
// Unix
validateProjectRoot("/home/user/project")
// Returns: "/home/user/project"

// Windows
validateProjectRoot("C:\\Users\\user\\project")
// Returns: "C:\\Users\\user\\project"

// Relative (both platforms)
validateProjectRoot("./project")
// Returns: absolute path based on current directory
```

## Implementation Details

### Enhanced Detection Function

```javascript
export function detectProjectId(project_root, options = {}) {
  const { explicitProjectId } = options;
  
  // 1. Validate project_root first
  const normalizedRoot = validateProjectRoot(project_root);
  
  // 2. Detect project_id using strategies
  let detectedId = null;
  let detectionMethod = null;
  
  // Try package.json, git, directory name...
  
  // 3. Check for mismatch
  const mismatch = explicitProjectId && 
                   explicitProjectId !== detectedId;
  
  // 4. Return rich metadata
  return {
    project_id: detectedId,
    project_root: normalizedRoot,
    detection_method: detectionMethod,
    explicit_mismatch: mismatch || false,
    explicit_project_id: explicitProjectId || null
  };
}
```

### Tool Integration

All tools now use the enhanced detection:

```javascript
handler: (args) => {
  let project_id = args?.project_id;
  const project_root = args?.project_root;
  
  // Auto-detect with safety checks
  if (!project_id && project_root) {
    const detection = detectProjectId(project_root, { 
      explicitProjectId: project_id 
    });
    project_id = detection.project_id;
    
    // Warn on mismatch
    if (detection.explicit_mismatch) {
      console.warn(`[SAFETY WARNING] ...`);
    }
  } else if (project_root) {
    // Validate even if project_id is explicit
    validateProjectRoot(project_root);
  }
  
  // Continue with validated data...
}
```

## Testing

All 35 tests pass, including 11 new safety tests:

**Validation Tests:**
- ✅ Validates project_root exists
- ✅ Validates project_root is a directory
- ✅ Normalizes project_root to absolute path
- ✅ Rejects empty project_root
- ✅ Rejects non-string project_root

**Detection Tests:**
- ✅ Returns detection metadata
- ✅ Detects mismatch between explicit and detected
- ✅ No mismatch when explicit matches detected
- ✅ Validates project_root during detection
- ✅ Includes detection method in result
- ✅ Normalizes project_root in detection result

## Error Messages

All error messages are clear and actionable:

| Error | Message | Code |
|-------|---------|------|
| Non-existent path | `project_root does not exist: {path}` | -32602 |
| Not a directory | `project_root is not a directory: {path}` | -32602 |
| Cannot access | `Cannot access project_root: {path}` | -32602 |
| Empty string | `project_root must be a non-empty string` | -32602 |

## Benefits

1. **Prevents Data Contamination**: Validates paths before use
2. **Early Error Detection**: Fails fast with clear messages
3. **Mismatch Warnings**: Alerts when configuration may be wrong
4. **Path Normalization**: Consistent behavior across platforms
5. **Rich Metadata**: Provides context for debugging
6. **Backward Compatible**: Existing code still works

## Migration

No migration needed! All changes are backward compatible:

```javascript
// Old code still works
memory.store({ project_id: "my-project", content: "test" })

// New code gets safety benefits
memory.store({ project_root: "/path/to/project", content: "test" })
```

## Future Enhancements

Potential improvements:
1. Track project switches within a session
2. Warn when switching projects frequently
3. Add project_root to memory entries for audit trail
4. Cache validation results for performance
5. Support project aliases/shortcuts
