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

