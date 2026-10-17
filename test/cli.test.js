'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { route } = require('../src/cli');
const { parseArgs, writeWorkspace } = require('../src/scaffold');
const { findWorkspace } = require('../src/update');
const { STATE_FILE } = require('../src/manifest');

test('workspace init|update and the short aliases route to the same commands', () => {
  assert.deepStrictEqual(route(['workspace', 'init', '--name', 'x']), { cmd: 'init', args: ['--name', 'x'] });
  assert.deepStrictEqual(route(['--name', 'x']), { cmd: 'init', args: ['--name', 'x'] });
  assert.deepStrictEqual(route([]), { cmd: 'init', args: [] });
  assert.deepStrictEqual(route(['workspace', 'update', '-y']), { cmd: 'update', args: ['-y'] });
  assert.deepStrictEqual(route(['update', '-y']), { cmd: 'update', args: ['-y'] });
  assert.deepStrictEqual(route(['app', 'init']), { cmd: 'app', args: ['init'] });
  assert.strictEqual(route(['--help']).cmd, 'help');
  assert.strictEqual(route(['workspace']).cmd, 'help');
  assert.deepStrictEqual(route(['workspace', 'init', '--help']), { cmd: 'init', args: ['--help'] });
  assert.throws(() => route(['workspace', 'nope']), /Unknown command/);
});

test('--engine accepts mssql only for now', () => {
  assert.strictEqual(parseArgs([]).engine, 'mssql');
  assert.strictEqual(parseArgs([]).name, 'mssql-shadow-dba');
  assert.strictEqual(parseArgs(['--engine', 'mssql']).engine, 'mssql');
  assert.throws(() => parseArgs(['--engine', 'postgres']), /coming soon/);
  assert.throws(() => parseArgs(['--engine', 'oracle']), /Unknown engine/);
  assert.throws(() => parseArgs(['--engine']), /requires an engine/);
  assert.throws(() => parseArgs(['init']), /Unknown option/);
});

test('state.json records kind and engine; old provider files still load', () => {
  const ws = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-dba-cli-')), 'ws');
  writeWorkspace(ws, 'mssql');
  const stateFile = path.join(ws, STATE_FILE);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.strictEqual(state.kind, 'workspace');
  assert.strictEqual(state.engine, 'mssql');
  assert.strictEqual(state.provider, undefined);
  assert.strictEqual(findWorkspace(ws).engine, 'mssql');

  fs.writeFileSync(stateFile, JSON.stringify({ provider: 'mssql', version: '1.0.0' }));
  assert.strictEqual(findWorkspace(ws).engine, 'mssql');

  fs.writeFileSync(stateFile, JSON.stringify({ kind: 'app', engine: 'mssql', version: '0.1.0' }));
  assert.throws(() => findWorkspace(ws), /not a workspace/);
});
