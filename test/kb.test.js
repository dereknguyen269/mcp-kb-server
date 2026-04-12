import assert from "node:assert/strict";
import test from "node:test";

import { openDatabases } from "../src/storage/db.js";
import { createKbTools } from "../src/tools/kb.js";
import { makeTempDir } from "./helpers/tmp.js";

function getTool(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `missing tool: ${name}`);
  return t;
}

test("kb.search finds document via FTS5", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const add = getTool(tools, "kb.add");
    const search = getTool(tools, "kb.search");

    const created = await add.handler({
      title: "MCP Overview",
      content: "MCP uses JSON-RPC 2.0 over transports like stdio.",
      source: "spec"
    });

    assert.ok(Number(created.id) >= 1);

    const results = await search.handler({ query: "JSON-RPC", limit: 5 });
    assert.ok(results.length >= 1);
    assert.equal(results[0].title, "MCP Overview");
  } finally {
    close();
  }
});

test("kb.search vector path uses Qdrant and returns score", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  const originalFetch = globalThis.fetch;

  try {
    const tools = createKbTools({ kbDb });
    const search = getTool(tools, "kb.search");

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        result: [
          {
            id: 123,
            score: 0.99,
            payload: {
              id: 123,
              title: "Vector Doc",
              content: "hello",
              source: "unit"
            }
          }
        ]
      }),
      text: async () => ""
    });

    const results = await search.handler({
      query: "ignored",
      limit: 5,
      vector: [0.1, 0.2, 0.3],
      qdrantUrl: "http://localhost:6333",
      qdrantCollection: "kb_test"
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].id, 123);
    assert.equal(results[0].title, "Vector Doc");
    assert.equal(results[0].score, 0.99);
  } finally {
    globalThis.fetch = originalFetch;
    close();
  }
});

test("kb.update replaces title and content", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const add = getTool(tools, "kb.add");
    const update = getTool(tools, "kb.update");
    const search = getTool(tools, "kb.search");

    const { id } = await add.handler({ title: "Old Title", content: "old content" });

    const result = await update.handler({ id, title: "New Title", content: "new content" });
    assert.equal(result.title, "New Title");
    assert.equal(result.content, "new content");

    const hits = await search.handler({ query: "new content" });
    assert.ok(hits.some(h => h.id === id && h.title === "New Title"));
  } finally {
    close();
  }
});

test("kb.update returns error for missing id", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const update = getTool(tools, "kb.update");
    await assert.rejects(async () => update.handler({ id: 99999, content: "x" }), /not found/i);
  } finally {
    close();
  }
});

test("kb.delete removes a document", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const add = getTool(tools, "kb.add");
    const del = getTool(tools, "kb.delete");
    const search = getTool(tools, "kb.search");

    const { id } = await add.handler({ title: "To Delete", content: "delete me" });

    const result = await del.handler({ id });
    assert.equal(result.deleted, true);
    assert.equal(result.id, id);

    const hits = await search.handler({ query: "delete me" });
    assert.ok(!hits.some(h => h.id === id));
  } finally {
    close();
  }
});

test("kb.delete returns deleted:false for missing id", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const del = getTool(tools, "kb.delete");
    const result = await del.handler({ id: 99999 });
    assert.equal(result.deleted, false);
  } finally {
    close();
  }
});

test("kb.search truncates content when max_content_length is set", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const add = getTool(tools, "kb.add");
    const search = getTool(tools, "kb.search");

    await add.handler({ title: "Long Doc", content: ("abcdefghij ").repeat(10).trim() });

    const results = await search.handler({ query: "abcdefghij", max_content_length: 20 });
    assert.ok(results.length >= 1);
    assert.equal(results[0].content.length, 20);
    assert.equal(results[0].truncated, true);
  } finally {
    close();
  }
});

test("kb.search does not set truncated when content fits", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const add = getTool(tools, "kb.add");
    const search = getTool(tools, "kb.search");

    await add.handler({ title: "Short Doc", content: "hello" });

    const results = await search.handler({ query: "hello", max_content_length: 100 });
    assert.ok(results.length >= 1);
    assert.equal(results[0].content, "hello");
    assert.equal(results[0].truncated, undefined);
  } finally {
    close();
  }
});

test("kb.get returns full document by id", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const add = getTool(tools, "kb.add");
    const get = getTool(tools, "kb.get");

    const { id } = await add.handler({ title: "Full Doc", content: "full content here", source: "src" });
    const doc = await get.handler({ id });

    assert.equal(doc.id, id);
    assert.equal(doc.title, "Full Doc");
    assert.equal(doc.content, "full content here");
    assert.equal(doc.source, "src");
  } finally {
    close();
  }
});

test("kb.get throws for missing id", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const get = getTool(tools, "kb.get");
    assert.throws(() => get.handler({ id: 99999 }), /not found/i);
  } finally {
    close();
  }
});

test("kb.index returns exists:false when no index exists", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const index = getTool(tools, "kb.index");
    const result = index.handler({ project_id: "p1" });
    assert.equal(result.exists, false);
    assert.equal(result.content, null);
  } finally {
    close();
  }
});

test("kb.index creates index on first write", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const index = getTool(tools, "kb.index");
    const result = index.handler({ project_id: "p1", content: "# KB Index\n\n- [Doc] (id:1) — a doc" });
    assert.ok(typeof result.id === "number");
    assert.equal(result.updated, false);
  } finally {
    close();
  }
});

test("kb.index replaces content on subsequent write", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const index = getTool(tools, "kb.index");
    index.handler({ project_id: "p1", content: "v1" });
    const r2 = index.handler({ project_id: "p1", content: "v2" });
    assert.equal(r2.updated, true);
    const fetched = index.handler({ project_id: "p1" });
    assert.equal(fetched.content, "v2");
  } finally {
    close();
  }
});

test("kb.index is isolated by project_id", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const index = getTool(tools, "kb.index");
    index.handler({ project_id: "p1", content: "index for p1" });
    const r = index.handler({ project_id: "p2" });
    assert.equal(r.exists, false);
  } finally {
    close();
  }
});

test("kb.index is not returned by kb.search", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createKbTools({ kbDb });
    const index = getTool(tools, "kb.index");
    const search = getTool(tools, "kb.search");

    index.handler({ project_id: "p1", content: "# KB Index\n\nsome unique xyzzy content" });

    const results = await search.handler({ query: "xyzzy", project_id: "p1" });
    assert.ok(results.every(r => r.source !== "_index"));

    const all = await search.handler({ query: "", project_id: "p1" });
    assert.ok(all.every(r => r.source !== "_index"));
  } finally {
    close();
  }
});

test("kb.add rolls back SQLite insert if Qdrant upsert fails", async () => {
  const dataDir = makeTempDir("mcp-kb-kb-");
  const { kbDb, close } = openDatabases({ dataDir });
  const originalFetch = globalThis.fetch;

  try {
    const tools = createKbTools({ kbDb });
    const add = getTool(tools, "kb.add");

    let call = 0;
    globalThis.fetch = async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({}),
          text: async () => "Not Found"
        };
      }
      if (call === 2) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({}),
          text: async () => ""
        };
      }
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({}),
        text: async () => "fail"
      };
    };

    await assert.rejects(
      add.handler({
        title: "Should Rollback",
        content: "This should not remain in SQLite if Qdrant fails.",
        vector: [0.1, 0.2, 0.3],
        qdrantUrl: "http://localhost:6333",
        qdrantCollection: "kb_test"
      }),
      /Qdrant error/
    );

    const remaining = kbDb
      .prepare("SELECT rowid AS id FROM kb_fts WHERE title = ? LIMIT 1")
      .get("Should Rollback");
    assert.equal(remaining, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    close();
  }
});

