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
  <title>Knowledge Base Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"><\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
      --bg-sidebar: #FFFFFF;
      --bg-hover: #F1F5F9;
      --bg-active: #EFF6FF;
      --border: #E2E8F0;
      --border-active: #2563EB;
      --text: #1E293B;
      --text-muted: #64748B;
      --text-faint: #94A3B8;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
      --shadow: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
      --shadow-lg: 0 10px 30px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.06);
    }
    [data-theme="dark"] {
      --bg: #0F172A;
      --bg-panel: #1E293B;
      --bg-sidebar: #1E293B;
      --bg-hover: #334155;
      --bg-active: #1E3A5F;
      --border: #334155;
      --border-active: #3B82F6;
      --text: #F1F5F9;
      --text-muted: #94A3B8;
      --text-faint: #64748B;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
      --shadow: 0 4px 12px rgba(0,0,0,0.3);
      --shadow-lg: 0 10px 30px rgba(0,0,0,0.4);
    }

html, body { height: 100%; font-family: var(--font); background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.5; }
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }

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

/* Edit form */
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
    .scope-badge { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 99px; background: var(--blue-light); color: var(--blue); border: 1px solid #BFDBFE; }
    [data-theme="dark"] .scope-badge { background: #1E3A5F; color: #93C5FD; border-color: #1E40AF; }
    .memory-date { font-size: 11px; color: var(--text-faint); margin-left: auto; }
    .memory-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
    .memory-content { font-size: 13px; color: var(--text-muted); line-height: 1.6; }
    .memory-content.md { color: var(--text); }

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
    <div class="topbar-right">
      <button class="btn btn-sm" id="themeBtn" title="Toggle theme">
        <svg id="themeIconLight" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg id="themeIconDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
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
    </aside>

    <!-- Main -->
    <main class="main">
      <div class="main-tabs">
        <button class="tab-btn active" data-tab="document" id="tabDocument">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Document
        </button>
        <button class="tab-btn" data-tab="memory" id="tabMemory">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
          Memory
          <span id="memoryBadge" style="font-size:11px;background:var(--bg-hover);color:var(--text-muted);padding:1px 6px;border-radius:99px;border:1px solid var(--border)">0</span>
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
          <!-- Edit form (inline) -->
          <div id="editForm" style="display:none" class="edit-form">
            <div class="form-row">
              <div class="field"><label>Title</label><input id="editTitle" placeholder="Document title"></div>
              <div class="field"><label>Source URL (optional)</label><input id="editSource" placeholder="https://…"></div>
            </div>
            <div class="field"><label>Content (Markdown)</label><textarea id="editContent"></textarea></div>
            <div class="form-actions">
              <button class="btn btn-primary" id="saveEditBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                Save
              </button>
              <button class="btn" id="cancelEditBtn">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Memory tab -->
      <div class="tab-panel" id="panelMemory">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:var(--bg-panel)">
          <span style="font-size:12px;color:var(--text-muted)" id="memoryMeta">Loading…</span>
          <button class="btn btn-sm" id="memRefreshBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
        </div>
        <div class="memory-view" id="memoryList"></div>
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

<div class="toast-host" id="toastHost"></div>

<script>
  const THEME_KEY = 'kb.theme';
  const $ = id => document.getElementById(id);

  const state = { projects: [], projectId: null, items: [], total: 0, selectedId: null, selectedDoc: null };

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
      $('panel' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).classList.add('active');
      if (btn.dataset.tab === 'memory') loadMemory();
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
    await loadList();
    await loadMemory();
  };

  /* ── Doc list ── */
  async function loadList() {
    const q = $('searchInput').value.trim();
    const qs = q ? '?q=' + encodeURIComponent(q) : '';
    const data = await api('/api/kb' + qs);
    state.items = Array.isArray(data.items) ? data.items : [];
    state.total = data.total ?? state.items.length;
    renderList();
  }

  function renderList() {
    $('kbCount').textContent = state.total;
    const list = $('docList');
    if (!state.items.length) {
      list.innerHTML = \`<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>No documents found</p></div>\`;
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
  }


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
      await loadList();
    } catch (e) { toast('err', 'Delete failed: ' + e.message); }
  };

  /* ── Edit ── */
  $('editBtn').onclick = () => {
    if (!state.selectedDoc) return;
    $('editTitle').value = state.selectedDoc.title || '';
    $('editSource').value = state.selectedDoc.source || '';
    $('editContent').value = state.selectedDoc.content || '';
    $('docContent').style.display = 'none';
    $('editForm').style.display = 'flex';
  };
  $('cancelEditBtn').onclick = () => {
    $('editForm').style.display = 'none';
    $('docContent').style.display = 'block';
  };
  $('saveEditBtn').onclick = async () => {
    if (!state.selectedDoc) return;
    const title = $('editTitle').value.trim();
    const source = $('editSource').value.trim();
    const content = $('editContent').value;
    if (!title) { toast('err', 'Title is required'); return; }
    try {
      await api('/api/kb/' + state.selectedDoc.id, {
        method: 'PUT',
        body: JSON.stringify({ title, source: source || undefined, content })
      });
      toast('ok', 'Saved');
      await loadList();
      await selectDoc(state.selectedDoc.id);
    } catch (e) { toast('err', 'Save failed: ' + e.message); }
  };

  /* ── Memory ── */
  async function loadMemory() {
    if (!state.projectId) return;
    try {
      const data = await api('/api/memory?project_id=' + encodeURIComponent(state.projectId));
      const items = Array.isArray(data.items) ? data.items : [];
      $('memoryBadge').textContent = data.total ?? items.length;
      $('memoryMeta').textContent = (data.total ?? items.length) + ' entries for ' + state.projectId;
      const list = $('memoryList');
      if (!items.length) {
        list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg><p>No memory entries</p></div>';
        return;
      }
      list.innerHTML = items.map(m => {
        const tags = (m.tags || []).map(t => \`<span class="tag">\${esc(t)}</span>\`).join('');
        const date = m.created_at ? new Date(m.created_at).toLocaleString() : '';
        return \`<div class="memory-card">
          <div class="memory-card-header">
            <span class="scope-badge">\${esc(m.scope || 'default')}</span>
            \${tags ? \`<div style="display:flex;gap:4px;flex-wrap:wrap">\${tags}</div>\` : ''}
            <span class="memory-date">\${esc(date)}</span>
          </div>
          <div class="memory-content md">\${md(m.content || '')}</div>
        </div>\`;
      }).join('');
    } catch (e) { $('memoryMeta').textContent = 'Error loading memory'; }
  }
  $('memRefreshBtn').onclick = loadMemory;

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
      await api('/api/kb', { method: 'POST', body: JSON.stringify({ title, source: source || undefined, content }) });
      toast('ok', 'Document added');
      $('addModal').classList.remove('open');
      $('addTitle').value = ''; $('addSource').value = ''; $('addContent').value = '';
      await loadList();
    } catch (e) { toast('err', 'Add failed: ' + e.message); }
  };

  /* ── Search ── */
  let searchTimer;
  $('searchInput').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadList, 280); };

  /* ── Boot ── */
  async function boot() {
    const preferred = getQP('project_id');
    await loadProjects(preferred);
    await loadList();
    const docId = getQP('doc_id');
    if (docId) await selectDoc(Number(docId));
  }
  boot().catch(e => toast('err', 'Init error: ' + e.message));
<\/script>
</body>
</html>
`;
}

async function ensureServer({ memoryDb, kbDb, rootDir, port: preferredPort }) {
  if (serverState) return serverState;

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const pathname = u.pathname;
    const method = req.method.toUpperCase();

    // CORS for local dev
    res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
    res.setHeader("Vary", "Origin");
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    try {
      // ── GET /api/projects ──
      if (method === "GET" && pathname === "/api/projects") {
        const rows = memoryDb.prepare(
          "SELECT project_id, COUNT(*) as total_entries FROM memory GROUP BY project_id ORDER BY MAX(created_at) DESC"
        ).all();
        return json(res, 200, rows);
      }

      // ── GET /api/kb ──
      if (method === "GET" && pathname === "/api/kb") {
        const q = u.searchParams.get("q") || "";
        const limit = asLimit(Number(u.searchParams.get("limit")), 100);
        let rows;
        if (q.trim()) {
          rows = kbDb.prepare(
            "SELECT rowid as id, title, source FROM kb_fts WHERE kb_fts MATCH ? ORDER BY rank LIMIT ?"
          ).all(q.trim() + "*", limit);
        } else {
          rows = kbDb.prepare("SELECT rowid as id, title, source FROM kb_fts LIMIT ?").all(limit);
        }
        const total = q.trim()
          ? kbDb.prepare("SELECT COUNT(*) as n FROM kb_fts WHERE kb_fts MATCH ?").get(q.trim() + "*")?.n ?? 0
          : kbDb.prepare("SELECT COUNT(*) as n FROM kb_fts").get()?.n ?? 0;
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

      // ── POST /api/kb ──
      if (method === "POST" && pathname === "/api/kb") {
        const body = await readJsonBody(req);
        const { title, content, source } = body;
        if (!title || typeof title !== "string") return badRequest(res, "title required");
        kbDb.prepare("INSERT INTO kb_fts(title, content, source) VALUES (?,?,?)")
          .run(title, content ?? "", source ?? "");
        return json(res, 201, { ok: true });
      }

      // ── GET /api/memory ──
      if (method === "GET" && pathname === "/api/memory") {
        const projectId = u.searchParams.get("project_id");
        const limit = asLimit(Number(u.searchParams.get("limit")), 50);
        try {
          let rows, total;
          if (projectId) {
            rows = memoryDb.prepare(
              "SELECT id, scope, content, tags, created_at FROM memory WHERE project_id=? ORDER BY created_at DESC LIMIT ?"
            ).all(projectId, limit);
            total = memoryDb.prepare("SELECT COUNT(*) as n FROM memory WHERE project_id=?").get(projectId)?.n ?? 0;
          } else {
            rows = memoryDb.prepare(
              "SELECT id, scope, content, tags, created_at FROM memory ORDER BY created_at DESC LIMIT ?"
            ).all(limit);
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
    server.listen(preferredPort ?? 0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  server.unref(); // don't keep process alive
  const { port } = server.address();
  serverState = { server, port };
  return serverState;
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
