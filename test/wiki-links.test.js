import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { openDatabases } from "../src/storage/db.js";
import { createWikiLinkTools } from "../src/tools/wikiLinks.js";
import { createMemoryTools } from "../src/tools/memory.js";

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function getTool(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `missing tool: ${name}`);
  return t;
}

test("wiki.link - creates a link between two memory entries", async () => {
  const dataDir = makeTempDir("wiki-links-test-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createWikiLinkTools({ memoryDb });
    const link = getTool(tools, "wiki.link");

    const result = await link.handler({
      source_id: "mem-001",
      target_id: "mem-002",
      source_type: "memory",
      target_type: "memory",
      relation: "references",
      project_id: "test-project"
    });

    assert.ok(result.id);
    assert.equal(result.source_id, "mem-001");
    assert.equal(result.target_id, "mem-002");
    assert.equal(result.relation, "references");
    assert.ok(result.created_at);
  } finally {
    close();
  }
});

test("wiki.link - rejects same source and target", async () => {
  const dataDir = makeTempDir("wiki-links-test-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createWikiLinkTools({ memoryDb });
    const link = getTool(tools, "wiki.link");

    await assert.rejects(
      () => link.handler({ source_id: "x", target_id: "x", source_type: "memory", target_type: "memory", project_id: "p" }),
      /different/
    );
  } finally {
    close();
  }
});

test("wiki.links - returns outbound and inbound links", async () => {
  const dataDir = makeTempDir("wiki-links-test-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createWikiLinkTools({ memoryDb });
    const link = getTool(tools, "wiki.link");
    const links = getTool(tools, "wiki.links");

    await link.handler({ source_id: "a", target_id: "b", source_type: "memory", target_type: "memory", project_id: "p" });
    await link.handler({ source_id: "c", target_id: "a", source_type: "memory", target_type: "memory", project_id: "p" });

    const result = await links.handler({ entry_id: "a", project_id: "p" });
    assert.equal(result.outbound.length, 1);
    assert.equal(result.outbound[0].target_id, "b");
    assert.equal(result.inbound.length, 1);
    assert.equal(result.inbound[0].source_id, "c");
  } finally {
    close();
  }
});

test("wiki.links - direction=out returns only outbound", async () => {
  const dataDir = makeTempDir("wiki-links-test-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createWikiLinkTools({ memoryDb });
    const link = getTool(tools, "wiki.link");
    const links = getTool(tools, "wiki.links");

    await link.handler({ source_id: "a", target_id: "b", source_type: "memory", target_type: "memory", project_id: "p" });
    await link.handler({ source_id: "c", target_id: "a", source_type: "memory", target_type: "memory", project_id: "p" });

    const result = await links.handler({ entry_id: "a", project_id: "p", direction: "out" });
    assert.equal(result.outbound.length, 1);
    assert.equal(result.inbound.length, 0);
  } finally {
    close();
  }
});

test("wiki.links - project isolation", async () => {
  const dataDir = makeTempDir("wiki-links-test-");
  const { memoryDb, close } = openDatabases({ dataDir });
  try {
    const tools = createWikiLinkTools({ memoryDb });
    const link = getTool(tools, "wiki.link");
    const links = getTool(tools, "wiki.links");

    await link.handler({ source_id: "a", target_id: "b", source_type: "memory", target_type: "memory", project_id: "proj-1" });
    await link.handler({ source_id: "a", target_id: "c", source_type: "memory", target_type: "memory", project_id: "proj-2" });

    const result = await links.handler({ entry_id: "a", project_id: "proj-1" });
    assert.equal(result.outbound.length, 1);
    assert.equal(result.outbound[0].target_id, "b");
  } finally {
    close();
  }
});
