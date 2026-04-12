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

test("wiki.lint - reports missing_index when no index exists", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "p1" });
    assert.equal(result.missing_index, true);
    assert.ok(result.summary.includes("missing index"));
  } finally {
    close();
  }
});

test("wiki.lint - missing_index is false when index exists", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const { createKbTools } = await import("../src/tools/kb.js");
    const kbTools = createKbTools({ kbDb });
    const index = kbTools.find((t) => t.name === "kb.index");
    index.handler({ project_id: "p1", content: "# KB Index" });

    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "p1" });
    assert.equal(result.missing_index, false);
    assert.ok(!result.summary.includes("missing index"));
  } finally {
    close();
  }
});

test("wiki.lint - semantic mode returns expected shape on empty project", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "sem-empty", lint_mode: "semantic" });

    assert.equal(result.lint_mode, "semantic");
    assert.equal(result.project_id, "sem-empty");
    assert.ok(Array.isArray(result.kb_entries));
    assert.ok(Array.isArray(result.memory_entries));
    assert.ok(Array.isArray(result.existing_links));
    assert.ok(Array.isArray(result.sources));
    assert.equal(result.kb_entries.length, 0);
    assert.equal(result.memory_entries.length, 0);
    assert.equal(result.existing_links.length, 0);
    assert.ok(typeof result.semantic_prompt === "string" && result.semantic_prompt.length > 0);
    assert.ok(typeof result.instructions === "string");
    assert.ok(typeof result.stats === "object");
  } finally {
    close();
  }
});

test("wiki.lint - semantic mode includes kb and memory entries", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const { createKbTools } = await import("../src/tools/kb.js");
    const kbTools = createKbTools({ kbDb });
    const kbAdd = kbTools.find((t) => t.name === "kb.add");
    await kbAdd.handler({ title: "Auth Service", content: "Handles authentication via JWT tokens.", project_id: "sem-proj" });
    await kbAdd.handler({ title: "User Service", content: "Manages user profiles and preferences.", project_id: "sem-proj" });

    const memTools = createMemoryTools({ memoryDb });
    const store = memTools.find((t) => t.name === "memory.store");
    await store.handler({ content: "JWT tokens expire after 24 hours", project_id: "sem-proj" });

    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "sem-proj", lint_mode: "semantic" });

    assert.equal(result.kb_entries.length, 2);
    assert.equal(result.memory_entries.length, 1);
    assert.equal(result.stats.kb_entries_included, 2);
    assert.equal(result.stats.memory_entries_included, 1);

    // Each kb entry has required fields
    for (const e of result.kb_entries) {
      assert.ok(typeof e.id === "string");
      assert.equal(e.type, "kb");
      assert.ok(typeof e.title === "string");
      assert.ok(typeof e.content_preview === "string");
    }

    // Each memory entry has required fields
    for (const e of result.memory_entries) {
      assert.ok(typeof e.id === "string");
      assert.equal(e.type, "memory");
      assert.ok(typeof e.content_preview === "string");
    }
  } finally {
    close();
  }
});

test("wiki.lint - semantic mode respects content_preview_length", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const { createKbTools } = await import("../src/tools/kb.js");
    const kbTools = createKbTools({ kbDb });
    const kbAdd = kbTools.find((t) => t.name === "kb.add");
    await kbAdd.handler({ title: "Long Doc", content: "A".repeat(1000), project_id: "sem-preview" });

    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "sem-preview", lint_mode: "semantic", content_preview_length: 100 });

    assert.ok(result.kb_entries[0].content_preview.length <= 100);
  } finally {
    close();
  }
});

test("wiki.lint - semantic mode includes existing links", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const memTools = createMemoryTools({ memoryDb });
    const store = memTools.find((t) => t.name === "memory.store");
    const a = await store.handler({ content: "entry A", project_id: "sem-links" });
    const b = await store.handler({ content: "entry B", project_id: "sem-links" });

    const linkTools = createWikiLinkTools({ memoryDb });
    const link = linkTools.find((t) => t.name === "wiki.link");
    await link.handler({ source_id: a.id, target_id: b.id, source_type: "memory", target_type: "memory", project_id: "sem-links" });

    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "sem-links", lint_mode: "semantic" });

    assert.equal(result.existing_links.length, 1);
    assert.equal(result.existing_links[0].source_id, a.id);
    assert.equal(result.existing_links[0].target_id, b.id);
    assert.equal(result.stats.existing_links, 1);
  } finally {
    close();
  }
});

test("wiki.lint - structural mode still works when lint_mode is explicit", async () => {
  const dataDir = makeTempDir("wiki-lint-test-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const lint = createWikiLintTool({ memoryDb, kbDb });
    const result = await lint.handler({ project_id: "struct-explicit", lint_mode: "structural" });

    assert.ok(Array.isArray(result.orphan_memory));
    assert.ok(Array.isArray(result.broken_links));
    assert.ok(Array.isArray(result.stale_sources));
    assert.ok(typeof result.summary === "string");
  } finally {
    close();
  }
});
