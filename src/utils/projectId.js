import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Validate and normalize project_root path
 * 
 * @param {string} project_root - Path to validate
 * @returns {string} Normalized absolute path
 * @throws {Error} If path is invalid or inaccessible
 */
export function validateProjectRoot(project_root) {
  if (typeof project_root !== "string" || !project_root.trim()) {
    const error = new Error("project_root must be a non-empty string");
    error.code = -32602;
    throw error;
  }

  // Normalize and resolve to absolute path
  const normalized = path.resolve(project_root);

  // Check if path exists
  if (!fs.existsSync(normalized)) {
    const error = new Error(`project_root does not exist: ${project_root}`);
    error.code = -32602;
    throw error;
  }

  // Check if it's a directory
  let stats;
  try {
    stats = fs.statSync(normalized);
  } catch (err) {
    const error = new Error(`Cannot access project_root: ${project_root}`);
    error.code = -32602;
    throw error;
  }

  if (!stats.isDirectory()) {
    const error = new Error(`project_root is not a directory: ${project_root}`);
    error.code = -32602;
    throw error;
  }

  return normalized;
}

/**
 * Detect project_id from project_root directory with validation
 * 
 * Detection strategy (in order):
 * 1. package.json "name" field
 * 2. Git remote URL (extract repo name)
 * 3. Directory basename
 * 
 * @param {string} project_root - Absolute path to project root
 * @param {object} options - Detection options
 * @param {string} options.explicitProjectId - Explicit project_id to compare against
 * @returns {object} Detection result with project_id and metadata
 */
export function detectProjectId(project_root, options = {}) {
  const { explicitProjectId } = options;
  
  // Validate project_root first
  const normalizedRoot = validateProjectRoot(project_root);
  
  let detectedId = null;
  let detectionMethod = null;

  // Strategy 1: Check package.json
  const packageJsonPath = path.join(normalizedRoot, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, "utf8");
      const pkg = JSON.parse(content);
      if (typeof pkg.name === "string" && pkg.name.trim()) {
        detectedId = sanitizeProjectId(pkg.name);
        detectionMethod = "package.json";
      }
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 2: Check git remote
  if (!detectedId) {
    try {
      const remote = execSync("git remote get-url origin", {
        cwd: normalizedRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"]
      }).trim();
      
      if (remote) {
        // Extract repo name from git URL
        const match = remote.match(/\/([^/]+?)(\.git)?$/);
        if (match && match[1]) {
          detectedId = sanitizeProjectId(match[1]);
          detectionMethod = "git-remote";
        }
      }
    } catch {
      // Git not available or not a git repo, continue
    }
  }

  // Strategy 3: Use directory basename
  if (!detectedId) {
    const basename = path.basename(normalizedRoot);
    detectedId = sanitizeProjectId(basename);
    detectionMethod = "directory-name";
  }

  // Safety check: warn if explicit differs from detected
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

/**
 * Sanitize project_id to valid identifier
 * - Lowercase
 * - Replace invalid chars with hyphens
 * - Remove leading/trailing hyphens
 * - Collapse multiple hyphens
 * 
 * @param {string} raw - Raw project identifier
 * @returns {string} Sanitized project_id
 */
export function sanitizeProjectId(raw) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")  // Replace invalid chars
    .replace(/^-+|-+$/g, "")       // Remove leading/trailing hyphens
    .replace(/-+/g, "-")            // Collapse multiple hyphens
    || "unknown-project";            // Fallback if empty
}
