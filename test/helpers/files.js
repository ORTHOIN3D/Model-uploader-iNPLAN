const fs = require('fs');
const os = require('os');
const path = require('path');

// Creates a temporary folder tree. Paths ending with "/" are empty folders.
function makeTree(paths) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inplan-uploader-test-'));
  for (const relative of paths) {
    const full = path.join(root, relative);
    if (relative.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `contenu de ${relative}`);
    }
  }
  return root;
}

// Every file of the tree, as sorted "dir/sub/file" paths
function listFiles(root, dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(root, full) : [path.relative(root, full).split(path.sep).join('/')];
    })
    .sort();
}

function removeTree(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

// Logger with the uploader interface that keeps the entries for assertions
function captureLog() {
  const entries = [];
  const make = (depth) => ({
    ...Object.fromEntries(['debug', 'info', 'title', 'success', 'warn', 'error'].map((level) => [
      level,
      (message, details) => entries.push({ level, depth, message, details }),
    ])),
    nested: () => make(depth + 1),
  });
  return { log: make(0), entries };
}

module.exports = { makeTree, listFiles, removeTree, captureLog };
