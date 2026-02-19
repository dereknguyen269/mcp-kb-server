import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.resolve(__dirname, "../../config/discovery.json");
export const discoveryConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

export const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build"]);

export function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

/**
 * Check that absPath is inside rootDir, resolving symlinks to prevent bypass.
 */
export function isSafeResolvedPath(rootDir, absPath) {
  let realRoot, realAbs;
  try {
    realRoot = fs.realpathSync(rootDir);
  } catch {
    realRoot = rootDir;
  }
  try {
    realAbs = fs.realpathSync(absPath);
  } catch {
    // Path doesn't exist yet — fall back to lexical check
    const rel = path.relative(rootDir, absPath);
    if (rel === "") return true;
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }
  const rel = path.relative(realRoot, realAbs);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function looksBinary(buffer) {
  if (buffer.includes(0)) return true;
  const text = buffer.toString("utf8");
  if (text.length === 0) return false;
  const replacementCount = text.split("\uFFFD").length - 1;
  return replacementCount / text.length > 0.01;
}

export function readTextFileSafe(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    if (looksBinary(buf)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

export function matchSegment(name, pattern) {
  let reSrc = "^";
  for (const ch of pattern) {
    if (ch === "*") { reSrc += ".*"; continue; }
    if (ch === "?") { reSrc += "."; continue; }
    if (/[-/\\^$*+?.()|[\]{}]/.test(ch)) { reSrc += `\\${ch}`; continue; }
    reSrc += ch;
  }
  reSrc += "$";
  return new RegExp(reSrc).test(name);
}

export function hasGlob(p) {
  return /[*?]/.test(p);
}

export function normalizeRelPath(input) {
  const trimmed = String(input).trim();
  const noPrefix = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
  return toPosixPath(noPrefix);
}

export function resolveFromRoot(rootDir, relPath) {
  const rel = normalizeRelPath(relPath);
  if (!rel) return null;
  const abs = path.resolve(rootDir, ...rel.split("/"));
  if (!isSafeResolvedPath(rootDir, abs)) return null;
  return { abs, rel };
}

export function dedupePaths(paths) {
  const map = new Map();
  for (const p of paths) {
    const rel = normalizeRelPath(p);
    if (!rel) continue;
    if (!map.has(rel)) map.set(rel, rel);
  }
  return Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
}

export function expandGlob(rootDir, relPattern) {
  const pattern = normalizeRelPath(relPattern);
  const segments = pattern.split("/").filter((s) => s.length > 0);
  const results = [];

  function walk(segIdx, curAbs, curRel) {
    if (segIdx >= segments.length) {
      results.push({ abs: curAbs, rel: curRel });
      return;
    }
    const seg = segments[segIdx];
    if (seg === "**") {
      walk(segIdx + 1, curAbs, curRel);
      let dirents;
      try { dirents = fs.readdirSync(curAbs, { withFileTypes: true }); } catch { return; }
      dirents.sort((a, b) => a.name.localeCompare(b.name));
      for (const d of dirents) {
        if (!d.isDirectory() || SKIP_DIR_NAMES.has(d.name)) continue;
        const nextAbs = path.join(curAbs, d.name);
        const nextRel = curRel ? `${curRel}/${d.name}` : d.name;
        walk(segIdx, nextAbs, nextRel);
      }
      return;
    }
    if (!hasGlob(seg)) {
      const nextAbs = path.join(curAbs, seg);
      if (!fs.existsSync(nextAbs)) return;
      const nextRel = curRel ? `${curRel}/${seg}` : seg;
      walk(segIdx + 1, nextAbs, nextRel);
      return;
    }
    let dirents;
    try { dirents = fs.readdirSync(curAbs, { withFileTypes: true }); } catch { return; }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirents) {
      if (SKIP_DIR_NAMES.has(d.name) || !matchSegment(d.name, seg)) continue;
      const nextAbs = path.join(curAbs, d.name);
      const nextRel = curRel ? `${curRel}/${d.name}` : d.name;
      walk(segIdx + 1, nextAbs, nextRel);
    }
  }

  walk(0, rootDir, "");
  const uniq = new Map();
  for (const r of results) uniq.set(r.rel, r);
  return Array.from(uniq.values()).sort((a, b) => a.rel.localeCompare(b.rel));
}

export function collectFilesFromDirectory(rootDir, absDir, relDir) {
  const out = [];
  let dirents;
  try { dirents = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return out; }
  dirents.sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirents) {
    if (SKIP_DIR_NAMES.has(d.name)) continue;
    const childAbs = path.join(absDir, d.name);
    const childRel = relDir ? `${relDir}/${d.name}` : d.name;
    if (d.isDirectory()) {
      out.push(...collectFilesFromDirectory(rootDir, childAbs, childRel));
    } else if (d.isFile()) {
      out.push({ abs: childAbs, rel: childRel });
    }
  }
  return out;
}

export function loadAuthoritativeFiles(rootDir, includeFiles) {
  const entries = [];
  for (const raw of includeFiles) {
    const rel = normalizeRelPath(raw);
    if (!rel) continue;
    const matches = hasGlob(rel)
      ? expandGlob(rootDir, rel)
      : [{ abs: path.resolve(rootDir, rel), rel }];
    for (const m of matches) {
      if (!isSafeResolvedPath(rootDir, m.abs) || !fs.existsSync(m.abs)) continue;
      let stat;
      try { stat = fs.statSync(m.abs); } catch { continue; }
      if (stat.isDirectory()) {
        entries.push(...collectFilesFromDirectory(rootDir, m.abs, m.rel));
      } else if (stat.isFile()) {
        entries.push({ abs: m.abs, rel: m.rel });
      }
    }
  }
  entries.sort((a, b) => a.rel.localeCompare(b.rel));
  const map = new Map();
  for (const e of entries) {
    const content = readTextFileSafe(e.abs);
    if (content === null) continue;
    map.set(e.rel, content);
  }
  const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
  const out = {};
  for (const k of keys) out[k] = map.get(k);
  return out;
}

export function discoverInstructionPaths(rootDir) {
  const candidates = discoveryConfig.instructionFiles;
  const discovered = [];
  for (const c of candidates) {
    if (hasGlob(c)) {
      const matches = expandGlob(rootDir, c);
      for (const m of matches) {
        if (!fs.existsSync(m.abs)) continue;
        try { if (!fs.statSync(m.abs).isFile()) continue; } catch { continue; }
        discovered.push(m.rel);
      }
      continue;
    }
    const resolved = resolveFromRoot(rootDir, c);
    if (!resolved || !fs.existsSync(resolved.abs)) continue;
    try {
      const st = fs.statSync(resolved.abs);
      if (!st.isFile() && !st.isDirectory()) continue;
    } catch { continue; }
    discovered.push(resolved.rel);
  }
  discovered.sort((a, b) => a.localeCompare(b));
  return discovered;
}
