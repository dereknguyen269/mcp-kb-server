import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(rootDir, '.env') });

/**
 * Parse an integer env var. Returns defaultValue if the var is absent,
 * empty, non-numeric, NaN, or outside [min, max].
 */
function parseIntEnv(name, defaultValue, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    process.stderr.write(
      `[config] WARNING: ${name}="${raw}" is invalid; using default ${defaultValue}\n`
    );
    return defaultValue;
  }
  return n;
}

const config = {
  // Database
  dataDir: process.env.DATA_DIR || path.join(rootDir, "data"),

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // Limits
  maxMemoryEntries: parseIntEnv('MAX_MEMORY_ENTRIES', 1000, { min: 1 }),
  maxKbEntries:     parseIntEnv('MAX_KB_ENTRIES',     500,  { min: 1 }),
  maxContentSize:   parseIntEnv('MAX_CONTENT_SIZE',   50000, { min: 1 }),
  maxKbContentSize: parseIntEnv('MAX_KB_CONTENT_SIZE', 100000, { min: 1 }),

  // Features
  enableQdrant: process.env.ENABLE_QDRANT === 'true',
  qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',

  // Dashboard
  dashboardPort: parseIntEnv('DASHBOARD_PORT', null, { min: 1024, max: 65535 }),

  // Performance
  dbTimeout:      parseIntEnv('DB_TIMEOUT',      5000,      { min: 100 }),
  vacuumInterval: parseIntEnv('VACUUM_INTERVAL',  86400000,  { min: 60000 }),

  // Environment
  nodeEnv: process.env.NODE_ENV || 'production',
  isTest:  process.env.NODE_ENV === 'test',
  isDev:   process.env.NODE_ENV === 'development'
};

export default config;
