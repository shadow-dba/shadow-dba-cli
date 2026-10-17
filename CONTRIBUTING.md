# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/shadow-dba/shadow-dba-cli.git
cd shadow-dba-cli
npm test
node bin/cli.js workspace init --name try-it --no-open
```

No dependencies and no build step. Node.js 20 or newer.

## Where things live

- `bin/cli.js`, `src/`: the CLI (command routing, copy, update/merge).
- `templates/mssql/`: the workspace users get. Skills, the subagent, `CLAUDE.md`, `DOCS.html`.
  Most product changes happen here, not in the CLI.

## Rules for templates

- Skills stay read-only. They return scripts for the DBA to run; they never change a server.
- Examples use only the public StackOverflow database (`dbo.Posts`, `dbo.Users`, `dbo.Votes`, ...).
  Never paste names, numbers, or plans from a real company's server.

## Pull requests

- One topic per pull request. Add or update a test in `test/` when you change CLI behavior.
- `npm test` must pass.

Security problems: do not open a public issue. See [SECURITY.md](SECURITY.md).
