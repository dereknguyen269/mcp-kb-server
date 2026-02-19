import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createSummaryTools } from "../src/tools/summary.js";
import { makeTempDir } from "./helpers/tmp.js";

function getTool(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `missing tool: ${name}`);
  return t;
}

test("summary.project auto-discovers .kiro resources markdown via glob", async () => {
  const rootDir = makeTempDir("mcp-kb-summary-");
  fs.mkdirSync(path.join(rootDir, ".kiro", "resources"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, ".kiro", "resources", "a.md"), "A");
  fs.writeFileSync(path.join(rootDir, ".kiro", "resources", "b.md"), "B");
  fs.writeFileSync(path.join(rootDir, ".kiro", "resources", "note.txt"), "X");

  const tools = createSummaryTools({
    memorySearchTool: { handler: () => [] },
    kbSearchTool: { handler: () => [] }
  });
  const summary = getTool(tools, "summary.project");

  const result = await summary.handler({
    project_id: "test-project",
    project_root: rootDir,
    auto_discover: true,
    include_files: []
  });
  assert.equal(result.project_id, "test-project");
  assert.deepEqual(result.discovered_files, [".kiro/resources/a.md", ".kiro/resources/b.md"]);
  assert.equal(result.authoritative_files[".kiro/resources/a.md"], "A");
  assert.equal(result.authoritative_files[".kiro/resources/b.md"], "B");
});
