'use strict';

// The cinematic shadow-dba installer: splash → name prompt → animated provision
// log → query-result success screen. Only invoked from an interactive TTY; the
// non-interactive path stays in scaffold.js.

const fs = require('fs');
const path = require('path');
const readline = require('node:readline');
const { stdin, stdout } = require('node:process');

const { writeWorkspace, ENGINES } = require('./scaffold');
const { openWorkspace } = require('./open');
const ui = require('./ui');
const { PALETTE, paint, bold, wordmark, terminalWindow, spinner, sleep } = ui;

const fast = Boolean(process.env.CI);
const pause = (ms) => (fast ? Promise.resolve() : sleep(ms));

function line(text = '') {
  stdout.write(`${text}\n`);
}

// Splash: the brand wordmark inside the faux terminal window.
async function splash() {
  line();
  const win = terminalWindow([
    wordmark(),
    paint('Senior DBA, in one command', PALETTE.STONE),
  ]);
  line(win);
  line();
  await pause(400);
}

// Ask for the workspace folder name, defaulting to `def`. Re-prompts until the
// answer is a valid, non-colliding folder name. Returns { name, target }.
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Pick a database engine with an arrow-key menu. ↑/↓ move the pointer between
// selectable (available) entries only; upcoming entries are shown dimmed and
// skipped. Enter confirms. Returns the engine key.
function promptEngine() {
  const keys = Object.keys(ENGINES);
  // Indices (into `keys`) the pointer is allowed to land on.
  const selectable = keys.map((k, i) => (ENGINES[k].available ? i : -1)).filter((i) => i >= 0);
  let pos = 0; // index into `selectable`

  const draw = () => {
    const out = [
      `  ${paint('›', PALETTE.ORANGE)} ${paint('DBA type', PALETTE.LIGHT)}   ${paint('↑/↓ to choose · Enter to confirm', PALETTE.GRANITE)}`,
    ];
    keys.forEach((key, i) => {
      const p = ENGINES[key];
      const active = selectable[pos] === i;
      const pointer = active ? paint('❯', PALETTE.ORANGE) : ' ';
      const label = active
        ? bold(paint(p.label, PALETTE.LIGHT))
        : paint(p.label, p.available ? PALETTE.STONE : PALETTE.GRANITE);
      out.push(`    ${pointer} ${label}`);
    });
    return out;
  };

  let rendered = 0;
  const show = () => {
    if (rendered && stdout.isTTY) stdout.write(`\x1b[${rendered}A`);
    for (const l of draw()) {
      if (stdout.isTTY) stdout.write('\r\x1b[2K');
      stdout.write(`${l}\n`);
    }
    rendered = keys.length + 1;
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (buf) => {
      const s = buf.toString();
      if (s === '\x03') {
        // Ctrl-C: raw mode swallows SIGINT, so handle the quit ourselves.
        cleanup();
        ui.showCursor();
        stdout.write('\n');
        process.exit(130);
      } else if (s.includes('\x1b[A') || s.includes('\x1bOA') || s === 'k') {
        pos = (pos - 1 + selectable.length) % selectable.length;
        show();
      } else if (s.includes('\x1b[B') || s.includes('\x1bOB') || s === 'j') {
        pos = (pos + 1) % selectable.length;
        show();
      } else if (s.includes('\r') || s.includes('\n')) {
        cleanup();
        resolve(keys[selectable[pos]]);
      }
    };

    line();
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    show();
  });
}

async function promptName(def) {
  const chevron = paint('›', PALETTE.ORANGE);
  const question =
    `  ${chevron} workspace name ${paint('— press Enter for default', PALETTE.GRANITE)} ${paint(def, PALETTE.STONE)}\n` +
    `  ${chevron} `;

  for (;;) {
    const raw = await ask(question);
    const name = raw.trim() || def;

    if (/[\\/]/.test(name) || name === '.' || name === '..') {
      line(`    ${paint('✗', PALETTE.ORANGE)} ${paint('folder name can’t contain a path — try a plain name', PALETTE.STONE)}`);
      continue;
    }

    const target = path.join(process.cwd(), name);
    if (fs.existsSync(target)) {
      line(`    ${paint('✗', PALETTE.ORANGE)} ${paint(`"${name}" already exists — pick another name`, PALETTE.STONE)}`);
      continue;
    }
    return { name, target };
  }
}

// Animated provision log. Does the real copy on the first step, then reveals the
// individual artifacts so the work reads like a DBA session.
async function provision(name, target, engine) {
  line();
  line(`  ${paint('›', PALETTE.ORANGE)} ${paint(`provisioning ./${name}`, PALETTE.LIGHT)}`);

  const steps = [
    { label: 'writing .claude/', hint: 'agents · skills · settings', work: () => writeWorkspace(target, engine) },
    { label: 'writing CLAUDE.md', hint: 'DBA system prompt' },
    { label: 'writing .mcp.json', hint: 'DBA MCP server' },
    { label: 'writing .env.example', hint: 'connection settings' },
    { label: 'writing .gitignore', hint: 'ignores .env' },
    { label: 'writing scripts/', hint: 'your DBA routines' },
    { label: 'writing DOCS.html', hint: 'how to use this workspace' },
  ];

  for (const s of steps) {
    const spin = spinner(s.label);
    await pause(420);
    if (s.work) s.work();
    spin.succeed(`${s.label}   ${paint(s.hint, PALETTE.GRANITE)}`);
    await pause(120);
  }
}

// Query-result-styled success screen: auto-open the workspace + docs. Setup now
// lives in the browser-rendered quick start, so we only confirm what opened —
// or point at DOCS.html when the browser didn't.
async function success(name, target, opts) {
  const g = (t) => paint(t, PALETTE.GRANITE);
  const s = (t) => paint(t, PALETTE.STONE);
  const o = (t) => paint(t, PALETTE.ORANGE);

  line();
  line(`  ${g('(1 workspace created)')}`);
  line();
  line(`  ${o('✓')} ${bold(paint(name, PALETTE.LIGHT))}`);
  line(`    ${s(target)}`);
  line();

  const opened = await openWorkspace({
    target,
    docsPath: path.join(target, 'DOCS.html'),
    noOpen: opts.noOpen,
  });
  if (opened.editor) line(`  ${o('›')} ${g('opened in')} ${s(opened.editor)}`);
  if (opened.docsOpened) line(`  ${o('›')} ${g('docs opened in your browser')}`);
  if (!opened.docsOpened) {
    line(`  ${o('›')} ${g('open')} ${s(`${name}/DOCS.html`)} ${g('for the quick start, then run claude')}`);
  }
  line();
}

async function runInteractive(opts) {
  ui.hideCursor();
  try {
    await splash();
    // --engine skips the arrow-key menu (cursor hidden while it's shown).
    const engine = opts.engineProvided ? opts.engine : await promptEngine();
    ui.showCursor(); // cursor visible while the user types the name
    const { name, target } = await promptName(ENGINES[engine].defaultName);
    ui.hideCursor();
    await provision(name, target, engine);
    await success(name, target, opts);
  } finally {
    ui.showCursor();
  }
  return 0;
}

module.exports = { runInteractive };
