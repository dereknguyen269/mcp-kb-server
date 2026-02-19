import { test } from "node:test";
import assert from "node:assert";

test("config loads with defaults", async () => {
  // Import config fresh to test defaults
  const { default: config } = await import("../src/utils/config.js");
  
  assert.equal(config.logLevel, 'info');
  assert.equal(config.maxMemoryEntries, 1000);
  assert.equal(config.enableQdrant, false);
  assert.equal(config.isTest, true); // NODE_ENV=test during tests
});

test("config respects environment variables", async () => {
  // Set env var
  process.env.MAX_MEMORY_ENTRIES = '2000';
  process.env.ENABLE_QDRANT = 'true';
  
  // Re-import with cache busting
  const { default: config } = await import("../src/utils/config.js?" + Date.now());
  
  assert.equal(config.maxMemoryEntries, 2000);
  assert.equal(config.enableQdrant, true);
  
  // Cleanup
  delete process.env.MAX_MEMORY_ENTRIES;
  delete process.env.ENABLE_QDRANT;
});
