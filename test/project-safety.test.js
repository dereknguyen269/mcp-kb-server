import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateProjectRoot, detectProjectId } from "../src/utils/projectId.js";

describe("project safety rules", () => {
  it("validates project_root exists", () => {
    assert.throws(
      () => validateProjectRoot("/nonexistent/path/12345"),
      { code: -32602, message: /does not exist/ }
    );
  });

  it("validates project_root is a directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-"));
    const filePath = join(tempDir, "file.txt");
    try {
      writeFileSync(filePath, "test");
      
      assert.throws(
        () => validateProjectRoot(filePath),
        { code: -32602, message: /not a directory/ }
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes project_root to absolute path", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-"));
    try {
      const normalized = validateProjectRoot(tempDir);
      assert.ok(normalized);
      assert.ok(normalized.startsWith("/") || /^[A-Z]:\\/.test(normalized)); // Unix or Windows absolute
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects empty project_root", () => {
    assert.throws(
      () => validateProjectRoot(""),
      { code: -32602, message: /non-empty string/ }
    );
  });

  it("rejects non-string project_root", () => {
    assert.throws(
      () => validateProjectRoot(null),
      { code: -32602, message: /non-empty string/ }
    );
  });

  it("returns detection metadata", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-project-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "my-project" })
      );
      
      const result = detectProjectId(tempDir);
      
      assert.strictEqual(result.project_id, "my-project");
      assert.strictEqual(result.detection_method, "package.json");
      assert.ok(result.project_root);
      assert.strictEqual(result.explicit_mismatch, false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects mismatch between explicit and detected project_id", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-project-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "detected-name" })
      );
      
      const result = detectProjectId(tempDir, { 
        explicitProjectId: "different-name" 
      });
      
      assert.strictEqual(result.project_id, "detected-name");
      assert.strictEqual(result.explicit_mismatch, true);
      assert.strictEqual(result.explicit_project_id, "different-name");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("no mismatch when explicit matches detected", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-project-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "same-name" })
      );
      
      const result = detectProjectId(tempDir, { 
        explicitProjectId: "same-name" 
      });
      
      assert.strictEqual(result.project_id, "same-name");
      assert.strictEqual(result.explicit_mismatch, false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("validates project_root during detection", () => {
    assert.throws(
      () => detectProjectId("/nonexistent/path"),
      { code: -32602, message: /does not exist/ }
    );
  });

  it("includes detection method in result", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-project-"));
    try {
      // No package.json, no git - should use directory name
      const result = detectProjectId(tempDir);
      
      assert.strictEqual(result.detection_method, "directory-name");
      assert.ok(result.project_id.startsWith("test-project-"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes project_root in detection result", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-"));
    try {
      const result = detectProjectId(tempDir);
      
      // Should be absolute path
      assert.ok(result.project_root.startsWith("/") || /^[A-Z]:\\/.test(result.project_root));
      // Should not have trailing slash
      assert.ok(!result.project_root.endsWith("/"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
