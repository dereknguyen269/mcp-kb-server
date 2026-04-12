import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { openDatabases } from "../src/storage/db.js";
import { createWikiExportTool } from "../src/tools/wikiExport.js";
import { createMemoryTools } from "../src/tools/memory.js";
import { createSourceTools } from "../src/tools/sources.js";
import { createKbTools } from "../src/tools/kb.js";

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("wiki.export - creates index.md and log.md", async () => {
  const dataDir = makeTempDir("wiki-export-test-");
  const outputDir = makeTempDir("wiki-export-out-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const exportTool = createWikiExportTool({ memoryDb, kbDb });
    const result = await exportTool.handler({
      output_dir: outputDir,
      project_id: "test-project"
    });

    assert.ok(result.files_written >= 2);
    assert.ok(fs.existsSync(path.join(outputDir, "index.md")));
    assert.ok(fs.existsSync(path.join(outputDir, "log.md")));
  } finally {
    close();
  }
});

test("wiki.export - exports memory entries as markdown files", async () => {
  const dataDir = makeTempDir("wiki-export-test-");
  const outputDir = makeTempDir("wiki-export-out-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const memTools = createMemoryTools({ memoryDb });
    const store = memTools.find((t) => t.name === "memory.store");
    await store.handler({ content: "JWT tokens are used for auth", tags: ["auth"], project_id: "test-project" });

    const exportTool = createWikiExportTool({ memoryDb, kbDb });
    const result = await exportTool.handler({ output_dir: outputDir, project_id: "test-project" });

    const memDir = path.join(outputDir, "memory");
    assert.ok(fs.existsSync(memDir));
    const files = fs.readdirSync(memDir);
    assert.ok(files.length >= 1);

    const content = fs.readFileSync(path.join(memDir, files[0]), "utf8");
    assert.ok(content.includes("JWT tokens"));
  } finally {
    close();
  }
});

test("wiki.export - exports sources as markdown files", async () => {
  const dataDir = makeTempDir("wiki-export-test-");
  const outputDir = makeTempDir("wiki-export-out-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const srcTools = createSourceTools({ kbDb });
    const ingest = srcTools.find((t) => t.name === "source.ingest");
    await ingest.handler({ files: [{ filename: "guide.md", content: "# Guide\nContent here." }], project_id: "test-project" });

    const exportTool = createWikiExportTool({ memoryDb, kbDb });
    await exportTool.handler({ output_dir: outputDir, project_id: "test-project" });

    const srcDir = path.join(outputDir, "sources");
    assert.ok(fs.existsSync(srcDir));
    const files = fs.readdirSync(srcDir);
    assert.ok(files.length >= 1);
    const content = fs.readFileSync(path.join(srcDir, files[0]), "utf8");
    assert.ok(content.includes("guide.md"));
  } finally {
    close();
  }
});

test("wiki.export - index.md contains catalog entries", async () => {
  const dataDir = makeTempDir("wiki-export-test-");
  const outputDir = makeTempDir("wiki-export-out-");
  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const srcTools = createSourceTools({ kbDb });
    const ingest = srcTools.find((t) => t.name === "source.ingest");
    await ingest.handler({ files: [{ filename: "notes.md", content: "Some notes" }], project_id: "test-project" });

    const exportTool = createWikiExportTool({ memoryDb, kbDb });
    await exportTool.handler({ output_dir: outputDir, project_id: "test-project" });

    const index = fs.readFileSync(path.join(outputDir, "index.md"), "utf8");
    assert.ok(index.includes("notes.md"));
    assert.ok(index.includes("Sources"));
  } finally {
    close();
  }
});
