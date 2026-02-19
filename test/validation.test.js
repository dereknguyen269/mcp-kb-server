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
