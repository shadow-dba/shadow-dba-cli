'use strict';

const fs = require('fs');
const path = require('path');
const { stdout, stderr } = require('node:process');

const { openWorkspace } = require('./open');
const { TEMPLATES_DIR, shippedFiles, saveBase } = require('./manifest');

// Supported database engines. Each ships its templates under
// `templates/<key>/`. Only `mssql` ships content today; `templates/postgres/`
// is an empty placeholder, so `postgres` is shown in the picker as upcoming.
const ENGINES = {
  mssql: { label: 'mssql', defaultName: 'mssql-shadow-dba', available: true },
  postgres: { label: 'postgres (upcoming)', defaultName: 'postgres-shadow-dba', available: false },
};

const HELP = `shadow-dba workspace init — create a ready-to-use Claude DBA workspace

Usage:
  npx shadow-dba workspace init [options]
  npx shadow-dba [options]                (same thing)

Creates a workspace folder in the current directory containing a .claude/
setup (agents + skills + settings), a CLAUDE.md system prompt, a .mcp.json
wired to the DBA MCP server, a .env.example, a .gitignore, and a scripts/
folder for your own routines.

Options:
  --name <folder>     Workspace folder name (default: mssql-shadow-dba)
  --engine <engine>   Database engine: mssql (default; postgres is coming)
  --no-open           Don't auto-open the workspace in your editor / docs in a browser
  -h, --help          Show this help

After scaffolding (interactive runs in a terminal) the workspace opens in your
editor and DOCS.html — the quick start — opens in your browser automatically.
A ready-to-edit .env is created for you; fill in your connection details as the
quick start explains, then run claude. Pass --no-open to skip auto-opening.
`;

function parseArgs(argv) {
  const opts = { name: null, engine: 'mssql', help: false, nameProvided: false, engineProvided: false, noOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--name':
        opts.name = argv[++i];
        opts.nameProvided = true;
        break;
      case '--engine':
        opts.engine = argv[++i];
        opts.engineProvided = true;
        break;
      case '--no-open':
        opts.noOpen = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (opts.nameProvided && (opts.name == null || opts.name === '' || opts.name.startsWith('-'))) {
    throw new Error('--name requires a folder name');
  }
  checkEngine(opts.engine);
  if (!opts.nameProvided) opts.name = ENGINES[opts.engine].defaultName;
  return opts;
}

function checkEngine(engine) {
  if (engine == null || engine === '' || engine.startsWith('-')) {
    throw new Error('--engine requires an engine name (mssql)');
  }
  if (!ENGINES[engine]) {
    throw new Error(`Unknown engine "${engine}". Available: ${availableEngines().join(', ')}`);
  }
  if (!ENGINES[engine].available) {
    throw new Error(`The ${engine} engine is coming soon. Available now: ${availableEngines().join(', ')}`);
  }
}

function availableEngines() {
  return Object.keys(ENGINES).filter((k) => ENGINES[k].available);
}

// Creates `target` and copies the chosen engine's templates into it, using
// the copy mapping in `shippedFiles()` (which restores the leading dots).
// Shared by the non-interactive `scaffold()` path and the cinematic installer.
function writeWorkspace(target, engine = 'mssql', { templatesDir = TEMPLATES_DIR } = {}) {
  if (!ENGINES[engine] || !ENGINES[engine].available) {
    throw new Error(`No templates available for engine "${engine}" yet.`);
  }
  const files = shippedFiles(engine, templatesDir);
  for (const f of files) {
    const dest = path.join(target, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.src, dest);
  }
  // Pre-create .env from the template so the user just fills it in — no `cp`
  // step. .env.example is kept as a pristine reference; .gitignore ignores .env.
  // .env is the user's from here on, so it isn't a shipped file.
  fs.copyFileSync(path.join(templatesDir, engine, '.env.example'), path.join(target, '.env'));
  // Generated in code, not shipped: npm strips files literally named .gitignore.
  fs.writeFileSync(path.join(target, '.gitignore'), '.env\n');
  // Empty home for the user's own DBA routines.
  fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
  // Base snapshot + version, so `shadow-dba workspace update` can 3-way merge later.
  saveBase(target, engine, files);
}

async function scaffold(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    stdout.write(HELP);
    return 0;
  }

  const target = path.join(process.cwd(), opts.name);
  if (fs.existsSync(target)) {
    stderr.write(
      `Error: "${opts.name}" already exists at ${target}.\n` +
      `Remove it or pass --name <folder> to scaffold somewhere else.\n`
    );
    return 1;
  }

  writeWorkspace(target, opts.engine);

  // Auto-open in a real terminal (no-op for pipes/CI or with --no-open).
  const opened = await openWorkspace({
    target,
    docsPath: path.join(target, 'DOCS.html'),
    noOpen: opts.noOpen,
  });

  let out =
    `\n✓ Created ${opts.name} workspace at ${target}\n\n` +
    `  ${opts.name}/\n` +
    `  ├── .claude/        agents, skills, settings\n` +
    `  ├── .mcp.json       DBA MCP server\n` +
    `  ├── .env            connection settings — fill this in\n` +
    `  ├── .env.example    reference copy\n` +
    `  ├── .gitignore      ignores .env\n` +
    `  ├── scripts/        your DBA routines\n` +
    `  ├── .shadow-dba/    template snapshot for updates\n` +
    `  ├── DOCS.html       the quick start — open in a browser\n` +
    `  └── CLAUDE.md       DBA system prompt\n\n`;

  if (opened.editor) out += `Opened in ${opened.editor}.\n`;
  if (opened.docsOpened) out += `Docs opened in your browser.\n`;
  if (!opened.docsOpened) {
    out += `Open ${opts.name}/DOCS.html for the quick start (mental model + .env setup), then run claude.\n`;
  }

  stdout.write(out);
  return 0;
}

module.exports = { scaffold, parseArgs, writeWorkspace, checkEngine, ENGINES, TEMPLATES_DIR };
