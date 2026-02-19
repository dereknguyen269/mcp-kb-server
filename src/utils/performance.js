import config from './config.js';
import logger from './logger.js';

class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (this.cache.has(key)) {
      // Move to end (most recently used)
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return null;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }
}

// Query result cache
const queryCache = new LRUCache(50);

// Database connection pool
const connectionPool = new Map();

export function getCachedQuery(key) {
  const cached = queryCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached;
  }
  if (cached) {
    // Evict expired entry via the LRU map directly
    queryCache.cache.delete(key);
  }
  return null;
}

export function setCachedQuery(key, result, ttl = 300000) { // 5 minutes default
  queryCache.set(key, { result, expires: Date.now() + ttl });
}

export function clearQueryCache() {
  queryCache.clear();
  logger.info('Query cache cleared');
}

/**
 * Build a collision-safe cache key by JSON-serialising all parts together.
 * Using a single JSON.stringify avoids colon-separator collisions.
 */
export function createQueryKey(operation, params) {
  return JSON.stringify([operation, params]);
}

export function withCache(operation, keyParams, ttl) {
  return async (params) => {
    const key = createQueryKey(operation, keyParams);
    const cached = getCachedQuery(key);
    
    if (cached && cached.expires > Date.now()) {
      logger.debug('Cache hit', { operation, key });
      return cached.result;
    }
    
    logger.debug('Cache miss', { operation, key });
    const result = await params.handler(params);
    setCachedQuery(key, result, ttl);
    return result;
  };
}

// Database vacuum scheduler
let vacuumTimer = null;

export function scheduleVacuum(databases) {
  if (vacuumTimer) {
    clearInterval(vacuumTimer);
  }
  
  vacuumTimer = setInterval(() => {
    try {
      logger.info('Running database vacuum');
      databases.memoryDb.exec('VACUUM');
      databases.kbDb.exec('VACUUM');
      logger.info('Database vacuum completed');
    } catch (error) {
      logger.error('Database vacuum failed', { error: error.message });
    }
  }, config.vacuumInterval);
}

export function stopVacuum() {
  if (vacuumTimer) {
    clearInterval(vacuumTimer);
    vacuumTimer = null;
  }
}

// Batch operations
export function batchInsert(db, table, records, batchSize = 100) {
  const batches = [];
  for (let i = 0; i < records.length; i += batchSize) {
    batches.push(records.slice(i, i + batchSize));
  }
  
  const transaction = db.transaction((batch) => {
    for (const record of batch) {
      // This would be customized per table
      db.prepare(`INSERT INTO ${table} VALUES (?)`).run(record);
    }
  });
  
  for (const batch of batches) {
    transaction(batch);
  }
}

// Connection pooling for external services
export function getPooledConnection(service, factory) {
  if (!connectionPool.has(service)) {
    connectionPool.set(service, factory());
  }
  return connectionPool.get(service);
}

export function closeAllConnections() {
  for (const [service, connection] of connectionPool) {
    try {
      if (connection.close) connection.close();
      if (connection.destroy) connection.destroy();
    } catch (error) {
      logger.warn(`Failed to close connection for ${service}`, { error: error.message });
    }
  }
  connectionPool.clear();
}
