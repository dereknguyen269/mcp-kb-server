import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { openDatabases } from "../src/storage/db.js";
import { createDashboardTools } from "../src/tools/dashboard.js";
import { makeTempDir } from "./helpers/tmp.js";

function getTool(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `missing tool: ${name}`);
  return t;
}

test("dashboard.projects writes HTML to ./temp and returns a local URL", async () => {
  const rootDir = makeTempDir("mcp-kb-dashboard-root-");
  const dataDir = path.join(rootDir, "data");

  const { memoryDb, kbDb, close } = openDatabases({ dataDir });
  try {
    const tools = createDashboardTools({ memoryDb, kbDb, rootDir });
    const dash = getTool(tools, "dashboard.projects");

    const result = await dash.handler({ project_id: "test-project", port: 0 });

    assert.ok(typeof result.dashboard_file === "string");
    assert.ok(result.dashboard_file.includes(path.join(rootDir, "temp")));
    assert.ok(fs.existsSync(result.dashboard_file));

    const html = fs.readFileSync(result.dashboard_file, "utf8");
    assert.ok(html.includes("Knowledge Base Dashboard"));

    assert.ok(typeof result.dashboard_url === "string");
    assert.ok(result.dashboard_url.includes("127.0.0.1"));
    assert.ok(result.dashboard_url.includes("project_id=test-project"));
  } finally {
    close();
  }
});

