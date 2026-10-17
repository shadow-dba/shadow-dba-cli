'use strict';

// Post-scaffold launcher: detect the user's IDE, open the new workspace in it,
// and open DOCS.html in the default browser (the only thing that renders the
// HTML). Zero-dependency — shells out per platform with an args array (never a
// shell string) so a folder name can't inject commands. Every operation fails
// soft: on any error we return falsy and the caller prints text instructions.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('node:child_process');
const { stdout } = require('node:process');

// GUI editors that can open a folder, in priority order. `code` first: when a
// user has several installed, VS Code is the safe default.
const EDITORS = [
  { bin: 'code', label: 'VS Code' },
  { bin: 'cursor', label: 'Cursor' },
  { bin: 'windsurf', label: 'Windsurf' },
  { bin: 'subl', label: 'Sublime Text' },
  { bin: 'zed', label: 'Zed' },
];

// Resolve `bin` to a full path on PATH, or null. On Windows the launchers are
// `.cmd`/`.exe` shims; resolving to the explicit file lets us spawn without
// `shell: true` (which would reintroduce injection risk from the folder name).
function which(bin) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      try {
        if (process.platform === 'win32') {
          if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
        } else {
          fs.accessSync(full, fs.constants.X_OK);
          return full;
        }
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

// Pick an editor: first launcher found on PATH, in EDITORS priority order. As a
// last resort, if we're inside a VS Code integrated terminal but `code` isn't on
// PATH, try the bare command. Returns { command, label } or null.
function detectEditor() {
  for (const e of EDITORS) {
    const resolved = which(e.bin);
    if (resolved) return { command: resolved, label: e.label };
  }
  if (process.env.TERM_PROGRAM === 'vscode') {
    return { command: 'code', label: 'VS Code' };
  }
  return null;
}

// macOS only: the bundle id of the user's default *browser* (the http/https URL
// handler), read from LaunchServices. This is distinct from the `.html` file-type
// association, which `open <file>` would otherwise use — that's often an editor.
function macDefaultBrowserBundleId() {
  try {
    const res = spawnSync(
      'defaults',
      ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure'],
      { encoding: 'utf8' }
    );
    if (res.status !== 0 || !res.stdout) return null;
    let https = null;
    let http = null;
    for (const block of res.stdout.split('}')) {
      const scheme = /LSHandlerURLScheme = (https?);/.exec(block);
      if (!scheme) continue;
      const role =
        /LSHandlerRoleAll = "([^"]+)";/.exec(block) ||
        /LSHandlerRoleViewer = "([^"]+)";/.exec(block);
      if (!role) continue;
      if (scheme[1] === 'https') https = role[1];
      else http = role[1];
    }
    return https || http;
  } catch {
    return null;
  }
}

// Spawn detached and resolve true once it actually launches, false on ENOENT or
// any spawn error. Never rejects.
function trySpawn(command, args) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.once('error', () => done(false));
      child.once('spawn', () => {
        child.unref();
        done(true);
      });
    } catch {
      done(false);
    }
  });
}

// Open a file in the user's default *browser* so DOCS.html actually renders.
// On macOS, force the default-browser bundle id (not the .html file association,
// which may be an editor). Linux/Windows route through the system opener, which
// can hit the same file-association gotcha — documented, not yet worked around.
function openInBrowser(file) {
  if (process.platform === 'darwin') {
    const id = macDefaultBrowserBundleId();
    if (id) return trySpawn('open', ['-b', id, file]);
    return trySpawn('open', [file]);
  }
  if (process.platform === 'win32') return trySpawn('cmd', ['/c', 'start', '', file]);
  return trySpawn('xdg-open', [file]);
}

// Open the workspace in the detected editor and DOCS.html in the browser.
// No-ops when suppressed, non-interactive, or in CI. Setup now lives in the
// browser-rendered Quick Start, so when docs don't open the caller prints a
// one-line pointer to DOCS.html. Returns { editor, docsOpened }.
async function openWorkspace({ target, docsPath, noOpen }) {
  const result = { editor: null, docsOpened: false };
  if (noOpen || !stdout.isTTY || process.env.CI) return result;

  const ed = detectEditor();
  if (ed && (await trySpawn(ed.command, [target]))) {
    result.editor = ed.label;
    // Editors launch async: the process spawns now but its window surfaces a
    // beat later and grabs focus. Open the browser last *and* after a short
    // delay so the docs page — not the IDE — is left on top for the user.
    if (docsPath) await new Promise((r) => setTimeout(r, 1200));
  }
  if (docsPath) result.docsOpened = await openInBrowser(docsPath);

  return result;
}

module.exports = { detectEditor, trySpawn, openInBrowser, openWorkspace };
