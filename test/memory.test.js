import assert from "node:assert/strict";
import test from "node:test";

import { openDatabases } from "../src/storage/db.js";
import { createMemoryTools } from "../src/tools/memory.js";
import { makeTempDir } from "./helpers/tmp.js";

function getTool(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `missing tool: ${name}`);
  return t;
}

test("memory.store defaults scope to 'default'", () => {
  const dataDir = makeTempDir("mcp-kb-memory-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const search = getTool(tools, "memory.search");

    const stored = store.handler({ project_id: "test-project", content: "hello", tags: ["t1"] });
    assert.equal(stored.scope, "default");
    assert.equal(stored.project_id, "test-project");

    const results = search.handler({ project_id: "test-project", query: "hello" });
    assert.equal(results.length, 1);
    assert.equal(results[0].scope, "default");
    assert.equal(results[0].project_id, "test-project");
    assert.equal(results[0].content, "hello");
    assert.deepEqual(results[0].tags, ["t1"]);
  } finally {
    close();
  }
});

test("memory.search isolates by scope", () => {
  const dataDir = makeTempDir("mcp-kb-memory-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const search = getTool(tools, "memory.search");

    store.handler({ project_id: "projectA", scope: "projectA", content: "A-only fact", tags: ["a"] });
    store.handler({ project_id: "projectB", scope: "projectB", content: "B-only fact", tags: ["b"] });

    const a = search.handler({ project_id: "projectA", scope: "projectA", query: "fact", limit: 10 });
    const b = search.handler({ project_id: "projectB", scope: "projectB", query: "fact", limit: 10 });

    assert.equal(a.length, 1);
    assert.equal(a[0].scope, "projectA");
    assert.equal(a[0].project_id, "projectA");
    assert.equal(a[0].content, "A-only fact");

    assert.equal(b.length, 1);
    assert.equal(b[0].scope, "projectB");
    assert.equal(b[0].project_id, "projectB");
    assert.equal(b[0].content, "B-only fact");
  } finally {
    close();
  }
});

