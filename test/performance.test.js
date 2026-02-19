import { test } from "node:test";
import assert from "node:assert";
import { 
  getCachedQuery, 
  setCachedQuery, 
  clearQueryCache, 
  createQueryKey,
  scheduleVacuum,
  stopVacuum
} from "../src/utils/performance.js";

test("LRU cache stores and retrieves values", () => {
  clearQueryCache();
  
  const key = "test_key";
  const value = { data: "test_data" };
  
  // Should be null initially
  assert.equal(getCachedQuery(key), null);
  
  // Set and retrieve
  setCachedQuery(key, value, 1000);
  const cached = getCachedQuery(key);
  
  assert.deepEqual(cached.result, value);
  assert.ok(cached.expires > Date.now());
});

test("cache expires after TTL", async () => {
  clearQueryCache();
  
  const key = "expire_test";
  const value = { data: "expires" };
  
  setCachedQuery(key, value, 10); // 10ms TTL
  
  // Should be available immediately
  assert.ok(getCachedQuery(key));
  
  // Wait for expiration
  await new Promise(resolve => setTimeout(resolve, 20));
  
  // Should be null after expiration
  assert.equal(getCachedQuery(key), null);
});

test("createQueryKey generates consistent keys", () => {
  const key1 = createQueryKey("memory.search", { query: "test", limit: 5 });
  const key2 = createQueryKey("memory.search", { query: "test", limit: 5 });
  const key3 = createQueryKey("memory.search", { query: "different", limit: 5 });
  
  assert.equal(key1, key2);
  assert.notEqual(key1, key3);
});

test("vacuum scheduler can be started and stopped", () => {
  const mockDb = {
    exec: () => {} // Mock database
  };
  
  // Should not throw
  scheduleVacuum({ memoryDb: mockDb, kbDb: mockDb });
  stopVacuum();
  
  assert.ok(true); // Test passes if no errors thrown
});

test("cache clears all entries", () => {
  setCachedQuery("key1", { data: 1 });
  setCachedQuery("key2", { data: 2 });
  
  assert.ok(getCachedQuery("key1"));
  assert.ok(getCachedQuery("key2"));
  
  clearQueryCache();
  
  assert.equal(getCachedQuery("key1"), null);
  assert.equal(getCachedQuery("key2"), null);
});
