import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { openDatabases } from "../src/storage/db.js";
import { createSourceTools } from "../src/tools/sources.js";

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function getTool(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `missing tool: ${name}`);
  return t;
}

test("source.ingest - ingest a markdown file", async () => {
  const dataDir = makeTempDir("sources-test-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createSourceTools({ kbDb });
    const ingest = getTool(tools, "source.ingest");

    const result = await ingest.handler({
      files: [{ filename: "readme.md", content: "# Hello\nThis is a test document." }],
      project_id: "test-project"
    });

    assert.equal(result.ingested.length, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(result.ingested[0].filename, "readme.md");
    assert.equal(result.ingested[0].file_type, "md");
    assert.ok(result.ingested[0].id);
    assert.ok(result.ingested[0].size_bytes > 0);
  } finally {
    close();
  }
});

test("source.ingest - ingest a CSV file converts to text", async () => {
  const dataDir = makeTempDir("sources-test-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createSourceTools({ kbDb });
    const ingest = getTool(tools, "source.ingest");

    const csvContent = "name,age\nAlice,30\nBob,25";
    const result = await ingest.handler({
      files: [{ filename: "people.csv", content: csvContent }],
      project_id: "test-project"
    });

    assert.equal(result.ingested.length, 1);
    assert.equal(result.ingested[0].file_type, "csv");
  } finally {
    close();
  }
});

test("source.ingest - missing content and file_path returns error", async () => {
  const dataDir = makeTempDir("sources-test-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createSourceTools({ kbDb });
    const ingest = getTool(tools, "source.ingest");

    const result = await ingest.handler({
      files: [{ filename: "empty.md" }],
      project_id: "test-project"
    });

    assert.equal(result.ingested.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].filename, "empty.md");
  } finally {
    close();
  }
});

test("source.list - returns paginated sources", async () => {
  const dataDir = makeTempDir("sources-test-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createSourceTools({ kbDb });
    const ingest = getTool(tools, "source.ingest");
    const list = getTool(tools, "source.list");

    await ingest.handler({
      files: [
        { filename: "a.md", content: "doc a" },
        { filename: "b.md", content: "doc b" }
      ],
      project_id: "test-project"
    });

    const result = await list.handler({ project_id: "test-project" });
    assert.equal(result.total_count, 2);
    assert.equal(result.sources.length, 2);
    assert.equal(result.has_more, false);
  } finally {
    close();
  }
});

test("source.list - project isolation", async () => {
  const dataDir = makeTempDir("sources-test-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createSourceTools({ kbDb });
    const ingest = getTool(tools, "source.ingest");
    const list = getTool(tools, "source.list");

    await ingest.handler({ files: [{ filename: "a.md", content: "doc a" }], project_id: "proj-a" });
    await ingest.handler({ files: [{ filename: "b.md", content: "doc b" }], project_id: "proj-b" });

    const resultA = await list.handler({ project_id: "proj-a" });
    assert.equal(resultA.total_count, 1);
    assert.equal(resultA.sources[0].filename, "a.md");
  } finally {
    close();
  }
});

test("source.search - FTS search finds matching content", async () => {
  const dataDir = makeTempDir("sources-test-");
  const { kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createSourceTools({ kbDb });
    const ingest = getTool(tools, "source.ingest");
    const search = getTool(tools, "source.search");

    await ingest.handler({
      files: [
        { filename: "auth.md", content: "JWT authentication tokens are used for login" },
        { filename: "db.md", content: "PostgreSQL database configuration" }
      ],
      project_id: "test-project"
    });

    const result = await search.handler({ query: "authentication", project_id: "test-project" });
    assert.ok(result.length >= 1);
    assert.equal(result[0].filename, "auth.md");
  } finally {
    close();
  }
});
