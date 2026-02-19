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

test("memory.store requires project_id or project_root", () => {
  const dataDir = makeTempDir("mcp-kb-project-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");

    // Should throw when neither project_id nor project_root provided
    assert.throws(
      () => store.handler({ content: "test" }),
      { code: -32602, message: "project_id must be a string" }
    );
  } finally {
    close();
  }
});

test("memory.search requires project_id or project_root", () => {
  const dataDir = makeTempDir("mcp-kb-project-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const search = getTool(tools, "memory.search");

    // Should throw when neither project_id nor project_root provided
    assert.throws(
      () => search.handler({ query: "test" }),
      { code: -32602, message: "project_id must be a string" }
    );
  } finally {
    close();
  }
});

test("memory isolates by project_id", () => {
  const dataDir = makeTempDir("mcp-kb-project-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const search = getTool(tools, "memory.search");

    store.handler({ project_id: "project-A", content: "Secret A", tags: ["secret"] });
    store.handler({ project_id: "project-B", content: "Secret B", tags: ["secret"] });
    store.handler({ project_id: "project-C", content: "Secret C", tags: ["secret"] });

    const resultsA = search.handler({ project_id: "project-A", query: "secret" });
    const resultsB = search.handler({ project_id: "project-B", query: "secret" });
    const resultsC = search.handler({ project_id: "project-C", query: "secret" });

    assert.equal(resultsA.length, 1);
    assert.equal(resultsA[0].content, "Secret A");
    assert.equal(resultsA[0].project_id, "project-A");

    assert.equal(resultsB.length, 1);
    assert.equal(resultsB[0].content, "Secret B");
    assert.equal(resultsB[0].project_id, "project-B");

    assert.equal(resultsC.length, 1);
    assert.equal(resultsC[0].content, "Secret C");
    assert.equal(resultsC[0].project_id, "project-C");
  } finally {
    close();
  }
});

test("legacy entries default to project_id='legacy'", () => {
  const dataDir = makeTempDir("mcp-kb-project-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const cols = memoryDb.prepare("PRAGMA table_info(memory)").all();
    const projectIdCol = cols.find((c) => c.name === "project_id");
    assert.ok(projectIdCol, "project_id column should exist");
    assert.equal(projectIdCol.dflt_value, "'legacy'");
  } finally {
    close();
  }
});

test("memory.search with empty query returns latest entries for project", () => {
  const dataDir = makeTempDir("mcp-kb-project-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const search = getTool(tools, "memory.search");

    store.handler({ project_id: "proj1", content: "Entry 1" });
    store.handler({ project_id: "proj1", content: "Entry 2" });
    store.handler({ project_id: "proj2", content: "Entry 3" });

    const results = search.handler({ project_id: "proj1", query: "", limit: 10 });
    assert.equal(results.length, 2);
    assert.equal(results[0].content, "Entry 2");
    assert.equal(results[1].content, "Entry 1");
  } finally {
    close();
  }
});
