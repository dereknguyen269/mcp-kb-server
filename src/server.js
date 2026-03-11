#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import config from "./utils/config.js";
import logger from "./utils/logger.js";
import metrics, { withMetrics } from "./utils/metrics.js";
import { validateInput } from "./utils/validation.js";
import { handleError } from "./utils/errors.js";
import { scheduleVacuum, stopVacuum } from "./utils/performance.js";
import { openDatabases } from "./storage/db.js";
import { createMemoryTools } from "./tools/memory.js";
import { createKbTools } from "./tools/kb.js";
import { createSummaryTools } from "./tools/summary.js";
import { createSummaryDeltaTool } from "./tools/summaryDelta.js";
import { createDashboardTools } from "./tools/dashboard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = config.dataDir;

const require = createRequire(import.meta.url);
const { version: SERVER_VERSION } = require("../package.json");

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function writeJson(obj, framing) {
  const json = JSON.stringify(obj);
  if (framing === "lsp") {
    const len = Buffer.byteLength(json, "utf8");
    process.stdout.write(`Content-Length: ${len}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function asToolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError: false
  };
}

function buildRegistry(tools) {
  const map = new Map();
  for (const t of tools) map.set(t.name, t);
  return map;
}

function parseHeaderFramedMessages(state, chunk) {
  state.buffer += chunk;
  const messages = [];

  while (true) {
    const headerEnd = state.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const headerBlock = state.buffer.slice(0, headerEnd);
    const lines = headerBlock.split("\r\n");
    let contentLength = null;
    for (const line of lines) {
      const m = /^content-length:\s*(\d+)\s*$/i.exec(line);
      if (m) contentLength = Number(m[1]);
    }

    if (!Number.isFinite(contentLength) || contentLength < 0) {
      state.buffer = state.buffer.slice(headerEnd + 4);
      continue;
    }

    const bodyStart = headerEnd + 4;
    if (state.buffer.length < bodyStart + contentLength) break;

    const body = state.buffer.slice(bodyStart, bodyStart + contentLength);
    state.buffer = state.buffer.slice(bodyStart + contentLength);

    try {
      messages.push(JSON.parse(body));
    } catch {
      continue;
    }
  }

  return messages;
}

function parseNewlineDelimitedMessages(state, chunk) {
  state.buffer += chunk;
  const messages = [];

  while (true) {
    const newlineIdx = state.buffer.indexOf("\n");
    if (newlineIdx === -1) break;
    const line = state.buffer.slice(0, newlineIdx).trim();
    state.buffer = state.buffer.slice(newlineIdx + 1);
    if (!line) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      continue;
    }
  }

  return messages;
}

function normalizeToArray(maybeBatch) {
  return Array.isArray(maybeBatch) ? maybeBatch : [maybeBatch];
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const { memoryDb, kbDb, close } = openDatabases({ dataDir });

// Schedule database maintenance
scheduleVacuum({ memoryDb, kbDb });

process.on("exit", () => {
  stopVacuum();
  metrics.destroy();
  close();
});
process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully");
  stopVacuum();
  metrics.destroy();
  process.exit(0);
});

logger.info("MCP Knowledge Base Server starting", { dataDir });
process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  stopVacuum();
  metrics.destroy();
  process.exit(0);
});

const memoryTools = createMemoryTools({ memoryDb });
const kbTools = createKbTools({ kbDb });
const memorySearchTool = memoryTools.find((t) => t.name === "memory.search");
const kbSearchTool = kbTools.find((t) => t.name === "kb.search");
const summaryTools = createSummaryTools({ memorySearchTool, kbSearchTool });
const summaryDeltaTool = createSummaryDeltaTool({ memorySearchTool, kbSearchTool });
const dashboardTools = createDashboardTools({ memoryDb, kbDb, rootDir });

const tools = [
  ...memoryTools, 
  ...kbTools, 
  ...summaryTools, 
  summaryDeltaTool, 
  ...dashboardTools,
  // Health and metrics endpoint
  {
    name: "health.check",
    description: "Get server health status and metrics",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        detailed: { type: "boolean", default: false }
      }
    },
    handler: withMetrics("health.check", async (args) => {
      const detailed = args?.detailed || false;
      const stats = metrics.getStats();
      
      const health = {
        status: "healthy",
        timestamp: Date.now(),
        uptime: Math.round(stats.uptime),
        version: SERVER_VERSION
      };
      
      if (detailed) {
        return {
          ...health,
          metrics: stats,
          database: {
            memory_db: "connected",
            kb_db: "connected"
          }
        };
      }
      
      return health;
    })
  }
];
const registry = buildRegistry(tools);

let initialized = false;
let framing = null;
const state = { buffer: "" };
let inFlight = 0;
let stdinEnded = false;

function maybeExit() {
  if (stdinEnded && inFlight === 0) process.exit(0);
}

async function handleRequest(msg) {
  if (!isObject(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return null;

  const id = msg.id;
  const hasId = typeof id === "string" || typeof id === "number";
  const params = isObject(msg.params) ? msg.params : {};

  if (!hasId) {
    if (msg.method === "notifications/initialized") initialized = true;
    return null;
  }

  try {
    if (msg.method === "initialize") {
      const requested = params.protocolVersion;
      if (typeof requested !== "string" || requested.length === 0) {
        return jsonRpcError(id, -32602, "protocolVersion must be a string");
      }

      const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];

      initialized = false;
      return jsonRpcResult(id, {
        protocolVersion: negotiated,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "mcp-kb-server",
          version: SERVER_VERSION
        }
      });
    }

    if (!initialized && msg.method !== "ping") {
      return jsonRpcError(id, -32002, "Server not initialized");
    }

    if (msg.method === "ping") {
      return jsonRpcResult(id, {});
    }

    if (msg.method === "tools/list") {
      return jsonRpcResult(id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      });
    }

    if (msg.method === "tools/call") {
      const name = params.name;
      const args = params.arguments;
      if (typeof name !== "string" || name.length === 0) {
        return jsonRpcError(id, -32602, "name must be a string");
      }

      const tool = registry.get(name);
      if (!tool) return jsonRpcError(id, -32601, `Tool not found: ${name}`);

      logger.debug("Executing tool", { tool: name, params: args });
      const validatedArgs = validateInput(name, args);
      const result = await withMetrics(name, tool.handler)(validatedArgs);
      logger.debug("Tool executed successfully", { tool: name });
      return jsonRpcResult(id, asToolResult(result));
    }

    return jsonRpcError(id, -32601, `Method not found: ${msg.method}`);
  } catch (err) {
    const errorInfo = handleError(err, { 
      method: msg?.method, 
      toolName: msg?.params?.name,
      requestId: id 
    });
    return jsonRpcError(id, errorInfo.code, errorInfo.message);
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  if (framing === null) {
    framing = chunk.includes("Content-Length:") ? "lsp" : "newline";
  }

  const messages =
    framing === "lsp"
      ? parseHeaderFramedMessages(state, chunk)
      : parseNewlineDelimitedMessages(state, chunk);

  for (const m of messages) {
    for (const msg of normalizeToArray(m)) {
      inFlight += 1;
      try {
        const response = await handleRequest(msg);
        if (response) writeJson(response, framing);
      } finally {
        inFlight -= 1;
        maybeExit();
      }
    }
  }
});

process.stdin.on("end", () => {
  stdinEnded = true;
  maybeExit();
});
