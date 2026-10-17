'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('node:readline');
const { stdin, stdout, stderr } = require('node:process');

const manifest = require('./manifest');
const { hasGit, merge3 } = require('./merge');

const HELP = `shadow-dba workspace update — merge the latest templates into an existing workspace

Usage:
  npx shadow-dba@latest workspace update [options]
  npx shadow-dba@latest update [options]          (same thing)

Brings new skill, agent and config versions into your workspace without
overwriting your own changes. Files you edited are 3-way merged; overlapping
edits are left as conflict markers for you to resolve. .env, .gitignore,
scripts/ and files you added are never touched.

Options:
  --path <dir>   Workspace folder (default: current folder)
  --dry-run      Show what would change, write nothing
  --yes          Apply without asking (required when not in a terminal)
  -h, --help     Show this help
`;

// How each action is shown in the plan, in display order.
const LABELS = {
  update: 'updated',
  merge: 'merged',
  conflict: 'conflict',
  'new-file': 'new copy',
  add: 'added',
  delete: 'removed',
  'keep-modified': 'kept',
  'skip-deleted': 'skipped',
};

const NOTES = {
  conflict: 'resolve the conflict markers',
  'new-file': 'your file differs; merge the .new file by hand, then delete it',
  'keep-modified': 'no longer shipped, but you changed it',
  'skip-deleted': 'you deleted it; a newer version exists',
};

function parseUpdateArgs(argv) {
  const opts = { path: process.cwd(), dryRun: false, yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--path':
        opts.path = argv[++i];
        if (opts.path == null || opts.path === '' || opts.path.startsWith('-')) {
          throw new Error('--path requires a folder');
        }
        opts.path = path.resolve(opts.path);
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--yes':
      case '-y':
        opts.yes = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

// Identify the workspace. A saved state means a real 3-way merge is possible;
// a workspace from before `update` existed has no base, so it falls back to
// two-way (differing files get a .new copy).
function findWorkspace(dir) {
  const stateFile = path.join(dir, manifest.STATE_FILE);
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.kind && state.kind !== 'workspace') {
      throw new Error(`${dir} is a shadow-dba ${state.kind}, not a workspace.`);
    }
    // `provider` is the pre-0.1 name of `engine`.
    return { dir, engine: state.engine || state.provider, fromVersion: state.version, hasBase: true };
  }
  if (fs.existsSync(path.join(dir, 'CLAUDE.md')) && fs.existsSync(path.join(dir, '.mcp.json'))) {
    return { dir, engine: 'mssql', fromVersion: null, hasBase: false };
  }
  throw new Error(`${dir} is not a shadow-dba workspace (no ${manifest.STATE_FILE}).`);
}

// Decide what to do with every shipped file without writing anything.
// B = base (what we shipped last time), U = user's file, N = new template.
function planUpdate(dir, engine, { templatesDir, git = hasGit() } = {}) {
  const files = manifest.shippedFiles(engine, templatesDir);
  const next = new Map(files.map((f) => [f.rel, f.src]));
  const rels = new Set([...next.keys(), ...manifest.baseFiles(dir)]);
  const actions = [];

  for (const rel of [...rels].sort()) {
    const N = next.has(rel) ? fs.readFileSync(next.get(rel)) : null;
    const B = read(path.join(dir, manifest.BASE_DIR, rel));
    const U = read(path.join(dir, rel));
    const act = (kind, data) => actions.push({ rel, kind, data });

    if (!N) {
      // Template dropped the file: remove it only if the user never touched it.
      if (!U) continue;
      if (U.equals(B)) act('delete');
      else act('keep-modified');
      continue;
    }
    if (!U) {
      if (!B) act('add', N);
      else if (!B.equals(N)) act('skip-deleted');
      continue;
    }
    if (U.equals(N)) continue;
    if (!B) act('new-file', N);
    else if (B.equals(N)) continue; // only the user changed it
    else if (U.equals(B)) act('update', N); // only we changed it
    else if (!git) act('new-file', N);
    else {
      const { text, conflicts } = merge3(U, B, N);
      act(conflicts ? 'conflict' : 'merge', Buffer.from(text));
    }
  }
  return { files, actions };
}

// Back up every user file about to change, apply the plan, then refresh the
// base snapshot so the next update merges against what we ship now.
function applyUpdate(dir, engine, { files, actions }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(dir, manifest.BACKUP_DIR);
  const backup = path.join(backupRoot, stamp);
  const touches = actions.filter((a) => ['update', 'merge', 'conflict', 'delete'].includes(a.kind));

  if (touches.length) {
    for (const a of touches) {
      const dest = path.join(backup, a.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(dir, a.rel), dest);
    }
    // Self-ignoring, so backups never land in the user's git history.
    fs.writeFileSync(path.join(backupRoot, '.gitignore'), '*\n');
  }

  try {
    for (const a of actions) {
      const file = path.join(dir, a.rel);
      if (a.kind === 'delete') fs.rmSync(file);
      else if (a.kind === 'new-file') fs.writeFileSync(`${file}.new`, a.data);
      else if (a.data) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, a.data);
      }
    }
    manifest.saveBase(dir, engine, files);
  } catch (err) {
    if (touches.length) err.message += `\nYour previous files are in ${backup}`;
    throw err;
  }
  return touches.length ? backup : null;
}

function formatPlan(actions) {
  let out = '';
  for (const kind of Object.keys(LABELS)) {
    for (const a of actions.filter((x) => x.kind === kind)) {
      const name = kind === 'new-file' ? `${a.rel}.new` : a.rel;
      const note = NOTES[kind] ? `  (${NOTES[kind]})` : '';
      out += `  ${LABELS[kind].padEnd(9)} ${name}${note}\n`;
    }
  }
  return out;
}

function confirm(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function update(argv) {
  const opts = parseUpdateArgs(argv);
  if (opts.help) {
    stdout.write(HELP);
    return 0;
  }

  const ws = findWorkspace(opts.path);
  const { ENGINES } = require('./scaffold');
  if (!ENGINES[ws.engine] || !ENGINES[ws.engine].available) {
    throw new Error(`Unknown engine "${ws.engine}" in ${manifest.STATE_FILE}.`);
  }

  const git = hasGit();
  const plan = planUpdate(ws.dir, ws.engine, { git });
  const from = ws.fromVersion || 'unknown';
  stdout.write(`\nshadow-dba workspace update: ${ws.engine} templates ${from} → ${manifest.version}\n\n`);

  if (!plan.actions.length) {
    // Still record the base, so a pre-update workspace gets real merges next time.
    if (!opts.dryRun) manifest.saveBase(ws.dir, ws.engine, plan.files);
    stdout.write('Already up to date.\n');
    return 0;
  }

  stdout.write(formatPlan(plan.actions));
  if (!ws.hasBase) {
    stdout.write('\nThis workspace predates `update`, so changed files get a .new copy instead of a merge.\n');
  } else if (!git) {
    stdout.write('\ngit is not installed, so files you changed get a .new copy instead of a merge.\n');
  }

  if (opts.dryRun) {
    stdout.write('\nDry run: nothing was written.\n');
    return 0;
  }
  if (!opts.yes) {
    if (!(stdin.isTTY && stdout.isTTY)) {
      stderr.write('\nNot a terminal: re-run with --yes to apply.\n');
      return 1;
    }
    if (!(await confirm('\nApply these changes? [y/N] '))) {
      stdout.write('Cancelled. Nothing was written.\n');
      return 0;
    }
  }

  const backup = applyUpdate(ws.dir, ws.engine, plan);
  const todo = plan.actions.filter((a) => a.kind === 'conflict' || a.kind === 'new-file');

  stdout.write(`\n✓ Updated to ${manifest.version}.\n`);
  if (backup) stdout.write(`  Previous versions of changed files: ${path.relative(ws.dir, backup)}/\n`);
  if (todo.length) {
    stdout.write(
      `\n${todo.length} file(s) need your attention (see "conflict" and "new copy" above).\n` +
      `Resolve the conflict markers and merge the .new files, then delete the .new files.\n`
    );
    return 2;
  }
  return 0;
}

module.exports = { update, parseUpdateArgs, findWorkspace, planUpdate, applyUpdate };
