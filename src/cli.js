'use strict';

// Command grammar: `shadow-dba <product> <verb>`.
//   workspace init | update   this package (a laptop: Mac, Windows, Linux)
//   app ...                   the server app; ships with its own installer later
// Aliases kept for the short forms: bare `shadow-dba` / `shadow-dba --name x`
// = `workspace init`, and `shadow-dba update` = `workspace update`.

const HELP = `shadow-dba — a Claude Code DBA for SQL Server

Usage:
  npx shadow-dba workspace init [options]     create a DBA workspace folder
  npx shadow-dba workspace update [options]   merge newer templates into a workspace
  npx shadow-dba app                          the shadow-dba server app (coming soon)

Short forms: \`shadow-dba\` = workspace init, \`shadow-dba update\` = workspace update.
Run any command with --help for its options.
`;

const APP_TEXT = `The app runs on a Linux server with Docker. Coming soon.
https://github.com/shadow-dba
`;

const isHelp = (arg) => arg === '-h' || arg === '--help';

// Returns { cmd: 'init' | 'update' | 'app' | 'help', args }.
function route(argv) {
  const [first, second] = argv;
  if (first === 'workspace') {
    if (second === 'init') return { cmd: 'init', args: argv.slice(2) };
    if (second === 'update') return { cmd: 'update', args: argv.slice(2) };
    if (second == null || isHelp(second)) return { cmd: 'help', args: [] };
    throw new Error(`Unknown command: workspace ${second}. Use "workspace init" or "workspace update".`);
  }
  if (first === 'app') return { cmd: 'app', args: argv.slice(1) };
  if (first === 'update') return { cmd: 'update', args: argv.slice(1) };
  if (first === 'help' || (argv.length === 1 && isHelp(first))) return { cmd: 'help', args: [] };
  return { cmd: 'init', args: argv };
}

module.exports = { route, HELP, APP_TEXT };
