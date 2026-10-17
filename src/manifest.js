'use strict';

const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// Workspace-side bookkeeping for `shadow-dba workspace update`.
const STATE_DIR = '.shadow-dba';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const BASE_DIR = path.join(STATE_DIR, 'base');
const BACKUP_DIR = path.join(STATE_DIR, 'backup');

// Top-level template files and where they land in the workspace. The leading
// dot of `.mcp.json` is restored here. `claude/` is walked separately.
const TOP_FILES = [
  { from: 'CLAUDE.md', to: 'CLAUDE.md' },
  { from: '.env.example', to: '.env.example' },
  { from: 'DOCS.html', to: 'DOCS.html' },
  { from: 'mcp.json', to: '.mcp.json' },
];

const IGNORED = new Set(['.DS_Store']);

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

// Single source of truth for the template copy mapping: every file an engine
// ships, as { src: absolute template path, rel: workspace-relative posix path }.
// Used by both `writeWorkspace()` and `shadow-dba workspace update`.
function shippedFiles(engine, templatesDir = TEMPLATES_DIR) {
  const root = path.join(templatesDir, engine);
  const files = TOP_FILES.map(({ from, to }) => ({ src: path.join(root, from), rel: to }));
  // templates/<engine>/claude -> <target>/.claude  (dot restored here)
  for (const rel of walk(path.join(root, 'claude'))) {
    files.push({ src: path.join(root, 'claude', rel), rel: `.claude/${rel}` });
  }
  return files;
}

// Snapshot the shipped files into <target>/.shadow-dba/base/ and record the
// engine + version. This is the "base" side of the 3-way merge on update.
// `kind` tells a workspace apart from a future app install (both use .shadow-dba/).
function saveBase(target, engine, files) {
  const base = path.join(target, BASE_DIR);
  fs.rmSync(base, { recursive: true, force: true });
  for (const f of files) {
    const dest = path.join(base, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.src, dest);
  }
  fs.writeFileSync(path.join(target, STATE_FILE), JSON.stringify({ kind: 'workspace', engine, version }, null, 2) + '\n');
}

function baseFiles(target) {
  const base = path.join(target, BASE_DIR);
  return fs.existsSync(base) ? walk(base) : [];
}

module.exports = {
  TEMPLATES_DIR,
  STATE_FILE,
  BASE_DIR,
  BACKUP_DIR,
  version,
  shippedFiles,
  saveBase,
  baseFiles,
};
