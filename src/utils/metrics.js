import logger from './logger.js';
import config from './config.js';

class Metrics {
  constructor() {
    this.data = {
      requests: {
        total: 0,
        success: 0,
        errors: 0,
        byMethod: new Map()
      },
      performance: {
        avgResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        totalResponseTime: 0
      },
      database: {
        queries: 0,
        queryTime: 0,
        avgQueryTime: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0
      },
      memory: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0
      },
      uptime: process.uptime(),
      startTime: Date.now()
    };
    
    // Update memory stats every 30 seconds
    if (!config.isTest) {
      this.memoryInterval = setInterval(() => {
        this.updateMemoryStats();
      }, 30000);
      if (this.memoryInterval.unref) {
        this.memoryInterval.unref();
      }
    } else {
      this.memoryInterval = null;
    }
  }

  recordRequest(method, responseTime, success = true) {
    this.data.requests.total++;
    
    if (success) {
      this.data.requests.success++;
    } else {
      this.data.requests.errors++;
    }
    
    // Track by method
    const current = this.data.requests.byMethod.get(method) || { count: 0, totalTime: 0 };
    current.count++;
    current.totalTime += responseTime;
    this.data.requests.byMethod.set(method, current);
    
    // Update performance metrics
    this.data.performance.totalResponseTime += responseTime;
    this.data.performance.avgResponseTime = this.data.performance.totalResponseTime / this.data.requests.total;
    this.data.performance.minResponseTime = Math.min(this.data.performance.minResponseTime, responseTime);
    this.data.performance.maxResponseTime = Math.max(this.data.performance.maxResponseTime, responseTime);
  }

  recordDatabaseQuery(queryTime) {
    this.data.database.queries++;
    this.data.database.queryTime += queryTime;
    this.data.database.avgQueryTime = this.data.database.queryTime / this.data.database.queries;
  }

  recordCacheHit() {
    this.data.cache.hits++;
    this.updateCacheHitRate();
  }

  recordCacheMiss() {
    this.data.cache.misses++;
    this.updateCacheHitRate();
  }

  updateCacheHitRate() {
    const total = this.data.cache.hits + this.data.cache.misses;
    this.data.cache.hitRate = total > 0 ? (this.data.cache.hits / total) * 100 : 0;
  }

  updateMemoryStats() {
    const memUsage = process.memoryUsage();
    this.data.memory = {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      rss: Math.round(memUsage.rss / 1024 / 1024) // MB
    };
    this.data.uptime = process.uptime();
  }

  getStats() {
    this.updateMemoryStats();
    
    // Convert method stats to object
    const methodStats = {};
    for (const [method, stats] of this.data.requests.byMethod) {
      methodStats[method] = {
        count: stats.count,
        avgTime: stats.count > 0 ? stats.totalTime / stats.count : 0
      };
    }
    
    return {
      ...this.data,
      requests: {
        ...this.data.requests,
        byMethod: methodStats,
        errorRate: this.data.requests.total > 0 ? 
          (this.data.requests.errors / this.data.requests.total) * 100 : 0
      },
      timestamp: Date.now()
    };
  }

  reset() {
    this.data.requests = { total: 0, success: 0, errors: 0, byMethod: new Map() };
    this.data.performance = { avgResponseTime: 0, minResponseTime: Infinity, maxResponseTime: 0, totalResponseTime: 0 };
    this.data.database = { queries: 0, queryTime: 0, avgQueryTime: 0 };
    this.data.cache = { hits: 0, misses: 0, hitRate: 0 };
    this.data.startTime = Date.now();
    logger.info('Metrics reset');
  }

  destroy() {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
    }
  }
}

// Global metrics instance
const metrics = new Metrics();

export default metrics;

// Middleware function for request timing
export function withMetrics(toolName, handler) {
  return async (params) => {
    const startTime = Date.now();
    let success = true;
    
    try {
      const result = await handler(params);
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const responseTime = Date.now() - startTime;
      metrics.recordRequest(toolName, responseTime, success);
      
      if (responseTime > 1000) { // Log slow requests
        logger.warn('Slow request detected', { 
          tool: toolName, 
          responseTime: `${responseTime}ms` 
        });
      }
    }
  };
}

// Database query timing wrapper
export function withDatabaseMetrics(queryFn) {
  return (...args) => {
    const startTime = Date.now();
    try {
      const result = queryFn(...args);
      const queryTime = Date.now() - startTime;
      metrics.recordDatabaseQuery(queryTime);
      return result;
    } catch (error) {
      const queryTime = Date.now() - startTime;
      metrics.recordDatabaseQuery(queryTime);
      throw error;
    }
  };
}
