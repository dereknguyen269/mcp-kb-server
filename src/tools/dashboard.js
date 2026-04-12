import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import logger from "../utils/logger.js";
import { detectProjectId, validateProjectRoot } from "../utils/projectId.js";

let serverState = null;

function asLimit(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isFinite(value)) return defaultValue;
  const n = Math.trunc(value);
  if (n <= 0) return defaultValue;
  return Math.min(n, 200);
}

function expectOptionalString(value, name) {
  if (value === undefined) return;
  if (typeof value !== "string") {
    const error = new Error(`${name} must be a string`);
    error.code = -32602;
    throw error;
  }
}

function expectOptionalNumber(value, name) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    const error = new Error(`${name} must be a number`);
    error.code = -32602;
    throw error;
  }
}

function expectString(value, name) {
  if (typeof value !== "string") {
    const error = new Error(`${name} must be a string`);
    error.code = -32602;
    throw error;
  }
}

function json(res, statusCode, body) {
  const text = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end("Not Found");
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(message);
}

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) { reject(new Error("Body too large")); req.destroy(); }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function resolveProjectId({ project_id, project_root }) {
  if (project_root !== undefined) {
    const normalized = validateProjectRoot(project_root);
    const detection = detectProjectId(normalized, { explicitProjectId: project_id });
    return detection.project_id;
  }
  if (project_id !== undefined) return project_id.trim() || "legacy";
  return null;
}

function getLatestProjectId(memoryDb) {
  try {
    const row = memoryDb.prepare("SELECT project_id FROM memory ORDER BY created_at DESC LIMIT 1").get();
    return typeof row?.project_id === "string" && row.project_id.trim() ? row.project_id : "legacy";
  } catch {
    return "legacy";
  }
}


function generateDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KB Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Fira+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"><\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --font: 'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;
      --blue: #2563EB;
      --blue-light: #EFF6FF;
      --blue-dark: #1D4ED8;
      --orange: #F97316;
      --red: #EF4444;
      --red-light: #FEF2F2;
      --green: #16A34A;
      --green-light: #F0FDF4;
      --radius-sm: 6px;
      --radius: 10px;
      --radius-lg: 14px;
      --transition: 150ms ease;
    }
    [data-theme="light"] {
      --bg: #F8FAFC;
      --bg-panel: #FFFFFF;
      --bg-sidebar: #FAFBFC;
      --bg-hover: #F1F5F9;
      --bg-active: #EFF6FF;
      --border: #E2E8F0;
      --border-active: #2563EB;
      --text: #1E293B;
      --text-muted: #64748B;
      --text-faint: #94A3B8;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
      --shadow: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
      --shadow-lg: 0 10px 30px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.06);
    }
    [data-theme="dark"] {
      --bg: #0D1117;
      --bg-panel: #161B22;
      --bg-sidebar: #161B22;
      --bg-hover: #21262D;
      --bg-active: #1C2A3A;
      --border: #30363D;
      --border-active: #3B82F6;
      --text: #E6EDF3;
      --text-muted: #8B949E;
      --text-faint: #484F58;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.4);
      --shadow: 0 4px 12px rgba(0,0,0,0.4);
      --shadow-lg: 0 10px 30px rgba(0,0,0,0.5);
    }

html, body { height: 100%; font-family: var(--font); background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.5; }
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }
code, .mono { font-family: var(--font-mono); }

/* Layout */
.app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.topbar {
  display: flex; align-items: center; gap: 12px; padding: 0 16px;
  height: 56px; background: var(--bg-panel); border-bottom: 1px solid var(--border);
  flex-shrink: 0; box-shadow: var(--shadow-sm);
}
.topbar-brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex-shrink: 0; }
.brand-icon {
  width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
  background: linear-gradient(135deg, #2563EB, #7C3AED);
  display: flex; align-items: center; justify-content: center;
}
.brand-icon svg { width: 16px; height: 16px; color: #fff; }
.brand-name { font-size: 15px; font-weight: 600; color: var(--text); white-space: nowrap; }
.topbar-sep { width: 1px; height: 24px; background: var(--border); flex-shrink: 0; }
.topbar-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }

.body { display: flex; flex: 1; overflow: hidden; }

/* Sidebar */
.sidebar {
  width: 300px; flex-shrink: 0; background: var(--bg-sidebar);
  border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden;
}
.sidebar-header {
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0;
}
.sidebar-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted); }
.sidebar-count { font-size: 11px; color: var(--text-faint); background: var(--bg-hover); padding: 2px 7px; border-radius: 99px; }
.sidebar-search { padding: 10px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.search-wrap { position: relative; }
.search-wrap svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: var(--text-faint); pointer-events: none; }
.search-input {
  width: 100%; padding: 7px 10px 7px 32px; font-size: 13px; font-family: var(--font);
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
  color: var(--text); outline: none; transition: border-color var(--transition);
}
.search-input:focus { border-color: var(--blue); }
.search-input::placeholder { color: var(--text-faint); }
.doc-list { flex: 1; overflow-y: auto; padding: 6px; }
.doc-item {
  padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer;
  transition: background var(--transition); border: 1px solid transparent; margin-bottom: 2px;
}
.doc-item:hover { background: var(--bg-hover); }
.doc-item.active { background: var(--bg-active); border-color: var(--border-active); }
.doc-item-title { font-size: 13px; font-weight: 500; color: var(--text); line-height: 1.35; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.doc-item.active .doc-item-title { color: var(--blue); }
.doc-item-meta { display: flex; gap: 5px; flex-wrap: wrap; }
.tag { font-size: 11px; padding: 2px 7px; border-radius: 99px; background: var(--bg-hover); color: var(--text-muted); border: 1px solid var(--border); white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.doc-item.active .tag { background: #DBEAFE; color: #1D4ED8; border-color: #BFDBFE; }
[data-theme="dark"] .doc-item.active .tag { background: #1E3A5F; color: #93C5FD; border-color: #1E40AF; }
.empty-state { padding: 32px 16px; text-align: center; color: var(--text-faint); font-size: 13px; }
.empty-state svg { width: 32px; height: 32px; margin: 0 auto 10px; display: block; opacity: 0.4; }

/* Main content */
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.main-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); background: var(--bg-panel); flex-shrink: 0; padding: 0 16px; }
.tab-btn {
  padding: 14px 16px; font-size: 13px; font-weight: 500; color: var(--text-muted);
  border: none; background: none; cursor: pointer; border-bottom: 2px solid transparent;
  margin-bottom: -1px; transition: color var(--transition), border-color var(--transition);
  display: flex; align-items: center; gap: 6px;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--blue); border-bottom-color: var(--blue); }
.tab-btn svg { width: 14px; height: 14px; }
.tab-panel { flex: 1; overflow: hidden; display: none; }
.tab-panel.active { display: flex; flex-direction: column; }

/* Document viewer */
.doc-view { flex: 1; overflow-y: auto; padding: 24px; }
.doc-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-faint); gap: 12px; }
.doc-placeholder svg { width: 48px; height: 48px; opacity: 0.3; }
.doc-placeholder p { font-size: 14px; }
.doc-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
.doc-header-left { min-width: 0; }
.doc-title { font-size: 20px; font-weight: 600; color: var(--text); line-height: 1.3; margin-bottom: 8px; }
.doc-source { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 5px; }
.doc-source svg { width: 12px; height: 12px; flex-shrink: 0; }
.doc-source a { color: var(--blue); }
.doc-id-badge { font-size: 11px; color: var(--text-faint); background: var(--bg-hover); padding: 3px 8px; border-radius: 99px; border: 1px solid var(--border); white-space: nowrap; flex-shrink: 0; }
.doc-actions { display: flex; gap: 8px; flex-shrink: 0; }
.doc-body { font-size: 14px; line-height: 1.7; color: var(--text); }

/* Markdown */
.md h1,.md h2,.md h3,.md h4 { font-weight: 600; color: var(--text); margin: 1.4em 0 0.5em; line-height: 1.3; }
.md h1 { font-size: 22px; } .md h2 { font-size: 18px; } .md h3 { font-size: 15px; }
.md p { margin-bottom: 0.9em; }
.md ul,.md ol { padding-left: 1.5em; margin-bottom: 0.9em; }
.md li { margin-bottom: 0.3em; }
.md code { font-size: 12px; background: var(--bg-hover); padding: 2px 5px; border-radius: 4px; border: 1px solid var(--border); font-family: 'SF Mono', 'Fira Code', monospace; }
.md pre { background: var(--bg-hover); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; overflow-x: auto; margin-bottom: 1em; }
.md pre code { background: none; border: none; padding: 0; font-size: 13px; }
.md blockquote { border-left: 3px solid var(--border-active); padding-left: 14px; color: var(--text-muted); margin-bottom: 0.9em; }
.md a { color: var(--blue); }
.md hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
.md table { width: 100%; border-collapse: collapse; margin-bottom: 1em; font-size: 13px; }
.md th { background: var(--bg-hover); font-weight: 600; text-align: left; padding: 8px 12px; border: 1px solid var(--border); }
.md td { padding: 8px 12px; border: 1px solid var(--border); }
.md strong { font-weight: 600; }

/* Edit panel */
.edit-panel { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
.edit-panel-header { padding: 14px 20px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; background: var(--bg-panel); }
.edit-panel-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.edit-panel-meta { display: flex; align-items: center; gap: 8px; }
.edit-toolbar { padding: 6px 10px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 2px; flex-shrink: 0; background: var(--bg-panel); flex-wrap: wrap; }
.toolbar-btn {
  padding: 4px 8px; font-size: 12px; font-weight: 600; font-family: var(--font-mono);
  border: 1px solid transparent; border-radius: var(--radius-sm); background: none;
  color: var(--text-muted); cursor: pointer; transition: background var(--transition), color var(--transition);
  line-height: 1.4; white-space: nowrap;
}
.toolbar-btn:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border); }
.toolbar-sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; flex-shrink: 0; }
.toolbar-view-group { display: flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; margin-left: auto; }
.toolbar-view-btn { padding: 4px 10px; font-size: 11px; font-weight: 500; background: none; border: none; color: var(--text-muted); cursor: pointer; transition: background var(--transition), color var(--transition); }
.toolbar-view-btn.active { background: var(--bg-hover); color: var(--text); }
.editor-body { display: flex; flex: 1; overflow: hidden; }
.editor-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.editor-pane + .editor-pane { border-left: 1px solid var(--border); }
.editor-pane-label { padding: 4px 12px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-faint); background: var(--bg-hover); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.editor-textarea {
  flex: 1; resize: none; border: none; outline: none; padding: 16px 20px;
  font-family: var(--font-mono); font-size: 13px; line-height: 1.7; color: var(--text);
  background: var(--bg); tab-size: 2;
}
.editor-preview { flex: 1; overflow-y: auto; padding: 16px 20px; background: var(--bg-panel); }
.editor-footer { padding: 8px 16px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 10px; flex-shrink: 0; background: var(--bg-panel); }
.editor-charcount { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); margin-right: auto; }
.edit-dirty { font-size: 11px; color: var(--orange); font-weight: 500; }

/* Edit form (legacy — keep for modal use) */
.edit-form { padding: 24px; display: flex; flex-direction: column; gap: 16px; max-width: 800px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 500; color: var(--text-muted); }
.field input, .field textarea, .field select {
  font-family: var(--font); font-size: 13px; color: var(--text);
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 8px 10px; outline: none; transition: border-color var(--transition);
}
.field input:focus, .field textarea:focus, .field select:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
.field textarea { min-height: 280px; resize: vertical; line-height: 1.6; }
.form-actions { display: flex; gap: 8px; }

    /* Memory tab */
    .memory-view { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .memory-card {
      background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 14px 16px; box-shadow: var(--shadow-sm);
    }
    .memory-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .scope-badge { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 99px; background: var(--blue-light); color: var(--blue); border: 1px solid #BFDBFE; font-family: var(--font-mono); }
    [data-theme="dark"] .scope-badge { background: #1E3A5F; color: #93C5FD; border-color: #1E40AF; }
    .memory-date { font-size: 11px; color: var(--text-faint); margin-left: auto; font-family: var(--font-mono); }
    .memory-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
    .memory-content { font-size: 13px; color: var(--text-muted); line-height: 1.6; }
    .memory-content.md { color: var(--text); }

    /* Sources tab */
    .sources-view { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .source-card {
      background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 12px 16px; box-shadow: var(--shadow-sm); cursor: pointer;
      transition: border-color var(--transition), background var(--transition);
      display: flex; align-items: center; gap: 12px;
    }
    .source-card:hover { border-color: var(--border-active); background: var(--bg-hover); }
    .source-icon {
      width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; font-family: var(--font-mono); letter-spacing: -0.5px;
    }
    .source-icon.md { background: #DBEAFE; color: #1D4ED8; }
    .source-icon.pdf { background: #FEE2E2; color: #B91C1C; }
    .source-icon.csv { background: #D1FAE5; color: #065F46; }
    .source-icon.txt { background: #F3F4F6; color: #374151; }
    .source-icon.json { background: #FEF3C7; color: #92400E; }
    .source-icon.other { background: var(--bg-hover); color: var(--text-muted); }
    [data-theme="dark"] .source-icon.md { background: #1E3A5F; color: #93C5FD; }
    [data-theme="dark"] .source-icon.pdf { background: #450A0A; color: #FCA5A5; }
    [data-theme="dark"] .source-icon.csv { background: #064E3B; color: #6EE7B7; }
    [data-theme="dark"] .source-icon.txt { background: #21262D; color: #8B949E; }
    [data-theme="dark"] .source-icon.json { background: #451A03; color: #FCD34D; }
    .source-info { flex: 1; min-width: 0; }
    .source-name { font-size: 13px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
    .source-meta { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); display: flex; gap: 10px; }

    /* Split panel layout (Memory / Sources tabs) */
    .split { display: flex; flex: 1; overflow: hidden; }
    .split-list { width: 300px; flex-shrink: 0; border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; background: var(--bg-sidebar); }
    .split-list-header { padding: 10px 14px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; background: var(--bg-panel); }
    .split-list-search { padding: 8px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .split-list-items { flex: 1; overflow-y: auto; padding: 6px; }
    .split-list-footer { padding: 8px 10px; border-top: 1px solid var(--border); flex-shrink: 0; }
    .split-detail { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .split-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-faint); gap: 12px; }
    .split-placeholder svg { width: 48px; height: 48px; opacity: 0.3; }
    .split-placeholder p { font-size: 14px; }
    .detail-scroll { flex: 1; overflow-y: auto; }
    .detail-header { padding: 18px 24px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .detail-body { padding: 20px 24px; }
    .mem-item { padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer; transition: background var(--transition); border: 1px solid transparent; margin-bottom: 2px; }
    .mem-item:hover { background: var(--bg-hover); }
    .mem-item.active { background: var(--bg-active); border-color: var(--border-active); }
    .mem-item-scope { font-size: 11px; font-weight: 600; color: var(--blue); font-family: var(--font-mono); margin-bottom: 3px; }
    .mem-item-preview { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.4; }
    .mem-item-date { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); margin-top: 3px; }
    .src-item { padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer; transition: background var(--transition); border: 1px solid transparent; margin-bottom: 2px; display: flex; align-items: center; gap: 10px; }
    .src-item:hover { background: var(--bg-hover); }
    .src-item.active { background: var(--bg-active); border-color: var(--border-active); }
    .src-item-info { flex: 1; min-width: 0; }
    .src-item-name { font-size: 13px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
    .src-item.active .src-item-name { color: var(--blue); }
    .src-item-meta { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); }

    /* Links tab */
    .links-view { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .links-search-bar { display: flex; gap: 8px; align-items: center; flex-shrink: 0; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--bg-panel); }
    .link-group { background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-sm); }
    .link-group-header { padding: 10px 14px; background: var(--bg-hover); border-bottom: 1px solid var(--border); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
    .link-row { padding: 10px 14px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
    .link-row:last-child { border-bottom: none; }
    .link-type-badge { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); background: var(--bg-hover); color: var(--text-muted); border: 1px solid var(--border); flex-shrink: 0; }
    .link-relation { font-size: 11px; color: var(--blue); font-style: italic; }
    .link-id { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); }

    /* Lint tab */
    .lint-view { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
    .lint-section { background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-sm); }
    .lint-section-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
    .lint-section-title { font-size: 13px; font-weight: 600; color: var(--text); }
    .lint-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; }
    .lint-badge.warn { background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A; }
    .lint-badge.ok { background: #D1FAE5; color: #065F46; border: 1px solid #A7F3D0; }
    .lint-badge.err { background: #FEE2E2; color: #B91C1C; border: 1px solid #FECACA; }
    [data-theme="dark"] .lint-badge.warn { background: #451A03; color: #FCD34D; border-color: #78350F; }
    [data-theme="dark"] .lint-badge.ok { background: #064E3B; color: #6EE7B7; border-color: #065F46; }
    [data-theme="dark"] .lint-badge.err { background: #450A0A; color: #FCA5A5; border-color: #7F1D1D; }
    .lint-row { padding: 10px 16px; border-bottom: 1px solid var(--border); font-size: 13px; display: flex; align-items: flex-start; gap: 10px; }
    .lint-row:last-child { border-bottom: none; }
    .lint-row-id { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); flex-shrink: 0; padding-top: 1px; }
    .lint-row-text { color: var(--text-muted); line-height: 1.5; min-width: 0; }
    .lint-summary { padding: 14px 16px; font-size: 13px; color: var(--text-muted); font-style: italic; }
    /* Buttons */
    .btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px;
      font-size: 13px; font-weight: 500; font-family: var(--font); border-radius: var(--radius-sm);
      border: 1px solid var(--border); background: var(--bg-panel); color: var(--text);
      cursor: pointer; transition: background var(--transition), border-color var(--transition), color var(--transition);
      white-space: nowrap; text-decoration: none;
    }
    .btn:hover { background: var(--bg-hover); }
    .btn svg { width: 14px; height: 14px; flex-shrink: 0; }
    .btn-primary { background: var(--blue); border-color: var(--blue-dark); color: #fff; }
    .btn-primary:hover { background: var(--blue-dark); border-color: var(--blue-dark); }
    .btn-danger { color: var(--red); border-color: #FECACA; background: var(--red-light); }
    .btn-danger:hover { background: #FEE2E2; border-color: #FCA5A5; }
    [data-theme="dark"] .btn-danger { background: #2D1515; border-color: #7F1D1D; }
    [data-theme="dark"] .btn-danger:hover { background: #3D1515; }
    .btn-sm { padding: 5px 10px; font-size: 12px; }
    .btn-icon { padding: 7px; }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; pointer-events: none; }

    /* Select & inputs in topbar */
    .topbar-select {
      font-family: var(--font); font-size: 13px; color: var(--text);
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 6px 10px; outline: none; cursor: pointer; max-width: 200px;
    }
    .topbar-select:focus { border-color: var(--blue); }

    /* Modal */
    .modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: none; align-items: center; justify-content: center; padding: 20px; z-index: 100; backdrop-filter: blur(2px); }
    .modal-mask.open { display: flex; }
    .modal { background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); width: min(640px, 100%); overflow: hidden; }
    .modal-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
    .modal-title { font-size: 15px; font-weight: 600; }
    .modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
    .modal-footer { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }

    /* Toast */
    .toast-host { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 200; }
    .toast {
      padding: 10px 14px; border-radius: var(--radius); border: 1px solid var(--border);
      background: var(--bg-panel); box-shadow: var(--shadow); font-size: 13px; color: var(--text);
      max-width: 360px; transition: opacity 0.3s, transform 0.3s;
    }
    .toast.ok { border-color: #BBF7D0; background: var(--green-light); color: #15803D; }
    .toast.err { border-color: #FECACA; background: var(--red-light); color: #B91C1C; }
    [data-theme="dark"] .toast.ok { background: #14532D; border-color: #166534; color: #86EFAC; }
    [data-theme="dark"] .toast.err { background: #450A0A; border-color: #7F1D1D; color: #FCA5A5; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-faint); }

    /* Divider */
    .divider { height: 1px; background: var(--border); margin: 4px 0; }

    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0ms !important; } }
    @media (max-width: 768px) {
      .sidebar { width: 100%; position: fixed; inset: 56px 0 0 0; z-index: 50; transform: translateX(-100%); transition: transform 0.2s ease; }
      .sidebar.open { transform: translateX(0); }
      .form-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<div class="app">

  <!-- Topbar -->
  <header class="topbar">
    <div class="topbar-brand">
      <div class="brand-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </div>
      <span class="brand-name">KB Dashboard</span>
    </div>
    <div class="topbar-sep"></div>
    <label for="projectSelect" style="font-size:12px;color:var(--text-muted);white-space:nowrap">Project</label>
    <select id="projectSelect" class="topbar-select"></select>
    <button class="btn btn-sm" id="newProjectBtn" title="New project">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
    <div class="topbar-right">
      <button class="btn btn-sm btn-danger" id="deleteProjectBtn" title="Delete project">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        Delete Project
      </button>
      <button class="btn btn-sm" id="themeBtn" title="Toggle theme">
        <svg id="themeIconLight" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg id="themeIconDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <button class="btn btn-sm" id="importBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Import
      </button>
      <button class="btn btn-primary btn-sm" id="addBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Document
      </button>
    </div>
  </header>

  <div class="body">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Knowledge Base</span>
        <span class="sidebar-count" id="kbCount">0</span>
        <button class="btn btn-sm btn-icon" id="kbExportBtn" title="Export as Markdown" style="margin-left:auto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>
      <div class="sidebar-search">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="searchInput" class="search-input" placeholder="Search documents…" autocomplete="off">
        </div>
      </div>
      <div class="doc-list" id="docList">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <p>No documents yet</p>
        </div>
      </div>
      <div id="kbLoadMoreWrap" style="display:none;padding:8px 10px;border-top:1px solid var(--border);flex-shrink:0">
        <button class="btn btn-sm" style="width:100%" id="kbLoadMoreBtn">Load more</button>
      </div>
    </aside>

    <!-- Main -->
    <main class="main">
      <div class="main-tabs">
        <button class="tab-btn active" data-tab="document" id="tabDocument">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          KB
        </button>
        <button class="tab-btn" data-tab="memory" id="tabMemory">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
          Memory
          <span id="memoryBadge" style="font-size:11px;background:var(--bg-hover);color:var(--text-muted);padding:1px 6px;border-radius:99px;border:1px solid var(--border);font-family:var(--font-mono)">0</span>
        </button>
        <button class="tab-btn" data-tab="sources" id="tabSources">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          Sources
          <span id="sourcesBadge" style="font-size:11px;background:var(--bg-hover);color:var(--text-muted);padding:1px 6px;border-radius:99px;border:1px solid var(--border);font-family:var(--font-mono)">0</span>
        </button>
        <button class="tab-btn" data-tab="links" id="tabLinks">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Links
        </button>
        <button class="tab-btn" data-tab="lint" id="tabLint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          Lint
        </button>
      </div>

      <!-- Document tab -->
      <div class="tab-panel active" id="panelDocument">
        <div class="doc-view" id="docView">
          <div class="doc-placeholder" id="docPlaceholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <p>Select a document to view</p>
          </div>
          <div id="docContent" style="display:none">
            <div class="doc-header">
              <div class="doc-header-left">
                <div class="doc-title" id="docTitle"></div>
                <div class="doc-source" id="docSourceWrap" style="display:none">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  <span id="docSource"></span>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="doc-id-badge" id="docIdBadge"></span>
                <div class="doc-actions">
                  <button class="btn btn-sm" id="editBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit
                  </button>
                  <button class="btn btn-sm btn-danger" id="deleteBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    Delete
                  </button>
                </div>
              </div>
            </div>
            <div class="doc-body md" id="docBody"></div>
          </div>

          <!-- Edit panel (full-height split editor) -->
          <div id="editForm" style="display:none;flex-direction:column;flex:1;overflow:hidden" class="edit-panel">
            <div class="edit-panel-header">
              <div class="edit-panel-fields">
                <div class="field"><label>Title</label><input id="editTitle" placeholder="Document title"></div>
                <div class="field"><label>Source URL (optional)</label><input id="editSource" placeholder="https://…"></div>
              </div>
              <div class="edit-panel-meta">
                <span class="edit-dirty" id="editDirty" style="display:none">● Unsaved</span>
                <span style="font-size:11px;color:var(--text-faint)">Cmd/Ctrl+S to save · Esc to cancel</span>
              </div>
            </div>
            <div class="edit-toolbar">
              <button class="toolbar-btn" data-action="bold" title="Bold (Ctrl+B)"><b>B</b></button>
              <button class="toolbar-btn" data-action="italic" title="Italic (Ctrl+I)"><i>I</i></button>
              <button class="toolbar-btn" data-action="strike" title="Strikethrough"><s>S</s></button>
              <div class="toolbar-sep"></div>
              <button class="toolbar-btn" data-action="h1" title="Heading 1">H1</button>
              <button class="toolbar-btn" data-action="h2" title="Heading 2">H2</button>
              <button class="toolbar-btn" data-action="h3" title="Heading 3">H3</button>
              <div class="toolbar-sep"></div>
              <button class="toolbar-btn" data-action="ul" title="Bullet list">• List</button>
              <button class="toolbar-btn" data-action="ol" title="Numbered list">1. List</button>
              <button class="toolbar-btn" data-action="quote" title="Blockquote">" Quote</button>
              <div class="toolbar-sep"></div>
              <button class="toolbar-btn" data-action="code" title="Inline code">\`code\`</button>
              <button class="toolbar-btn" data-action="codeblock" title="Code block">&#96;&#96;&#96;</button>
              <button class="toolbar-btn" data-action="link" title="Link">Link</button>
              <div class="toolbar-sep"></div>
              <button class="toolbar-btn" data-action="hr" title="Horizontal rule">—</button>
              <div class="toolbar-view-group">
                <button class="toolbar-view-btn active" id="viewBoth">Split</button>
                <button class="toolbar-view-btn" id="viewEdit">Edit</button>
                <button class="toolbar-view-btn" id="viewPreview">Preview</button>
              </div>
            </div>
            <div class="editor-body" id="editorBody">
              <div class="editor-pane" id="editorWritePane">
                <div class="editor-pane-label">Markdown</div>
                <textarea class="editor-textarea" id="editContent" spellcheck="false" placeholder="Write markdown here…"></textarea>
              </div>
              <div class="editor-pane" id="editorPreviewPane">
                <div class="editor-pane-label">Preview</div>
                <div class="editor-preview md" id="editPreview"></div>
              </div>
            </div>
            <div class="editor-footer">
              <span class="editor-charcount" id="editCharCount">0 chars</span>
              <button class="btn" id="cancelEditBtn">Cancel</button>
              <button class="btn btn-primary" id="saveEditBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Memory tab -->
      <div class="tab-panel" id="panelMemory">
        <div class="split">
          <div class="split-list">
            <div class="split-list-header">
              <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted)">Memory</span>
              <span style="font-size:11px;color:var(--text-faint);background:var(--bg-hover);padding:2px 7px;border-radius:99px" id="memoryMeta">0</span>
              <button class="btn btn-sm btn-icon" id="memExportBtn" title="Export as Markdown" style="margin-left:4px">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
            </div>
            <div class="split-list-items" id="memoryList"></div>
            <div class="split-list-footer" id="memLoadMoreWrap" style="display:none">
              <button class="btn btn-sm" style="width:100%" id="memLoadMoreBtn">Load more</button>
            </div>
          </div>
          <div class="split-detail" id="memDetail">
            <div class="split-placeholder" id="memPlaceholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
              <p>Select an entry to view</p>
            </div>
            <div id="memContent" style="display:none" class="detail-scroll">
              <div class="detail-header">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                  <span class="scope-badge" id="memDetailScope"></span>
                  <span style="font-size:11px;color:var(--text-faint);font-family:var(--font-mono)" id="memDetailDate"></span>
                  <button class="btn btn-sm btn-danger" style="margin-left:auto" id="memDeleteBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    Delete
                  </button>
                </div>
                <div id="memDetailTags" style="display:flex;gap:4px;flex-wrap:wrap"></div>
              </div>
              <div class="detail-body">
                <div class="memory-content md" id="memDetailBody"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sources tab -->
      <div class="tab-panel" id="panelSources">
        <div class="split">
          <div class="split-list">
            <div class="split-list-header">
              <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted)">Sources</span>
              <span style="font-size:11px;color:var(--text-faint);background:var(--bg-hover);padding:2px 7px;border-radius:99px" id="sourcesMeta">0</span>
            </div>
            <div class="split-list-search">
              <div class="search-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input id="sourcesSearch" class="search-input" placeholder="Search sources…" autocomplete="off">
              </div>
            </div>
            <div class="split-list-items" id="sourcesList"></div>
            <div class="split-list-footer" id="srcLoadMoreWrap" style="display:none">
              <button class="btn btn-sm" style="width:100%" id="srcLoadMoreBtn">Load more</button>
            </div>
          </div>
          <div class="split-detail" id="srcDetail">
            <div class="split-placeholder" id="srcPlaceholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
              <p>Select a source to view</p>
            </div>
            <div id="srcContent" style="display:none;flex-direction:column;height:100%">
              <div class="detail-header">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                  <span style="font-size:15px;font-weight:600;color:var(--text)" id="srcDetailName"></span>
                  <span style="font-size:11px;color:var(--text-faint);font-family:var(--font-mono)" id="srcDetailMeta"></span>
                </div>
              </div>
              <div style="flex:1;overflow-y:auto;padding:20px 24px">
                <pre style="font-size:12px;line-height:1.7;white-space:pre-wrap;font-family:var(--font-mono);color:var(--text-muted);margin:0" id="srcDetailBody"></pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Links tab -->
      <div class="tab-panel" id="panelLinks">
        <div class="links-search-bar">
          <div class="search-wrap" style="flex:1;max-width:360px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="linksEntryInput" class="search-input" placeholder="Entry ID to look up links…" autocomplete="off" style="font-family:var(--font-mono)">
          </div>
          <button class="btn btn-primary btn-sm" id="linksLookupBtn">Look up</button>
          <span style="font-size:12px;color:var(--text-faint);font-family:var(--font-mono)" id="linksMeta"></span>
        </div>
        <div class="links-view" id="linksList">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <p>Enter an entry ID to view its cross-references</p>
          </div>
        </div>
      </div>

      <!-- Lint tab -->
      <div class="tab-panel" id="panelLint">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:var(--bg-panel)">
          <span style="font-size:12px;color:var(--text-muted)" id="lintMeta">Run a health check on your wiki</span>
          <button class="btn btn-primary btn-sm" id="lintRunBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            Run Lint
          </button>
        </div>
        <div class="lint-view" id="lintResults">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <p>Click "Run Lint" to check for orphans, broken links, and stale sources</p>
          </div>
        </div>
      </div>
    </main>
  </div>
</div>

<!-- Add Document Modal -->
<div class="modal-mask" id="addModal">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">New Document</span>
      <button class="btn btn-icon btn-sm" id="addModalClose" title="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="field"><label>Title</label><input id="addTitle" placeholder="Document title"></div>
        <div class="field"><label>Source URL (optional)</label><input id="addSource" placeholder="https://…"></div>
      </div>
      <div class="field"><label>Content (Markdown)</label><textarea id="addContent" style="min-height:200px" placeholder="Write your content here…"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn" id="addModalCancel">Cancel</button>
      <button class="btn btn-primary" id="addModalSave">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Document
      </button>
    </div>
  </div>
</div>

<!-- Import KB Modal -->
<div class="modal-mask" id="importModal">
  <div class="modal" style="width:min(560px,100%)">
    <div class="modal-header">
      <span class="modal-title">Import Knowledge Base</span>
      <button class="btn btn-icon btn-sm" id="importClose">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label>File <span style="color:var(--text-faint);font-weight:400">(JSON array or .md file)</span></label>
        <input type="file" id="importFile" accept=".json,.md" style="font-family:var(--font);font-size:13px;color:var(--text)">
      </div>
      <div style="font-size:12px;color:var(--text-faint);line-height:1.6">
        JSON format: <code style="font-family:var(--font-mono);background:var(--bg-hover);padding:1px 5px;border-radius:4px">[{"title":"…","content":"…","source":"…"}]</code><br>
        .md file: imported as a single document using the filename as title.
      </div>
      <div id="importPreview" style="display:none">
        <div style="font-size:12px;font-weight:500;color:var(--text-muted);margin-bottom:6px" id="importPreviewLabel"></div>
        <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:var(--bg-hover)">
              <th style="padding:6px 10px;text-align:left;color:var(--text-muted);font-weight:500;border-bottom:1px solid var(--border)">#</th>
              <th style="padding:6px 10px;text-align:left;color:var(--text-muted);font-weight:500;border-bottom:1px solid var(--border)">Title</th>
              <th style="padding:6px 10px;text-align:left;color:var(--text-muted);font-weight:500;border-bottom:1px solid var(--border)">Size</th>
            </tr></thead>
            <tbody id="importPreviewBody"></tbody>
          </table>
        </div>
      </div>
      <div id="importError" style="display:none;font-size:12px;color:var(--red);padding:8px 10px;background:var(--red-light);border-radius:var(--radius-sm);border:1px solid #FECACA"></div>
    </div>
    <div class="modal-footer">
      <button class="btn" id="importCancel">Cancel</button>
      <button class="btn btn-primary" id="importSave" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Import
      </button>
    </div>
  </div>
</div>

<!-- New Project Modal -->
<div class="modal-mask" id="newProjectModal">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">New Project</span>
      <button class="btn btn-icon btn-sm" id="newProjectClose">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label>Project ID</label>
        <input id="newProjectId" placeholder="e.g. my-project" autocomplete="off" spellcheck="false">
      </div>
      <div style="font-size:12px;color:var(--text-faint)">A placeholder memory entry will be created to register the project.</div>
    </div>
    <div class="modal-footer">
      <button class="btn" id="newProjectCancel">Cancel</button>
      <button class="btn btn-primary" id="newProjectSave">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Create
      </button>
    </div>
  </div>
</div>

<div class="toast-host" id="toastHost"></div>

<script>
  const THEME_KEY = 'kb.theme';
  const $ = id => document.getElementById(id);

  const state = { projects: [], projectId: null, items: [], total: 0, offset: 0, selectedId: null, selectedDoc: null };

  /* ── Theme ── */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(THEME_KEY, t);
    $('themeIconLight').style.display = t === 'dark' ? 'none' : '';
    $('themeIconDark').style.display  = t === 'dark' ? '' : 'none';
  }
  applyTheme(localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
  $('themeBtn').onclick = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

  /* ── Toast ── */
  function toast(type, msg) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    $('toastHost').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(4px)'; }, 2400);
    setTimeout(() => el.remove(), 2800);
  }

  /* ── API ── */
  async function api(url, init) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(t || 'HTTP ' + res.status); }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  /* ── Escape ── */
  function esc(v) { return String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
  function md(v) { return DOMPurify.sanitize(marked.parse(v || '')); }

  /* ── URL state ── */
  function getQP(k) { return new URL(location.href).searchParams.get(k); }
  function setQP(k, v) { const u = new URL(location.href); if (v) u.searchParams.set(k, v); else u.searchParams.delete(k); history.replaceState({}, '', u); }

  /* ── Tabs ── */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const name = btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
      $('panel' + name).classList.add('active');
      if (btn.dataset.tab === 'memory') loadMemory(true);
      if (btn.dataset.tab === 'sources') loadSources(true);
    };
  });

  /* ── Projects ── */
  async function loadProjects(preferred) {
    const rows = await api('/api/projects');
    state.projects = Array.isArray(rows) ? rows : [];
    const sel = $('projectSelect');
    sel.innerHTML = state.projects.map(p =>
      \`<option value="\${esc(p.project_id)}">\${esc(p.project_id)} (\${p.total_entries})\`
    ).join('');
    if (preferred && state.projects.some(p => p.project_id === preferred)) {
      state.projectId = preferred; sel.value = preferred;
    } else if (state.projects.length) {
      state.projectId = state.projects[0].project_id; sel.value = state.projectId;
    }
    setQP('project_id', state.projectId);
  }
  $('projectSelect').onchange = async e => {
    state.projectId = e.target.value;
    state.selectedId = null; state.selectedDoc = null;
    setQP('project_id', state.projectId);
    showPlaceholder();
    await loadList(true);
    await loadMemory(true);
    // reset sources/links/lint badges
    srcState.items = []; srcState.offset = 0; srcState.selectedId = null;
    $('sourcesBadge').textContent = '0';
    $('sourcesMeta').textContent = '0';
    $('linksMeta').textContent = '';
    $('lintMeta').textContent = 'Run a health check on your wiki';
    $('lintResults').innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><p>Click "Run Lint" to check for orphans, broken links, and stale sources</p></div>';
  };

  /* ── Doc list ── */
  async function loadList(reset) {
    if (reset) { state.items = []; state.offset = 0; }
    const q = $('searchInput').value.trim();
    const pid = state.projectId ? '&project_id=' + encodeURIComponent(state.projectId) : '';
    const qs = '?limit=' + PAGE + '&offset=' + state.offset + pid + (q ? '&q=' + encodeURIComponent(q) : '');
    const data = await api('/api/kb' + qs);
    const newItems = Array.isArray(data.items) ? data.items : [];
    state.items = state.items.concat(newItems);
    state.offset = state.items.length;
    state.total = data.total ?? state.items.length;
    renderList();
  }

  function renderList() {
    $('kbCount').textContent = state.total;
    const list = $('docList');
    if (!state.items.length) {
      list.innerHTML = \`<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>No documents found</p></div>\`;
      $('kbLoadMoreWrap').style.display = 'none';
      return;
    }
    list.innerHTML = state.items.map(d => {
      const active = String(state.selectedId) === String(d.id) ? ' active' : '';
      const src = d.source ? \`<span class="tag">\${esc(d.source.replace(/^https?:\\/\\//, '').slice(0, 30))}</span>\` : '';
      return \`<div class="doc-item\${active}" data-id="\${d.id}" onclick="selectDoc(\${d.id})">
        <div class="doc-item-title">\${esc(d.title || '(untitled)')}</div>
        <div class="doc-item-meta"><span class="tag">#\${d.id}</span>\${src}</div>
      </div>\`;
    }).join('');
    $('kbLoadMoreWrap').style.display = state.items.length < state.total ? '' : 'none';
  }

  $('kbLoadMoreBtn').onclick = () => loadList(false);


  /* ── Select doc ── */
  async function selectDoc(id) {
    state.selectedId = id;
    setQP('doc_id', id);
    renderList();
    $('docPlaceholder').style.display = 'none';
    $('docContent').style.display = 'none';
    $('editForm').style.display = 'none';
    try {
      const doc = await api('/api/kb/' + id);
      state.selectedDoc = doc;
      $('docTitle').textContent = doc.title || '(untitled)';
      $('docIdBadge').textContent = '#' + doc.id;
      if (doc.source) {
        $('docSourceWrap').style.display = 'flex';
        $('docSource').innerHTML = \`<a href="\${esc(doc.source)}" target="_blank" rel="noopener">\${esc(doc.source)}</a>\`;
      } else {
        $('docSourceWrap').style.display = 'none';
      }
      $('docBody').innerHTML = md(doc.content || '');
      $('docContent').style.display = 'block';
    } catch (e) {
      toast('err', 'Failed to load document: ' + e.message);
      showPlaceholder();
    }
  }

  /* ── Placeholder ── */
  function showPlaceholder() {
    state.selectedId = null; state.selectedDoc = null;
    setQP('doc_id', null);
    $('docPlaceholder').style.display = 'flex';
    $('docContent').style.display = 'none';
    $('editForm').style.display = 'none';
    renderList();
  }

  /* ── Delete ── */
  $('deleteBtn').onclick = async () => {
    if (!state.selectedDoc) return;
    if (!confirm('Delete "' + (state.selectedDoc.title || 'this document') + '"?')) return;
    try {
      await api('/api/kb/' + state.selectedDoc.id, { method: 'DELETE' });
      toast('ok', 'Document deleted');
      showPlaceholder();
      await loadList(true);
    } catch (e) { toast('err', 'Delete failed: ' + e.message); }
  };

  /* ── Edit ── */
  let editDirty = false;
  let editViewMode = 'both'; // 'both' | 'edit' | 'preview'

  function setEditView(mode) {
    editViewMode = mode;
    const write = $('editorWritePane');
    const preview = $('editorPreviewPane');
    document.querySelectorAll('.toolbar-view-btn').forEach(b => b.classList.remove('active'));
    if (mode === 'both') {
      write.style.display = ''; preview.style.display = '';
      $('viewBoth').classList.add('active');
    } else if (mode === 'edit') {
      write.style.display = ''; preview.style.display = 'none';
      $('viewEdit').classList.add('active');
    } else {
      write.style.display = 'none'; preview.style.display = '';
      $('viewPreview').classList.add('active');
    }
  }

  function updateEditPreview() {
    $('editPreview').innerHTML = md($('editContent').value || '');
    const len = $('editContent').value.length;
    $('editCharCount').textContent = len.toLocaleString() + ' char' + (len !== 1 ? 's' : '');
  }

  function markDirty() {
    if (!editDirty) { editDirty = true; $('editDirty').style.display = ''; }
  }

  $('editContent').oninput = () => { updateEditPreview(); markDirty(); };
  $('editTitle').oninput = markDirty;
  $('editSource').oninput = markDirty;

  $('viewBoth').onclick = () => setEditView('both');
  $('viewEdit').onclick = () => setEditView('edit');
  $('viewPreview').onclick = () => setEditView('preview');

  // Toolbar actions
  function wrapSelection(before, after, placeholder) {
    const ta = $('editContent');
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.slice(start, end) || placeholder || '';
    const replacement = before + sel + (after ?? before);
    ta.value = ta.value.slice(0, start) + replacement + ta.value.slice(end);
    const cursor = start + before.length + sel.length;
    ta.setSelectionRange(cursor, cursor);
    ta.focus();
    updateEditPreview(); markDirty();
  }

  function prefixLines(prefix) {
    const ta = $('editContent');
    const start = ta.selectionStart, end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const lineStart = before.lastIndexOf('\\n') + 1;
    const selected = ta.value.slice(lineStart, end);
    const replaced = selected.split('\\n').map(l => prefix + l).join('\\n');
    ta.value = ta.value.slice(0, lineStart) + replaced + ta.value.slice(end);
    ta.setSelectionRange(lineStart, lineStart + replaced.length);
    ta.focus();
    updateEditPreview(); markDirty();
  }

  document.querySelectorAll('.toolbar-btn[data-action]').forEach(btn => {
    btn.onclick = () => {
      const a = btn.dataset.action;
      if (a === 'bold')      wrapSelection('**', '**', 'bold text');
      if (a === 'italic')    wrapSelection('_', '_', 'italic text');
      if (a === 'strike')    wrapSelection('~~', '~~', 'strikethrough');
      if (a === 'h1')        prefixLines('# ');
      if (a === 'h2')        prefixLines('## ');
      if (a === 'h3')        prefixLines('### ');
      if (a === 'ul')        prefixLines('- ');
      if (a === 'ol')        prefixLines('1. ');
      if (a === 'quote')     prefixLines('> ');
      if (a === 'code')      wrapSelection('\`', '\`', 'code');
      if (a === 'hr')        { const ta = $('editContent'); const p = ta.selectionStart; ta.value = ta.value.slice(0,p) + '\\n---\\n' + ta.value.slice(p); ta.setSelectionRange(p+5,p+5); ta.focus(); updateEditPreview(); markDirty(); }
      if (a === 'codeblock') wrapSelection('\\n\`\`\`\\n', '\\n\`\`\`\\n', 'code here');
      if (a === 'link') {
        const ta = $('editContent');
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'link text';
        wrapSelection('[' + sel + '](', ')', '');
      }
    };
  });

  // Tab key → indent in textarea
  $('editContent').onkeydown = e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = $('editContent');
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
      ta.setSelectionRange(s + 2, s + 2);
      updateEditPreview(); markDirty();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); $('saveEditBtn').click(); }
    if (e.key === 'Escape') { $('cancelEditBtn').click(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); wrapSelection('**', '**', 'bold text'); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); wrapSelection('_', '_', 'italic text'); }
  };

  $('editBtn').onclick = () => {
    if (!state.selectedDoc) return;
    editDirty = false;
    $('editDirty').style.display = 'none';
    $('editTitle').value = state.selectedDoc.title || '';
    $('editSource').value = state.selectedDoc.source || '';
    $('editContent').value = state.selectedDoc.content || '';
    updateEditPreview();
    setEditView(editViewMode);
    $('docContent').style.display = 'none';
    $('editForm').style.display = 'flex';
    setTimeout(() => $('editContent').focus(), 50);
  };

  $('cancelEditBtn').onclick = () => {
    if (editDirty && !confirm('Discard unsaved changes?')) return;
    $('editForm').style.display = 'none';
    $('docContent').style.display = 'block';
  };

  $('saveEditBtn').onclick = async () => {
    if (!state.selectedDoc) return;
    const title = $('editTitle').value.trim();
    const source = $('editSource').value.trim();
    const content = $('editContent').value;
    if (!title) { toast('err', 'Title is required'); $('editTitle').focus(); return; }
    $('saveEditBtn').disabled = true;
    try {
      await api('/api/kb/' + state.selectedDoc.id, {
        method: 'PUT',
        body: JSON.stringify({ title, source: source || undefined, content })
      });
      editDirty = false;
      $('editDirty').style.display = 'none';
      toast('ok', 'Saved');
      await loadList(true);
      await selectDoc(state.selectedDoc.id);
    } catch (e) { toast('err', 'Save failed: ' + e.message); }
    finally { $('saveEditBtn').disabled = false; }
  };

  /* ── Memory (split-panel + pagination) ── */
  const memState = { items: [], total: 0, offset: 0, selectedId: null };
  const PAGE = 30;

  async function loadMemory(reset) {
    if (!state.projectId) return;
    if (reset) { memState.items = []; memState.offset = 0; memState.selectedId = null; showMemPlaceholder(); }
    try {
      const data = await api('/api/memory?project_id=' + encodeURIComponent(state.projectId) + '&limit=' + PAGE + '&offset=' + memState.offset);
      const items = Array.isArray(data.items) ? data.items : [];
      memState.total = data.total ?? items.length;
      memState.items = memState.items.concat(items);
      memState.offset = memState.items.length;
      $('memoryBadge').textContent = memState.total;
      $('memoryMeta').textContent = memState.total;
      renderMemList();
    } catch (e) { $('memoryMeta').textContent = 'Error'; }
  }

  function renderMemList() {
    const list = $('memoryList');
    if (!memState.items.length) {
      list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg><p>No memory entries</p></div>';
      $('memLoadMoreWrap').style.display = 'none';
      return;
    }
    list.innerHTML = memState.items.map(m => {
      const preview = (m.content || '').replace(/[#*\`>\[\]]/g, '').slice(0, 80);
      const date = m.created_at ? new Date(m.created_at).toLocaleDateString() : '';
      const active = String(memState.selectedId) === String(m.id) ? ' active' : '';
      return \`<div class="mem-item\${active}" data-id="\${esc(m.id)}" onclick="selectMem('\${esc(m.id)}')">
        <div class="mem-item-scope">\${esc(m.scope || 'default')}</div>
        <div class="mem-item-preview">\${esc(preview)}</div>
        <div class="mem-item-date">\${esc(date)}</div>
      </div>\`;
    }).join('');
    const hasMore = memState.items.length < memState.total;
    $('memLoadMoreWrap').style.display = hasMore ? '' : 'none';
  }

  function showMemPlaceholder() {
    $('memPlaceholder').style.display = 'flex';
    $('memContent').style.display = 'none';
  }

  function selectMem(id) {
    memState.selectedId = id;
    const m = memState.items.find(x => String(x.id) === String(id));
    if (!m) return;
    renderMemList();
    $('memPlaceholder').style.display = 'none';
    $('memDetailScope').textContent = m.scope || 'default';
    $('memDetailDate').textContent = m.created_at ? new Date(m.created_at).toLocaleString() : '';
    const tags = (m.tags || []).map(t => \`<span class="tag">\${esc(t)}</span>\`).join('');
    $('memDetailTags').innerHTML = tags;
    $('memDetailBody').innerHTML = md(m.content || '');
    $('memContent').style.display = 'block';
  }

  $('memLoadMoreBtn').onclick = () => loadMemory(false);

  /* ── Sources (split-panel + pagination) ── */
  const srcState = { items: [], total: 0, offset: 0, selectedId: null };

  async function loadSources(reset) {
    if (!state.projectId) return;
    if (reset) { srcState.items = []; srcState.offset = 0; srcState.selectedId = null; showSrcPlaceholder(); }
    const q = $('sourcesSearch').value.trim();
    const qs = '?project_id=' + encodeURIComponent(state.projectId) + '&limit=' + PAGE + '&offset=' + srcState.offset + (q ? '&q=' + encodeURIComponent(q) : '');
    try {
      const data = await api('/api/sources' + qs);
      const items = Array.isArray(data.items) ? data.items : [];
      srcState.total = data.total ?? items.length;
      srcState.items = srcState.items.concat(items);
      srcState.offset = srcState.items.length;
      $('sourcesBadge').textContent = srcState.total;
      $('sourcesMeta').textContent = srcState.total;
      renderSrcList();
    } catch (e) { $('sourcesMeta').textContent = 'Error'; }
  }

  function renderSrcList() {
    const list = $('sourcesList');
    if (!srcState.items.length) {
      list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg><p>No sources ingested yet</p></div>';
      $('srcLoadMoreWrap').style.display = 'none';
      return;
    }
    list.innerHTML = srcState.items.map(s => {
      const ext = (s.file_type || 'other').toLowerCase();
      const iconClass = ['md','pdf','csv','txt','json'].includes(ext) ? ext : 'other';
      const active = String(srcState.selectedId) === String(s.id) ? ' active' : '';
      const size = s.size_bytes ? (s.size_bytes > 1024 ? (s.size_bytes/1024).toFixed(1)+'KB' : s.size_bytes+'B') : '';
      return \`<div class="src-item\${active}" data-id="\${esc(s.id)}" onclick="selectSrc('\${esc(s.id)}')">
        <div class="source-icon \${iconClass}">\${esc(ext.toUpperCase())}</div>
        <div class="src-item-info">
          <div class="src-item-name">\${esc(s.filename || s.slug)}</div>
          <div class="src-item-meta">\${esc(s.id.slice(0,8))}\${size ? ' · ' + esc(size) : ''}</div>
        </div>
      </div>\`;
    }).join('');
    const hasMore = srcState.items.length < srcState.total;
    $('srcLoadMoreWrap').style.display = hasMore ? '' : 'none';
  }

  function showSrcPlaceholder() {
    $('srcPlaceholder').style.display = 'flex';
    $('srcContent').style.display = 'none';
  }

  async function selectSrc(id) {
    srcState.selectedId = id;
    renderSrcList();
    $('srcPlaceholder').style.display = 'none';
    $('srcContent').style.display = 'flex';
    $('srcDetailName').textContent = '…';
    $('srcDetailBody').textContent = 'Loading…';
    try {
      const src = await api('/api/sources/' + encodeURIComponent(id));
      $('srcDetailName').textContent = src.filename || src.slug;
      $('srcDetailMeta').textContent = [src.file_type, src.size_bytes ? (src.size_bytes/1024).toFixed(1)+'KB' : '', src.ingested_at ? new Date(src.ingested_at).toLocaleString() : ''].filter(Boolean).join(' · ');
      $('srcDetailBody').textContent = src.content || '';
    } catch (e) { toast('err', 'Failed to load source: ' + e.message); }
  }

  $('srcLoadMoreBtn').onclick = () => loadSources(false);

  let sourcesTimer;
  $('sourcesSearch').oninput = () => { clearTimeout(sourcesTimer); sourcesTimer = setTimeout(() => loadSources(true), 280); };

  /* ── Links ── */
  $('linksLookupBtn').onclick = loadLinks;
  $('linksEntryInput').onkeydown = e => { if (e.key === 'Enter') loadLinks(); };

  async function loadLinks() {
    const entryId = $('linksEntryInput').value.trim();
    if (!entryId || !state.projectId) { toast('err', 'Enter an entry ID'); return; }
    try {
      const data = await api('/api/links?entry_id=' + encodeURIComponent(entryId) + '&project_id=' + encodeURIComponent(state.projectId));
      $('linksMeta').textContent = (data.outbound.length + data.inbound.length) + ' links';
      const list = $('linksList');
      if (!data.outbound.length && !data.inbound.length) {
        list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><p>No links found for this entry</p></div>';
        return;
      }
      const renderRows = (rows, dir) => rows.map(l => {
        const otherId = dir === 'out' ? l.target_id : l.source_id;
        const otherType = dir === 'out' ? l.target_type : l.source_type;
        const arrow = dir === 'out' ? '→' : '←';
        return \`<div class="link-row">
          <span style="color:var(--text-faint);font-size:16px">\${arrow}</span>
          <span class="link-type-badge">\${esc(otherType)}</span>
          <span class="link-id">\${esc(otherId)}</span>
          \${l.relation ? \`<span class="link-relation">\${esc(l.relation)}</span>\` : ''}
          <span style="font-size:11px;color:var(--text-faint);margin-left:auto;font-family:var(--font-mono)">\${l.created_at ? new Date(l.created_at).toLocaleDateString() : ''}</span>
        </div>\`;
      }).join('');
      list.innerHTML = (data.outbound.length ? \`<div class="link-group">
        <div class="link-group-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>Outbound (\${data.outbound.length})</div>
        \${renderRows(data.outbound, 'out')}
      </div>\` : '') +
      (data.inbound.length ? \`<div class="link-group">
        <div class="link-group-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>Inbound (\${data.inbound.length})</div>
        \${renderRows(data.inbound, 'in')}
      </div>\` : '');
    } catch (e) { toast('err', 'Links lookup failed: ' + e.message); }
  }

  $('memDeleteBtn').onclick = async () => {
    if (!memState.selectedId) return;
    if (!confirm('Delete this memory entry?')) return;
    try {
      await api('/api/memory/' + encodeURIComponent(memState.selectedId), { method: 'DELETE' });
      toast('ok', 'Memory entry deleted');
      memState.items = memState.items.filter(m => String(m.id) !== String(memState.selectedId));
      memState.total = Math.max(0, memState.total - 1);
      memState.selectedId = null;
      $('memoryBadge').textContent = memState.total;
      $('memoryMeta').textContent = memState.total;
      showMemPlaceholder();
      renderMemList();
    } catch (e) { toast('err', 'Delete failed: ' + e.message); }
  };

  /* ── New Project ── */
  $('newProjectBtn').onclick = () => { $('newProjectId').value = ''; $('newProjectModal').classList.add('open'); setTimeout(() => $('newProjectId').focus(), 50); };
  $('newProjectClose').onclick = () => $('newProjectModal').classList.remove('open');
  $('newProjectCancel').onclick = () => $('newProjectModal').classList.remove('open');
  $('newProjectModal').onclick = e => { if (e.target === $('newProjectModal')) $('newProjectModal').classList.remove('open'); };
  $('newProjectId').onkeydown = e => { if (e.key === 'Enter') $('newProjectSave').click(); };
  $('newProjectSave').onclick = async () => {
    const pid = $('newProjectId').value.trim();
    if (!pid) { toast('err', 'Project ID is required'); return; }
    try {
      await api('/api/projects', { method: 'POST', body: JSON.stringify({ project_id: pid }) });
      toast('ok', 'Project created');
      $('newProjectModal').classList.remove('open');
      await loadProjects(pid);
      showPlaceholder();
      await loadList(true);
      await loadMemory(true);
    } catch (e) { toast('err', 'Failed: ' + e.message); }
  };

  $('deleteProjectBtn').onclick = async () => {
    if (!state.projectId) return;
    if (!confirm('Delete project "' + state.projectId + '" and ALL its data (memory, KB, sources)? This cannot be undone.')) return;
    try {
      await api('/api/projects/' + encodeURIComponent(state.projectId), { method: 'DELETE' });
      toast('ok', 'Project deleted');
      state.projectId = null;
      await loadProjects(null);
      showPlaceholder();
      await loadList(true);
      await loadMemory(true);
      srcState.items = []; srcState.offset = 0; srcState.selectedId = null;
      $('sourcesBadge').textContent = '0';
      $('sourcesMeta').textContent = '0';
    } catch (e) { toast('err', 'Delete project failed: ' + e.message); }
  };

  /* ── Lint ── */
  $('lintRunBtn').onclick = runLint;

  async function runLint() {
    if (!state.projectId) { toast('err', 'Select a project first'); return; }
    $('lintRunBtn').disabled = true;
    $('lintMeta').textContent = 'Running…';
    try {
      const data = await api('/api/lint?project_id=' + encodeURIComponent(state.projectId));
      $('lintMeta').textContent = data.summary || '';
      const results = $('lintResults');
      const badgeClass = (n) => n > 0 ? 'warn' : 'ok';
      const renderLintRows = (items, fields) => items.length
        ? items.map(item => \`<div class="lint-row">
            <span class="lint-row-id">\${esc(item.id ? item.id.slice(0,8) : item.link_id?.slice(0,8) || '—')}</span>
            <span class="lint-row-text">\${fields.map(f => item[f] ? esc(String(item[f]).slice(0,120)) : '').filter(Boolean).join(' · ')}</span>
          </div>\`).join('')
        : '<div class="lint-row"><span class="lint-row-text" style="color:var(--green)">✓ None found</span></div>';

      results.innerHTML = \`
        <div class="lint-section">
          <div class="lint-section-header">
            <span class="lint-section-title">Orphan Memory Entries</span>
            <span class="lint-badge \${badgeClass(data.orphan_memory.length)}">\${data.orphan_memory.length}</span>
          </div>
          \${renderLintRows(data.orphan_memory, ['preview', 'tags', 'created_at'])}
        </div>
        <div class="lint-section">
          <div class="lint-section-header">
            <span class="lint-section-title">Broken Links</span>
            <span class="lint-badge \${data.broken_links.length > 0 ? 'err' : 'ok'}">\${data.broken_links.length}</span>
          </div>
          \${data.broken_links.length
            ? data.broken_links.map(l => \`<div class="lint-row">
                <span class="lint-row-id">\${esc(l.link_id?.slice(0,8) || '—')}</span>
                <span class="lint-row-text">
                  <span class="link-type-badge">\${esc(l.source_type)}</span> \${esc(l.source_id?.slice(0,16))} \${l.source_exists ? '✓' : '✗'}
                  → <span class="link-type-badge">\${esc(l.target_type)}</span> \${esc(l.target_id?.slice(0,16))} \${l.target_exists ? '✓' : '✗'}
                </span>
              </div>\`).join('')
            : '<div class="lint-row"><span class="lint-row-text" style="color:var(--green)">✓ None found</span></div>'}
        </div>
        <div class="lint-section">
          <div class="lint-section-header">
            <span class="lint-section-title">Stale Sources (90+ days, no links)</span>
            <span class="lint-badge \${badgeClass(data.stale_sources.length)}">\${data.stale_sources.length}</span>
          </div>
          \${renderLintRows(data.stale_sources, ['filename', 'ingested_at'])}
        </div>
      \`;
    } catch (e) {
      $('lintMeta').textContent = 'Lint failed';
      toast('err', 'Lint error: ' + e.message);
    } finally {
      $('lintRunBtn').disabled = false;
    }
  }

  /* ── Export ── */
  function triggerDownload(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  $('kbExportBtn').onclick = () => {
    if (!state.projectId) { toast('err', 'Select a project first'); return; }
    triggerDownload('/api/export/kb?project_id=' + encodeURIComponent(state.projectId));
  };

  $('memExportBtn').onclick = () => {
    if (!state.projectId) { toast('err', 'Select a project first'); return; }
    triggerDownload('/api/export/memory?project_id=' + encodeURIComponent(state.projectId));
  };

  /* ── Import KB ── */
  let importDocs = [];
  function resetImport() {
    importDocs = [];
    $('importFile').value = '';
    $('importPreview').style.display = 'none';
    $('importError').style.display = 'none';
    $('importSave').disabled = true;
  }
  $('importBtn').onclick = () => { if (!state.projectId) { toast('err', 'Select a project first'); return; } resetImport(); $('importModal').classList.add('open'); };
  $('importClose').onclick = () => $('importModal').classList.remove('open');
  $('importCancel').onclick = () => $('importModal').classList.remove('open');
  $('importModal').onclick = e => { if (e.target === $('importModal')) $('importModal').classList.remove('open'); };

  $('importFile').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    $('importError').style.display = 'none';
    $('importPreview').style.display = 'none';
    $('importSave').disabled = true;
    importDocs = [];
    try {
      const text = await file.text();
      if (file.name.endsWith('.md')) {
        const title = file.name.replace(/\\.md$/i, '');
        importDocs = [{ title, content: text }];
      } else {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('Expected a JSON array');
        importDocs = parsed.filter(d => d && typeof d.title === 'string' && d.title.trim());
        if (!importDocs.length) throw new Error('No valid documents found (each needs a "title" field)');
      }
      $('importPreviewLabel').textContent = importDocs.length + ' document' + (importDocs.length !== 1 ? 's' : '') + ' ready to import';
      $('importPreviewBody').innerHTML = importDocs.map((d, i) => \`<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 10px;color:var(--text-faint);font-family:var(--font-mono)">\${i + 1}</td>
        <td style="padding:5px 10px;color:var(--text)">\${esc(d.title.slice(0, 60))}</td>
        <td style="padding:5px 10px;color:var(--text-faint);font-family:var(--font-mono)">\${((d.content || '').length / 1024).toFixed(1)}KB</td>
      </tr>\`).join('');
      $('importPreview').style.display = '';
      $('importSave').disabled = false;
    } catch (err) {
      $('importError').textContent = err.message;
      $('importError').style.display = '';
    }
  };

  $('importSave').onclick = async () => {
    if (!importDocs.length || !state.projectId) return;
    $('importSave').disabled = true;
    $('importSave').textContent = 'Importing…';
    try {
      await api('/api/kb/import', {
        method: 'POST',
        body: JSON.stringify({ project_id: state.projectId, docs: importDocs })
      });
      toast('ok', 'Imported ' + importDocs.length + ' document' + (importDocs.length !== 1 ? 's' : ''));
      $('importModal').classList.remove('open');
      await loadList(true);
    } catch (err) {
      toast('err', 'Import failed: ' + err.message);
    } finally {
      $('importSave').disabled = false;
      $('importSave').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Import';
    }
  };

  /* ── Add modal ── */
  $('addBtn').onclick = () => $('addModal').classList.add('open');
  $('addModalClose').onclick = () => $('addModal').classList.remove('open');
  $('addModalCancel').onclick = () => $('addModal').classList.remove('open');
  $('addModal').onclick = e => { if (e.target === $('addModal')) $('addModal').classList.remove('open'); };
  $('addModalSave').onclick = async () => {
    const title = $('addTitle').value.trim();
    const source = $('addSource').value.trim();
    const content = $('addContent').value;
    if (!title) { toast('err', 'Title is required'); return; }
    try {
      await api('/api/kb', { method: 'POST', body: JSON.stringify({ title, source: source || undefined, content, project_id: state.projectId || undefined }) });
      toast('ok', 'Document added');
      $('addModal').classList.remove('open');
      $('addTitle').value = ''; $('addSource').value = ''; $('addContent').value = '';
      await loadList(true);
    } catch (e) { toast('err', 'Add failed: ' + e.message); }
  };

  /* ── Search ── */
  let searchTimer;
  $('searchInput').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadList(true), 280); };

  /* ── Boot ── */
  async function boot() {
    const preferred = getQP('project_id');
    await loadProjects(preferred);
    await loadList(true);
    await loadMemory(true);
    const docId = getQP('doc_id');
    if (docId) await selectDoc(Number(docId));
  }
  boot().catch(e => toast('err', 'Init error: ' + e.message));
<\/script>
</body>
</html>
`;
}

async function ensureServer({ memoryDb, kbDb, rootDir, port: preferredPort, host: preferredHost }) {
  if (serverState) return serverState;
  const bindHost = preferredHost || '127.0.0.1';

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const pathname = u.pathname;
    const method = req.method.toUpperCase();

    // CORS for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Vary", "Origin");
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    try {
      // ── GET /api/projects ──
      if (method === "GET" && pathname === "/api/projects") {
        const memRows = memoryDb.prepare(
          "SELECT project_id, COUNT(*) as mem_count FROM memory GROUP BY project_id"
        ).all();
        const kbRows = kbDb.prepare(
          "SELECT m.project_id, COUNT(*) as kb_count FROM kb_meta m JOIN kb_fts f ON f.rowid = m.rowid WHERE m.project_id IS NOT NULL AND f.source IS NOT '_index' GROUP BY m.project_id"
        ).all();
        const srcRows = kbDb.prepare(
          "SELECT project_id, COUNT(*) as src_count FROM sources WHERE project_id IS NOT NULL GROUP BY project_id"
        ).all();
        const map = new Map();
        for (const r of memRows) map.set(r.project_id, { project_id: r.project_id, total_entries: r.mem_count });
        for (const r of kbRows) {
          if (map.has(r.project_id)) map.get(r.project_id).total_entries += r.kb_count;
          else map.set(r.project_id, { project_id: r.project_id, total_entries: r.kb_count });
        }
        for (const r of srcRows) {
          if (map.has(r.project_id)) map.get(r.project_id).total_entries += r.src_count;
          else map.set(r.project_id, { project_id: r.project_id, total_entries: r.src_count });
        }
        const rows = Array.from(map.values()).sort((a, b) => b.total_entries - a.total_entries);
        return json(res, 200, rows);
      }

      // ── POST /api/projects ──
      if (method === "POST" && pathname === "/api/projects") {
        const body = await readJsonBody(req);
        const projectId = (body.project_id || "").trim();
        if (!projectId) return badRequest(res, "project_id required");
        const existing = memoryDb.prepare("SELECT 1 FROM memory WHERE project_id=? LIMIT 1").get(projectId);
        if (existing) return json(res, 200, { ok: true, existed: true });
        const { randomUUID } = await import("node:crypto");
        memoryDb.prepare(
          "INSERT INTO memory (id, project_id, scope, content, tags, created_at) VALUES (?,?,?,?,?,?)"
        ).run(randomUUID(), projectId, "system", "_project_init_", "[]", new Date().toISOString());
        return json(res, 201, { ok: true });
      }

      // ── GET /api/kb ──
      if (method === "GET" && pathname === "/api/kb") {
        const q = u.searchParams.get("q") || "";
        const limit = asLimit(Number(u.searchParams.get("limit")), 30);
        const offset = Math.max(0, Number(u.searchParams.get("offset")) || 0);
        const projectId = u.searchParams.get("project_id");
        let rows, total;
        if (q.trim()) {
          if (projectId) {
            rows = kbDb.prepare(
              "SELECT f.rowid as id, f.title, f.source FROM kb_fts f JOIN kb_meta m ON m.rowid=f.rowid WHERE kb_fts MATCH ? AND m.project_id=? AND f.source IS NOT '_index' ORDER BY rank LIMIT ? OFFSET ?"
            ).all(q.trim() + "*", projectId, limit, offset);
            total = kbDb.prepare(
              "SELECT COUNT(*) as n FROM kb_fts f JOIN kb_meta m ON m.rowid=f.rowid WHERE kb_fts MATCH ? AND m.project_id=? AND f.source IS NOT '_index'"
            ).get(q.trim() + "*", projectId)?.n ?? 0;
          } else {
            rows = kbDb.prepare(
              "SELECT rowid as id, title, source FROM kb_fts WHERE kb_fts MATCH ? AND source IS NOT '_index' ORDER BY rank LIMIT ? OFFSET ?"
            ).all(q.trim() + "*", limit, offset);
            total = kbDb.prepare("SELECT COUNT(*) as n FROM kb_fts WHERE kb_fts MATCH ? AND source IS NOT '_index'").get(q.trim() + "*")?.n ?? 0;
          }
        } else {
          if (projectId) {
            rows = kbDb.prepare(
              "SELECT f.rowid as id, f.title, f.source FROM kb_fts f JOIN kb_meta m ON m.rowid=f.rowid WHERE m.project_id=? AND f.source IS NOT '_index' LIMIT ? OFFSET ?"
            ).all(projectId, limit, offset);
            total = kbDb.prepare(
              "SELECT COUNT(*) as n FROM kb_fts f JOIN kb_meta m ON m.rowid=f.rowid WHERE m.project_id=? AND f.source IS NOT '_index'"
            ).get(projectId)?.n ?? 0;
          } else {
            rows = kbDb.prepare("SELECT rowid as id, title, source FROM kb_fts WHERE source IS NOT '_index' LIMIT ? OFFSET ?").all(limit, offset);
            total = kbDb.prepare("SELECT COUNT(*) as n FROM kb_fts WHERE source IS NOT '_index'").get()?.n ?? 0;
          }
        }
        return json(res, 200, { items: rows, total });
      }

      // ── GET /api/kb/:id ──
      const kbMatch = pathname.match(/^\/api\/kb\/(\d+)$/);
      if (kbMatch) {
        const id = Number(kbMatch[1]);
        if (method === "GET") {
          const row = kbDb.prepare("SELECT rowid as id, title, content, source FROM kb_fts WHERE rowid = ?").get(id);
          if (!row) return notFound(res);
          return json(res, 200, row);
        }
        if (method === "PUT") {
          const body = await readJsonBody(req);
          const { title, content, source } = body;
          if (!title || typeof title !== "string") return badRequest(res, "title required");
          kbDb.prepare("UPDATE kb_fts SET title=?, content=?, source=? WHERE rowid=?")
            .run(title, content ?? "", source ?? "", id);
          return json(res, 200, { ok: true });
        }
        if (method === "DELETE") {
          kbDb.prepare("DELETE FROM kb_fts WHERE rowid=?").run(id);
          return json(res, 200, { ok: true });
        }
      }

      // ── POST /api/kb/import ──
      if (method === "POST" && pathname === "/api/kb/import") {
        const body = await readJsonBody(req);
        const { project_id, docs } = body;
        if (!project_id) return badRequest(res, "project_id required");
        if (!Array.isArray(docs) || !docs.length) return badRequest(res, "docs array required");
        const insert = kbDb.prepare("INSERT INTO kb_fts(title, content, source) VALUES (?,?,?)");
        const meta = kbDb.prepare("INSERT OR IGNORE INTO kb_meta(rowid, project_id) VALUES (?,?)");
        const importAll = kbDb.transaction((rows) => {
          for (const d of rows) {
            if (!d.title || typeof d.title !== "string") continue;
            const info = insert.run(d.title, d.content ?? "", d.source ?? "");
            meta.run(info.lastInsertRowid, project_id);
          }
        });
        importAll(docs);
        return json(res, 201, { ok: true, count: docs.length });
      }

      // ── POST /api/kb ──
      if (method === "POST" && pathname === "/api/kb") {
        const body = await readJsonBody(req);
        const { title, content, source, project_id } = body;
        if (!title || typeof title !== "string") return badRequest(res, "title required");
        const info = kbDb.prepare("INSERT INTO kb_fts(title, content, source) VALUES (?,?,?)")
          .run(title, content ?? "", source ?? "");
        if (project_id) {
          kbDb.prepare("INSERT OR IGNORE INTO kb_meta(rowid, project_id) VALUES (?,?)").run(info.lastInsertRowid, project_id);
        }
        return json(res, 201, { ok: true });
      }

      // ── GET /api/memory ──
      if (method === "GET" && pathname === "/api/memory") {
        const projectId = u.searchParams.get("project_id");
        const limit = asLimit(Number(u.searchParams.get("limit")), 30);
        const offset = Math.max(0, Number(u.searchParams.get("offset")) || 0);
        try {
          let rows, total;
          if (projectId) {
            rows = memoryDb.prepare(
              "SELECT id, scope, content, tags, created_at FROM memory WHERE project_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?"
            ).all(projectId, limit, offset);
            total = memoryDb.prepare("SELECT COUNT(*) as n FROM memory WHERE project_id=?").get(projectId)?.n ?? 0;
          } else {
            rows = memoryDb.prepare(
              "SELECT id, scope, content, tags, created_at FROM memory ORDER BY created_at DESC LIMIT ? OFFSET ?"
            ).all(limit, offset);
            total = memoryDb.prepare("SELECT COUNT(*) as n FROM memory").get()?.n ?? 0;
          }
          const items = rows.map(r => ({
            ...r,
            tags: r.tags ? JSON.parse(r.tags) : []
          }));
          return json(res, 200, { items, total });
        } catch (e) {
          logger.error({ err: e }, "memory api error");
          return json(res, 500, { error: e.message });
        }
      }

      // ── DELETE /api/memory/:id ──
      const memMatch = pathname.match(/^\/api\/memory\/([^/]+)$/);
      if (memMatch && method === "DELETE") {
        const id = memMatch[1];
        memoryDb.prepare("DELETE FROM memory WHERE id=?").run(id);
        return json(res, 200, { ok: true });
      }

      // ── DELETE /api/projects/:id ──
      const projMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projMatch && method === "DELETE") {
        const projectId = decodeURIComponent(projMatch[1]);
        memoryDb.prepare("DELETE FROM memory WHERE project_id=?").run(projectId);
        memoryDb.prepare("DELETE FROM wiki_links WHERE project_id=?").run(projectId);
        const srcIds = kbDb.prepare("SELECT id FROM sources WHERE project_id=?").all(projectId).map(r => r.id);
        if (srcIds.length) {
          kbDb.prepare(`DELETE FROM sources_fts WHERE rowid IN (SELECT rowid FROM sources WHERE project_id=?)`).run(projectId);
          kbDb.prepare("DELETE FROM sources WHERE project_id=?").run(projectId);
        }
        const kbRowids = kbDb.prepare("SELECT f.rowid FROM kb_fts f JOIN kb_meta m ON m.rowid=f.rowid WHERE m.project_id=?").all(projectId).map(r => r.rowid);
        for (const rowid of kbRowids) {
          kbDb.prepare("DELETE FROM kb_fts WHERE rowid=?").run(rowid);
          kbDb.prepare("DELETE FROM kb_meta WHERE rowid=?").run(rowid);
        }
        return json(res, 200, { ok: true });
      }

      // ── GET /api/sources ──
      if (method === "GET" && pathname === "/api/sources") {
        const projectId = u.searchParams.get("project_id");
        const limit = asLimit(Number(u.searchParams.get("limit")), 100);
        const offset = Math.max(0, Number(u.searchParams.get("offset")) || 0);
        const q = u.searchParams.get("q") || "";
        if (!projectId) return badRequest(res, "project_id required");
        let rows, total;
        if (q.trim()) {
          const escaped = q.trim().replaceAll('"', '""');
          rows = kbDb.prepare(`
            SELECT s.id, s.slug, s.filename, s.file_type, s.ingested_at, s.size_bytes,
                   snippet(sources_fts, 1, '[', ']', '...', 20) as excerpt
            FROM sources_fts f JOIN sources s ON s.rowid = f.rowid
            WHERE sources_fts MATCH ? AND s.project_id = ?
            ORDER BY bm25(sources_fts) LIMIT ? OFFSET ?
          `).all(`"${escaped}"`, projectId, limit, offset);
          total = rows.length;
        } else {
          rows = kbDb.prepare(
            "SELECT id, slug, filename, file_type, ingested_at, size_bytes FROM sources WHERE project_id=? ORDER BY ingested_at DESC LIMIT ? OFFSET ?"
          ).all(projectId, limit, offset);
          total = kbDb.prepare("SELECT COUNT(*) as n FROM sources WHERE project_id=?").get(projectId)?.n ?? 0;
        }
        return json(res, 200, { items: rows, total });
      }

      // ── GET /api/sources/:id ──
      const srcMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
      if (srcMatch && method === "GET") {
        const row = kbDb.prepare("SELECT * FROM sources WHERE id=?").get(srcMatch[1]);
        if (!row) return notFound(res);
        return json(res, 200, row);
      }

      // ── GET /api/links ──
      if (method === "GET" && pathname === "/api/links") {
        const entryId = u.searchParams.get("entry_id");
        const projectId = u.searchParams.get("project_id");
        if (!entryId || !projectId) return badRequest(res, "entry_id and project_id required");
        const outbound = memoryDb.prepare(
          "SELECT id, target_id, target_type, relation, created_at FROM wiki_links WHERE source_id=? AND project_id=? ORDER BY created_at DESC"
        ).all(entryId, projectId);
        const inbound = memoryDb.prepare(
          "SELECT id, source_id, source_type, relation, created_at FROM wiki_links WHERE target_id=? AND project_id=? ORDER BY created_at DESC"
        ).all(entryId, projectId);
        return json(res, 200, { entry_id: entryId, outbound, inbound });
      }

      // ── GET /api/lint ──
      if (method === "GET" && pathname === "/api/lint") {
        const projectId = u.searchParams.get("project_id");
        if (!projectId) return badRequest(res, "project_id required");

        const orphanMemory = memoryDb.prepare(`
          SELECT id, substr(content,1,80) as preview, tags, created_at FROM memory
          WHERE project_id=?
            AND id NOT IN (SELECT source_id FROM wiki_links WHERE project_id=?)
            AND id NOT IN (SELECT target_id FROM wiki_links WHERE project_id=?)
        `).all(projectId, projectId, projectId);

        const allLinks = memoryDb.prepare(
          "SELECT id, source_id, source_type, target_id, target_type, relation FROM wiki_links WHERE project_id=?"
        ).all(projectId);
        const memIds = new Set(memoryDb.prepare("SELECT id FROM memory WHERE project_id=?").all(projectId).map(r => r.id));
        const srcIds = new Set(kbDb.prepare("SELECT id FROM sources WHERE project_id=?").all(projectId).map(r => r.id));
        const kbIds = new Set(kbDb.prepare("SELECT f.rowid FROM kb_fts f JOIN kb_meta m ON m.rowid=f.rowid WHERE m.project_id=?").all(projectId).map(r => String(r.rowid)));
        function exists(id, type) {
          if (type === "memory") return memIds.has(id);
          if (type === "source") return srcIds.has(id);
          if (type === "kb") return kbIds.has(String(id));
          return false;
        }
        const brokenLinks = allLinks.filter(l => !exists(l.source_id, l.source_type) || !exists(l.target_id, l.target_type));

        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const linkedSrcIds = new Set([
          ...memoryDb.prepare("SELECT source_id as id FROM wiki_links WHERE project_id=? AND source_type='source'").all(projectId).map(r => r.id),
          ...memoryDb.prepare("SELECT target_id as id FROM wiki_links WHERE project_id=? AND target_type='source'").all(projectId).map(r => r.id)
        ]);
        const staleSources = kbDb.prepare(
          "SELECT id, slug, filename, ingested_at FROM sources WHERE project_id=? AND ingested_at<?"
        ).all(projectId, ninetyDaysAgo).filter(s => !linkedSrcIds.has(s.id));

        return json(res, 200, {
          orphan_memory: orphanMemory,
          broken_links: brokenLinks,
          stale_sources: staleSources,
          summary: `${orphanMemory.length} orphans, ${brokenLinks.length} broken links, ${staleSources.length} stale sources`
        });
      }

      // ── GET /api/export/kb ──
      if (method === "GET" && pathname === "/api/export/kb") {
        const projectId = u.searchParams.get("project_id");
        if (!projectId) return badRequest(res, "project_id required");
        const rows = kbDb.prepare(
          "SELECT f.rowid as id, f.title, f.content, f.source FROM kb_fts f JOIN kb_meta m ON m.rowid=f.rowid WHERE m.project_id=? AND f.source IS NOT '_index' ORDER BY f.rowid ASC"
        ).all(projectId);
        const lines = [`# Knowledge Base — ${projectId}`, ``, `> Exported ${new Date().toISOString()} · ${rows.length} document${rows.length !== 1 ? 's' : ''}`, ``];
        for (const doc of rows) {
          lines.push(`---`, ``, `## ${doc.title}`, ``);
          if (doc.source) lines.push(`**Source:** ${doc.source}`, ``);
          lines.push(`**ID:** ${doc.id}`, ``);
          if (doc.content) lines.push(doc.content, ``);
        }
        const md = lines.join('\n');
        const filename = `kb-${projectId}-${new Date().toISOString().slice(0,10)}.md`;
        res.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store"
        });
        res.end(md);
        return;
      }

      // ── GET /api/export/memory ──
      if (method === "GET" && pathname === "/api/export/memory") {
        const projectId = u.searchParams.get("project_id");
        if (!projectId) return badRequest(res, "project_id required");
        const rows = memoryDb.prepare(
          "SELECT id, scope, content, tags, created_at FROM memory WHERE project_id=? ORDER BY created_at ASC"
        ).all(projectId);
        const lines = [`# Memory — ${projectId}`, ``, `> Exported ${new Date().toISOString()} · ${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'}`, ``];
        for (const m of rows) {
          const tags = m.tags ? JSON.parse(m.tags) : [];
          lines.push(`---`, ``, `### [${m.scope || 'default'}] ${m.id}`, ``);
          if (tags.length) lines.push(`**Tags:** ${tags.join(', ')}`, ``);
          if (m.created_at) lines.push(`**Created:** ${m.created_at}`, ``);
          if (m.content) lines.push(``, m.content, ``);
        }
        const md = lines.join('\n');
        const filename = `memory-${projectId}-${new Date().toISOString().slice(0,10)}.md`;
        res.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store"
        });
        res.end(md);
        return;
      }

      // ── GET / (dashboard HTML) ──
      if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        const html = generateDashboardHTML();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(html);
        return;
      }

      notFound(res);
    } catch (e) {
      logger.error({ err: e }, "dashboard request error");
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(preferredPort ?? 0, bindHost, () => resolve());
    server.once("error", reject);
  });

  server.unref(); // don't keep process alive
  const { port } = server.address();
  serverState = { server, port, host: bindHost };
  logger.info(`Dashboard server listening at http://${bindHost}:${port}`);
  return serverState;
}

export async function startDashboardServer({ memoryDb, kbDb, rootDir, port, host }) {
  return ensureServer({ memoryDb, kbDb, rootDir, port, host });
}

export function createDashboardTools({ memoryDb, kbDb, rootDir }) {
  return [
    {
      name: "dashboard.projects",
      description: "Generate an interactive dashboard (HTML written to ./temp) for browsing and managing the knowledge base and project memory.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project identifier to focus on" },
          project_root: { type: "string", description: "Project root directory (auto-detects project_id)" },
          limit: { type: "number", description: "Number of recent memory entries to show" },
          port: { type: "number", description: "Optional port for the local dashboard server" }
        }
      },
      async handler(args = {}) {
        expectOptionalString(args.project_id, "project_id");
        expectOptionalString(args.project_root, "project_root");
        expectOptionalNumber(args.limit, "limit");
        expectOptionalNumber(args.port, "port");

        const resolvedId = resolveProjectId({ project_id: args.project_id, project_root: args.project_root })
          ?? getLatestProjectId(memoryDb);

        const { port } = await ensureServer({ memoryDb, kbDb, rootDir, port: args.port });

        const tempDir = path.join(rootDir, "temp");
        fs.mkdirSync(tempDir, { recursive: true });
        const dashFile = path.join(tempDir, "dashboard.html");
        fs.writeFileSync(dashFile, generateDashboardHTML(), "utf8");

        const url = `http://127.0.0.1:${port}/?project_id=${encodeURIComponent(resolvedId)}`;

        return {
          dashboard_file: dashFile,
          dashboard_url: url,
          message: `Dashboard running at ${url} — open in your browser.`
        };
      }
    }
  ];
}
