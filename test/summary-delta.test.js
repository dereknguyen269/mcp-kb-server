import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { openDatabases } from "../src/storage/db.js";
import { createMemoryTools } from "../src/tools/memory.js";
import { createKbTools } from "../src/tools/kb.js";
import { createSummaryDeltaTool } from "../src/tools/summaryDelta.js";
import { makeTempDir } from "./helpers/tmp.js";

function getTool(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `missing tool: ${name}`);
  return t;
}

test("summary.delta returns message when no previous summary exists", async () => {
  const dataDir = makeTempDir("mcp-kb-delta-");
  const projectRoot = makeTempDir("mcp-kb-project-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const memoryTools = createMemoryTools({ memoryDb });
    const kbTools = createKbTools({ kbDb });
    const memorySearchTool = getTool(memoryTools, "memory.search");
    const kbSearchTool = getTool(kbTools, "kb.search");

    const deltaTool = createSummaryDeltaTool({ memorySearchTool, kbSearchTool });

    const result = await deltaTool.handler({
      project_id: "new-project",
      project_root: projectRoot,
      auto_discover: false
    });

    assert.equal(result.project_id, "new-project");
    assert.equal(result.previous_summary, null);
    assert.equal(result.current_state, null);
    assert.ok(result.message.includes("No previous project summary found"));
    assert.ok(result.message.includes("new-project"));
  } finally {
    close();
  }
});

test("summary.delta finds previous summary for correct project_id only", async () => {
  const dataDir = makeTempDir("mcp-kb-delta-");
  const projectRoot = makeTempDir("mcp-kb-project-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const memoryTools = createMemoryTools({ memoryDb });
    const kbTools = createKbTools({ kbDb });
    const memoryStore = getTool(memoryTools, "memory.store");
    const memorySearchTool = getTool(memoryTools, "memory.search");
    const kbSearchTool = getTool(kbTools, "kb.search");

    memoryStore.handler({
      project_id: "project-A",
      content: "Summary for project A",
      tags: ["project-summary"]
    });

    memoryStore.handler({
      project_id: "project-B",
      content: "Summary for project B",
      tags: ["project-summary"]
    });

    const deltaTool = createSummaryDeltaTool({ memorySearchTool, kbSearchTool });

    const resultA = await deltaTool.handler({
      project_id: "project-A",
      project_root: projectRoot,
      auto_discover: false
    });

    assert.equal(resultA.project_id, "project-A");
    assert.ok(resultA.previous_summary);
    assert.equal(resultA.previous_summary.content, "Summary for project A");
    assert.ok(resultA.current_state);

    const resultB = await deltaTool.handler({
      project_id: "project-B",
      project_root: projectRoot,
      auto_discover: false
    });

    assert.equal(resultB.project_id, "project-B");
    assert.ok(resultB.previous_summary);
    assert.equal(resultB.previous_summary.content, "Summary for project B");
  } finally {
    close();
  }
});

test("summary.delta auto-detects project_id from project_root", async () => {
  const dataDir = makeTempDir("mcp-kb-delta-");
  const projectRoot = makeTempDir("mcp-kb-project-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const memoryTools = createMemoryTools({ memoryDb });
    const kbTools = createKbTools({ kbDb });
    const memorySearchTool = getTool(memoryTools, "memory.search");
    const kbSearchTool = getTool(kbTools, "kb.search");

    const deltaTool = createSummaryDeltaTool({ memorySearchTool, kbSearchTool });

    const result = await deltaTool.handler({ project_root: projectRoot });

    assert.ok(result.message);
    assert.ok(result.message.includes("No previous project summary found"));
    assert.ok(result.project_id);
  } finally {
    close();
  }
});

test("summary.delta requires project_root", async () => {
  const dataDir = makeTempDir("mcp-kb-delta-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const memoryTools = createMemoryTools({ memoryDb });
    const kbTools = createKbTools({ kbDb });
    const memorySearchTool = getTool(memoryTools, "memory.search");
    const kbSearchTool = getTool(kbTools, "kb.search");

    const deltaTool = createSummaryDeltaTool({ memorySearchTool, kbSearchTool });

    await assert.rejects(
      () => deltaTool.handler({ project_id: "test" }),
      { code: -32602, message: "project_root must be a non-empty string" }
    );
  } finally {
    close();
  }
});

test("summary.delta uses project_root for file discovery", async () => {
  const dataDir = makeTempDir("mcp-kb-delta-");
  const projectRoot = makeTempDir("mcp-kb-project-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    fs.writeFileSync(path.join(projectRoot, "README.md"), "# Test Project");

    const memoryTools = createMemoryTools({ memoryDb });
    const kbTools = createKbTools({ kbDb });
    const memoryStore = getTool(memoryTools, "memory.store");
    const memorySearchTool = getTool(memoryTools, "memory.search");
    const kbSearchTool = getTool(kbTools, "kb.search");

    memoryStore.handler({
      project_id: "test-project",
      content: "Previous summary",
      tags: ["project-summary"]
    });

    const deltaTool = createSummaryDeltaTool({ memorySearchTool, kbSearchTool });

    const result = await deltaTool.handler({
      project_id: "test-project",
      project_root: projectRoot,
      auto_discover: true
    });

    assert.equal(result.project_id, "test-project");
    assert.ok(result.current_state.authoritative_files["README.md"]);
    assert.equal(result.current_state.authoritative_files["README.md"], "# Test Project");
  } finally {
    close();
  }
});
