'use strict';

// Command grammar: `shadow-dba harness [update]` — the DBA workspace
// (a laptop: Mac, Windows, Linux). Aliases kept for the short forms: bare
// `shadow-dba` / `shadow-dba --name x` = `harness`, and `shadow-dba update`
// = `harness update`.

const HELP = `shadow-dba — a Claude Code DBA for SQL Server

Usage:
  npx shadow-dba harness [options]          create a DBA workspace folder
  npx shadow-dba harness update [options]   merge newer templates into a workspace

Short forms: \`shadow-dba\` = harness, \`shadow-dba update\` = harness update.
Run any command with --help for its options.
`;

const isHelp = (arg) => arg === '-h' || arg === '--help';
const isOption = (arg) => arg == null || arg.startsWith('-');

// Returns { cmd: 'init' | 'update' | 'help', args }.
function route(argv) {
  const [first, second] = argv;
  if (first === 'harness') {
    if (second === 'update') return { cmd: 'update', args: argv.slice(2) };
    if (isOption(second)) return { cmd: 'init', args: argv.slice(1) };
    throw new Error(`Unknown command: harness ${second}. Use "harness" or "harness update".`);
  }
  if (first === 'update') return { cmd: 'update', args: argv.slice(1) };
  if (first === 'help' || (argv.length === 1 && isHelp(first))) return { cmd: 'help', args: [] };
  if (isOption(first)) return { cmd: 'init', args: argv };
  throw new Error(`Unknown command: ${first}. Run "shadow-dba --help".`);
}

module.exports = { route, HELP };
