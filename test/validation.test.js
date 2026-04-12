import { test } from "node:test";
import assert from "node:assert";
import { validateInput } from "../src/utils/validation.js";

test("validation rejects oversized content", () => {
  const largeContent = "x".repeat(60000);
  
  assert.throws(() => {
    validateInput('memory.store', {
      content: largeContent,
      project_root: "/tmp"
    });
  }, /Validation failed.*length must be less than or equal to 50000/);
});

test("validation accepts valid input", () => {
  const result = validateInput('memory.store', {
    content: "test content",
    project_root: "/tmp",
    tags: ["test"]
  });
  
  assert.equal(result.content, "test content");
  assert.equal(result.scope, "default"); // Should set default
  assert.deepEqual(result.tags, ["test"]);
});

test("validation strips unknown fields", () => {
  const result = validateInput('kb.search', {
    query: "test",
    unknownField: "should be removed",
    limit: "5" // Should convert to number
  });

  assert.equal(result.query, "test");
  assert.equal(result.limit, 5);
  assert.equal(result.unknownField, undefined);
});

test("validation passes max_content_length through memory.search", () => {
  const result = validateInput('memory.search', { query: "test", project_id: "p1", max_content_length: 200 });
  assert.equal(result.max_content_length, 200);
});

test("validation passes max_content_length through kb.search", () => {
  const result = validateInput('kb.search', { query: "test", max_content_length: 500 });
  assert.equal(result.max_content_length, 500);
});

test("validation passes max_content_length through memory.list", () => {
  const result = validateInput('memory.list', { project_id: "p1", max_content_length: 100 });
  assert.equal(result.max_content_length, 100);
});

test("validation passes semantic lint params through wiki.lint", () => {
  const result = validateInput('wiki.lint', {
    project_id: "p1",
    lint_mode: "semantic",
    max_kb_entries: 30,
    max_memory_entries: 20,
    content_preview_length: 300
  });
  assert.equal(result.lint_mode, "semantic");
  assert.equal(result.max_kb_entries, 30);
  assert.equal(result.max_memory_entries, 20);
  assert.equal(result.content_preview_length, 300);
});

test("validation defaults lint_mode to structural", () => {
  const result = validateInput('wiki.lint', { project_id: "p1" });
  assert.equal(result.lint_mode, "structural");
});

test("validation rejects invalid lint_mode", () => {
  assert.throws(() => {
    validateInput('wiki.lint', { project_id: "p1", lint_mode: "deep" });
  }, /Validation failed/);
});

test("validation accepts memory.get", () => {
  const result = validateInput('memory.get', { id: "abc-123", project_id: "p1" });
  assert.equal(result.id, "abc-123");
});

test("validation accepts kb.get", () => {
  const result = validateInput('kb.get', { id: 42, project_id: "p1" });
  assert.equal(result.id, 42);
});

test("validation accepts kb.index fetch", () => {
  const result = validateInput('kb.index', { project_id: "p1" });
  assert.equal(result.project_id, "p1");
  assert.equal(result.content, undefined);
});

test("validation accepts source.get", () => {
  const result = validateInput('source.get', { id: "src-001", project_id: "p1" });
  assert.equal(result.id, "src-001");
});
