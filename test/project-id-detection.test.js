import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { detectProjectId, sanitizeProjectId } from "../src/utils/projectId.js";

describe("projectId detection", () => {
  it("detects from package.json name", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "my-awesome-project" })
      );
      
      const result = detectProjectId(tempDir);
      assert.strictEqual(result.project_id, "my-awesome-project");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects from directory basename when no package.json", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-project-"));
    try {
      const result = detectProjectId(tempDir);
      assert.ok(result.project_id.startsWith("test-project-"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("sanitizes project_id correctly", () => {
    assert.strictEqual(sanitizeProjectId("My Project!"), "my-project");
    assert.strictEqual(sanitizeProjectId("@scope/package"), "scope-package");
    assert.strictEqual(sanitizeProjectId("project___name"), "project-name");
    assert.strictEqual(sanitizeProjectId("---project---"), "project");
    assert.strictEqual(sanitizeProjectId("UPPERCASE"), "uppercase");
  });

  it("handles invalid package.json gracefully", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-"));
    try {
      writeFileSync(join(tempDir, "package.json"), "invalid json{");
      
      const result = detectProjectId(tempDir);
      // Should fallback to directory name
      assert.ok(result.project_id.startsWith("test-"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles empty package.json name", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "test-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "" })
      );
      
      const result = detectProjectId(tempDir);
      // Should fallback to directory name
      assert.ok(result.project_id.startsWith("test-"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns fallback for empty sanitized string", () => {
    assert.strictEqual(sanitizeProjectId("!!!"), "unknown-project");
    assert.strictEqual(sanitizeProjectId(""), "unknown-project");
  });
});
