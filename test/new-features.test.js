import assert from "node:assert/strict";
import test from "node:test";

import { openDatabases } from "../src/storage/db.js";
import { createMemoryTools } from "../src/tools/memory.js";
import { createKbTools } from "../src/tools/kb.js";
import { makeTempDir } from "./helpers/tmp.js";

function getTool(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `missing tool: ${name}`);
  return t;
}

// ── P1: memory.delete ──

test("memory.delete removes an entry by ID", () => {
  const dataDir = makeTempDir("mcp-kb-p1-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const del = getTool(tools, "memory.delete");
    const search = getTool(tools, "memory.search");

    const { id } = store.handler({ project_id: "proj", content: "delete me", tags: ["tmp"] });
    const result = del.handler({ id, project_id: "proj" });
    assert.equal(result.deleted, true);

    const found = search.handler({ project_id: "proj", query: "delete me" });
    assert.equal(found.length, 0);
  } finally {
    close();
  }
});

test("memory.delete returns false for non-existent ID", () => {
  const dataDir = makeTempDir("mcp-kb-p1b-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const del = getTool(tools, "memory.delete");
    const result = del.handler({ id: "nonexistent", project_id: "proj" });
    assert.equal(result.deleted, false);
  } finally {
    close();
  }
});

// ── P2: memory.update ──

test("memory.update changes content and tags", () => {
  const dataDir = makeTempDir("mcp-kb-p2-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const update = getTool(tools, "memory.update");
    const search = getTool(tools, "memory.search");

    const { id } = store.handler({ project_id: "proj", content: "old content", tags: ["v1"] });
    const updated = update.handler({ id, project_id: "proj", content: "new content", tags: ["v2"] });

    assert.equal(updated.content, "new content");
    assert.deepEqual(updated.tags, ["v2"]);
    assert.ok(updated.updated_at);

    const found = search.handler({ project_id: "proj", query: "new content" });
    assert.equal(found.length, 1);
    assert.equal(found[0].content, "new content");
  } finally {
    close();
  }
});

test("memory.update throws for non-existent ID", () => {
  const dataDir = makeTempDir("mcp-kb-p2b-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const update = getTool(tools, "memory.update");
    assert.throws(
      () => update.handler({ id: "nonexistent", project_id: "proj", content: "x" }),
      /not found/
    );
  } finally {
    close();
  }
});

// ── P3: Tag-based retrieval ──

test("memory.search filters by tag", () => {
  const dataDir = makeTempDir("mcp-kb-p3-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const search = getTool(tools, "memory.search");

    store.handler({ project_id: "proj", content: "auth decision", tags: ["decision", "auth"] });
    store.handler({ project_id: "proj", content: "bug fix login", tags: ["bug", "auth"] });
    store.handler({ project_id: "proj", content: "refactor utils", tags: ["refactor"] });

    // Tag-only search (empty query)
    const decisions = search.handler({ project_id: "proj", query: "", tag: "decision" });
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].content, "auth decision");

    // Tag + query combined
    const authBugs = search.handler({ project_id: "proj", query: "auth", tag: "bug" });
    assert.equal(authBugs.length, 1);
    assert.equal(authBugs[0].content, "bug fix login");
  } finally {
    close();
  }
});

// ── P4: FTS5 search ──

test("memory.search with use_fts returns ranked results", () => {
  const dataDir = makeTempDir("mcp-kb-p4-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const search = getTool(tools, "memory.search");

    store.handler({ project_id: "proj", content: "React hooks are great for state management" });
    store.handler({ project_id: "proj", content: "Vue composition API is similar to React hooks" });
    store.handler({ project_id: "proj", content: "Database migration completed" });

    const results = search.handler({ project_id: "proj", query: "React hooks", use_fts: true });
    assert.ok(results.length >= 1);
    // All results should mention React or hooks
    for (const r of results) {
      assert.ok(r.content.includes("React") || r.content.includes("hooks"));
    }
  } finally {
    close();
  }
});

// ── P5: KB project scoping ──

test("kb.add and kb.search with project_id scoping", async () => {
  const dataDir = makeTempDir("mcp-kb-p5-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const add = getTool(tools, "kb.add");
    const search = getTool(tools, "kb.search");

    await add.handler({ title: "Global Doc", content: "Available everywhere", source: "global" });
    await add.handler({ title: "Project A Doc", content: "Only for project A", source: "a", project_id: "project-a" });
    await add.handler({ title: "Project B Doc", content: "Only for project B", source: "b", project_id: "project-b" });

    // Global search returns all
    const all = await search.handler({ query: "" });
    assert.ok(all.length >= 3);

    // Scoped search returns only project-a docs
    const scopedA = await search.handler({ query: "", project_id: "project-a" });
    assert.equal(scopedA.length, 1);
    assert.equal(scopedA[0].title, "Project A Doc");

    // Scoped FTS search
    const scopedB = await search.handler({ query: "project", project_id: "project-b" });
    assert.equal(scopedB.length, 1);
    assert.equal(scopedB[0].title, "Project B Doc");
  } finally {
    close();
  }
});

// ── P6: TTL / expiry ──

test("memory.store with expires_at and auto-purge", () => {
  const dataDir = makeTempDir("mcp-kb-p6-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const search = getTool(tools, "memory.search");

    // Store with past expiry
    store.handler({
      project_id: "proj",
      content: "expired info",
      expires_at: "2020-01-01T00:00:00.000Z"
    });

    // Store without expiry
    store.handler({ project_id: "proj", content: "permanent info" });

    // Search should auto-purge expired entries
    const results = search.handler({ project_id: "proj", query: "" });
    assert.equal(results.length, 1);
    assert.equal(results[0].content, "permanent info");
  } finally {
    close();
  }
});

test("memory.update can set and clear expires_at", () => {
  const dataDir = makeTempDir("mcp-kb-p6b-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const update = getTool(tools, "memory.update");

    const { id } = store.handler({ project_id: "proj", content: "temp info" });

    // Set expiry
    const withExpiry = update.handler({ id, project_id: "proj", expires_at: "2030-01-01T00:00:00.000Z" });
    assert.equal(withExpiry.expires_at, "2030-01-01T00:00:00.000Z");

    // Clear expiry
    const noExpiry = update.handler({ id, project_id: "proj", expires_at: "" });
    assert.equal(noExpiry.expires_at, undefined);
  } finally {
    close();
  }
});


// ── memory.list — paginated listing ──

test("memory.list returns all entries with total_count and pagination", () => {
  const dataDir = makeTempDir("mcp-kb-list-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const list = getTool(tools, "memory.list");

    // Store 5 entries
    for (let i = 0; i < 5; i++) {
      store.handler({ project_id: "proj", content: `memory ${i}`, tags: [`tag${i}`] });
    }

    // List all — default limit 50 should return all 5
    const all = list.handler({ project_id: "proj" });
    assert.equal(all.total_count, 5);
    assert.equal(all.entries.length, 5);
    assert.equal(all.has_more, false);
    assert.equal(all.offset, 0);

    // Paginate: page 1 (limit 2, offset 0)
    const page1 = list.handler({ project_id: "proj", limit: 2, offset: 0 });
    assert.equal(page1.total_count, 5);
    assert.equal(page1.entries.length, 2);
    assert.equal(page1.has_more, true);

    // Paginate: page 2 (limit 2, offset 2)
    const page2 = list.handler({ project_id: "proj", limit: 2, offset: 2 });
    assert.equal(page2.entries.length, 2);
    assert.equal(page2.has_more, true);

    // Paginate: page 3 (limit 2, offset 4)
    const page3 = list.handler({ project_id: "proj", limit: 2, offset: 4 });
    assert.equal(page3.entries.length, 1);
    assert.equal(page3.has_more, false);

    // No overlap between pages
    const allIds = [...page1.entries, ...page2.entries, ...page3.entries].map(e => e.id);
    assert.equal(new Set(allIds).size, 5);
  } finally {
    close();
  }
});

test("memory.list filters by scope", () => {
  const dataDir = makeTempDir("mcp-kb-list-scope-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const list = getTool(tools, "memory.list");

    store.handler({ project_id: "proj", scope: "decisions", content: "use JWT" });
    store.handler({ project_id: "proj", scope: "decisions", content: "use PostgreSQL" });
    store.handler({ project_id: "proj", scope: "bugs", content: "login crash" });

    const decisions = list.handler({ project_id: "proj", scope: "decisions" });
    assert.equal(decisions.total_count, 2);
    assert.equal(decisions.entries.length, 2);

    const bugs = list.handler({ project_id: "proj", scope: "bugs" });
    assert.equal(bugs.total_count, 1);
  } finally {
    close();
  }
});

test("memory.list excludes expired entries", () => {
  const dataDir = makeTempDir("mcp-kb-list-expiry-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const list = getTool(tools, "memory.list");

    store.handler({ project_id: "proj", content: "permanent" });
    store.handler({ project_id: "proj", content: "expired", expires_at: "2020-01-01T00:00:00.000Z" });

    const result = list.handler({ project_id: "proj" });
    assert.equal(result.total_count, 1);
    assert.equal(result.entries[0].content, "permanent");
  } finally {
    close();
  }
});

test("memory.list isolates by project_id", () => {
  const dataDir = makeTempDir("mcp-kb-list-iso-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createMemoryTools({ memoryDb });
    const store = getTool(tools, "memory.store");
    const list = getTool(tools, "memory.list");

    store.handler({ project_id: "proj-a", content: "a stuff" });
    store.handler({ project_id: "proj-b", content: "b stuff" });

    const a = list.handler({ project_id: "proj-a" });
    assert.equal(a.total_count, 1);
    assert.equal(a.entries[0].content, "a stuff");

    const b = list.handler({ project_id: "proj-b" });
    assert.equal(b.total_count, 1);
    assert.equal(b.entries[0].content, "b stuff");
  } finally {
    close();
  }
});
