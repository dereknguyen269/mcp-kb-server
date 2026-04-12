import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { openDatabases } from "../src/storage/db.js";
import { createWikiLintTool } from "../src/tools/wikiLint.js";
import { createWikiLinkTools } from "../src/tools/wikiLinks.js";
import { createMemoryTools } from "../src/tools/memory.js";
import { createSourceTools } from "../src/tools/sources.js";

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("wiki.lint - detects orphan memory entries", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    // Store a memory entry with no links
    const memTools = createMemoryTools({ memoryDb });
    const store = memTools.find((t) => t.name === "memory.store");
    await store.handler({ content: "orphan entry", project_id: "test-project" });

    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "test-project" });

    assert.ok(result.orphan_memory.length >= 1);
    assert.ok(result.summary.includes("orphan"));
  } finally {
    close();
  }
});

test("wiki.lint - detects broken links", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const linkTools = createWikiLinkTools({ memoryDb });
    const link = linkTools.find((t) => t.name === "wiki.link");

    // Create a link pointing to non-existent IDs
    await link.handler({
      source_id: "ghost-001",
      target_id: "ghost-002",
      source_type: "memory",
      target_type: "memory",
      project_id: "test-project"
    });

    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "test-project" });

    assert.ok(result.broken_links.length >= 1);
    assert.equal(result.broken_links[0].source_exists, false);
    assert.equal(result.broken_links[0].target_exists, false);
  } finally {
    close();
  }
});

test("wiki.lint - no issues on clean wiki", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "empty-project" });

    assert.equal(result.orphan_memory.length, 0);
    assert.equal(result.broken_links.length, 0);
    assert.equal(result.stale_sources.length, 0);
  } finally {
    close();
  }
});
