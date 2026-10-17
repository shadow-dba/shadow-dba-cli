#!/usr/bin/env node
'use strict';

const { stdout, stdin, stderr } = require('node:process');
const { route, HELP, APP_TEXT } = require('../src/cli');
const { scaffold, parseArgs } = require('../src/scaffold');

// Restore the cursor if we bail out mid-animation (Ctrl-C, etc.).
function restoreCursor() {
  if (stdout.isTTY) stdout.write('\x1b[?25h');
}

async function init(argv) {
  const opts = parseArgs(argv);

  if (opts.help) {
    return scaffold(argv); // prints HELP, returns 0
  }

  // Cinematic path only for an interactive terminal with no explicit --name.
  // Pipes, CI, and `--name` fall through to the unchanged static scaffold.
  if (stdout.isTTY && stdin.isTTY && !opts.nameProvided) {
    process.on('SIGINT', () => {
      restoreCursor();
      stdout.write('\n');
      process.exit(130);
    });
    const { runInteractive } = require('../src/interactive');
    return runInteractive(opts);
  }

  return scaffold(argv);
}

async function main() {
  const { cmd, args } = route(process.argv.slice(2));
  switch (cmd) {
    case 'help':
      stdout.write(HELP);
      return 0;
    case 'app':
      stdout.write(APP_TEXT);
      return 0;
    case 'update':
      return require('../src/update').update(args);
    default:
      return init(args);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    restoreCursor();
    stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
