'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

function hasGit() {
  const r = spawnSync('git', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

// 3-way merge of text files via `git merge-file`. Returns the merged text and
// the number of conflict regions (0 = clean). Conflicts are left in the text as
// standard markers labelled with whose version each side is.
function merge3(user, base, next) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-dba-'));
  try {
    const [u, b, n] = ['user', 'base', 'next'].map((name, i) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, [user, base, next][i]);
      return file;
    });
    const r = spawnSync(
      'git',
      ['merge-file', '-p', '-L', 'your version', '-L', 'previous shadow-dba', '-L', 'new shadow-dba', u, b, n],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    // Exit status is the conflict count (capped at 127); higher means an error.
    if (r.error || r.status == null || r.status > 127) {
      throw new Error(`git merge-file failed: ${r.error ? r.error.message : r.stderr.trim()}`);
    }
    return { text: r.stdout, conflicts: r.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { hasGit, merge3 };
