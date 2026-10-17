'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeWorkspace } = require('../src/scaffold');
const { planUpdate, applyUpdate, findWorkspace } = require('../src/update');
const { merge3 } = require('../src/merge');
const { TEMPLATES_DIR, BASE_DIR, STATE_FILE } = require('../src/manifest');

const SKILL = '.claude/skills/index-tuning/SKILL.md';
const TPL_SKILL = 'claude/skills/index-tuning/SKILL.md';

// A private copy of the real templates (so tests can "ship" a new version)
// plus a workspace scaffolded from it.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-dba-test-'));
  const templatesDir = path.join(root, 'templates');
  fs.cpSync(path.join(TEMPLATES_DIR, 'mssql'), path.join(templatesDir, 'mssql'), { recursive: true });
  const ws = path.join(root, 'ws');
  writeWorkspace(ws, 'mssql', { templatesDir });
  const tpl = (rel) => path.join(templatesDir, 'mssql', rel);
  const file = (rel) => path.join(ws, rel);
  const plan = (opts) => planUpdate(ws, 'mssql', { templatesDir, git: true, ...opts });
  const kinds = (p) => Object.fromEntries(p.actions.map((a) => [a.rel, a.kind]));
  return { root, ws, tpl, file, plan, kinds };
}

const lines = (n, edit = {}) =>
  Array.from({ length: n }, (_, i) => edit[i] ?? `line ${i}`).join('\n') + '\n';

test('fresh workspace has base and state, and nothing to update', () => {
  const t = setup();
  assert.ok(fs.existsSync(path.join(t.ws, STATE_FILE)));
  assert.ok(fs.existsSync(path.join(t.ws, BASE_DIR, SKILL)));
  assert.ok(!fs.existsSync(path.join(t.ws, BASE_DIR, '.env')));
  assert.deepStrictEqual(t.plan().actions, []);
});

test('template-only change is applied; user-only change is kept', () => {
  const t = setup();
  fs.appendFileSync(t.tpl(TPL_SKILL), '\nnew logic\n');
  fs.appendFileSync(t.file('CLAUDE.md'), '\nmy rule\n');
  const p = t.plan();
  assert.deepStrictEqual(t.kinds(p), { [SKILL]: 'update' });
  applyUpdate(t.ws, 'mssql', p);
  assert.match(fs.readFileSync(t.file(SKILL), 'utf8'), /new logic/);
  assert.match(fs.readFileSync(t.file('CLAUDE.md'), 'utf8'), /my rule/);
  assert.deepStrictEqual(t.plan().actions, []);
});

test('both changed different lines: clean merge keeps both', () => {
  const t = setup();
  fs.writeFileSync(path.join(t.ws, BASE_DIR, SKILL), lines(20));
  fs.writeFileSync(t.tpl(TPL_SKILL), lines(20, { 2: 'ours' }));
  fs.writeFileSync(t.file(SKILL), lines(20, { 15: 'theirs' }));
  const p = t.plan();
  assert.deepStrictEqual(t.kinds(p), { [SKILL]: 'merge' });
  const backup = applyUpdate(t.ws, 'mssql', p);
  const text = fs.readFileSync(t.file(SKILL), 'utf8');
  assert.match(text, /ours/);
  assert.match(text, /theirs/);
  assert.strictEqual(fs.readFileSync(path.join(backup, SKILL), 'utf8'), lines(20, { 15: 'theirs' }));
});

test('both changed the same line: conflict markers', () => {
  const t = setup();
  fs.writeFileSync(path.join(t.ws, BASE_DIR, SKILL), lines(5));
  fs.writeFileSync(t.tpl(TPL_SKILL), lines(5, { 2: 'ours' }));
  fs.writeFileSync(t.file(SKILL), lines(5, { 2: 'theirs' }));
  const p = t.plan();
  assert.deepStrictEqual(t.kinds(p), { [SKILL]: 'conflict' });
  applyUpdate(t.ws, 'mssql', p);
  const text = fs.readFileSync(t.file(SKILL), 'utf8');
  assert.match(text, /<<<<<<< your version/);
  assert.match(text, />>>>>>> new shadow-dba/);
});

test('without git, a two-sided change becomes a .new copy', () => {
  const t = setup();
  fs.appendFileSync(t.tpl(TPL_SKILL), '\nnew logic\n');
  fs.appendFileSync(t.file(SKILL), '\nmine\n');
  const p = t.plan({ git: false });
  assert.deepStrictEqual(t.kinds(p), { [SKILL]: 'new-file' });
  applyUpdate(t.ws, 'mssql', p);
  assert.match(fs.readFileSync(t.file(SKILL), 'utf8'), /mine/);
  assert.match(fs.readFileSync(t.file(SKILL + '.new'), 'utf8'), /new logic/);
});

test('added, removed, user-deleted and user-modified-removed files', () => {
  const t = setup();
  const added = 'claude/skills/new-skill/SKILL.md';
  fs.mkdirSync(path.dirname(t.tpl(added)), { recursive: true });
  fs.writeFileSync(t.tpl(added), 'brand new\n');
  fs.rmSync(t.tpl('claude/skills/backup-audit'), { recursive: true });
  fs.rmSync(t.tpl('claude/skills/schema-review'), { recursive: true });
  fs.appendFileSync(t.file('.claude/skills/schema-review/SKILL.md'), '\nmine\n');
  fs.rmSync(t.file('.claude/skills/performance-audit/SKILL.md'));
  fs.appendFileSync(t.tpl('claude/skills/performance-audit/SKILL.md'), '\nnew logic\n');

  const p = t.plan();
  assert.deepStrictEqual(t.kinds(p), {
    '.claude/skills/new-skill/SKILL.md': 'add',
    '.claude/skills/backup-audit/SKILL.md': 'delete',
    '.claude/skills/schema-review/SKILL.md': 'keep-modified',
    '.claude/skills/performance-audit/SKILL.md': 'skip-deleted',
  });
  applyUpdate(t.ws, 'mssql', p);
  assert.ok(fs.existsSync(t.file('.claude/skills/new-skill/SKILL.md')));
  assert.ok(!fs.existsSync(t.file('.claude/skills/backup-audit/SKILL.md')));
  assert.ok(fs.existsSync(t.file('.claude/skills/schema-review/SKILL.md')));
  assert.ok(!fs.existsSync(t.file('.claude/skills/performance-audit/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(t.ws, BASE_DIR, '.claude/skills/backup-audit/SKILL.md')));
});

test('workspace without a base: two-way fallback, then base is saved', () => {
  const t = setup();
  fs.rmSync(path.join(t.ws, '.shadow-dba'), { recursive: true });
  assert.strictEqual(findWorkspace(t.ws).hasBase, false);
  fs.appendFileSync(t.file('CLAUDE.md'), '\nmy rule\n');
  const p = t.plan();
  assert.deepStrictEqual(t.kinds(p), { 'CLAUDE.md': 'new-file' });
  applyUpdate(t.ws, 'mssql', p);
  assert.strictEqual(findWorkspace(t.ws).hasBase, true);
});

test('user files outside the template are never touched', () => {
  const t = setup();
  fs.writeFileSync(t.file('.env'), 'DB_PASSWORD=secret\n');
  fs.writeFileSync(t.file('.claude/skills/my-own.md'), 'custom\n');
  assert.deepStrictEqual(t.plan().actions, []);
});

test('merge3 reports conflict count', () => {
  assert.deepStrictEqual(merge3('a\nb\n', 'a\nb\n', 'a\nc\n'), { text: 'a\nc\n', conflicts: 0 });
  assert.strictEqual(merge3('a\nx\n', 'a\nb\n', 'a\nc\n').conflicts, 1);
});
