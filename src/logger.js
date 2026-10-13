// Logger shared by the main process and the uploader.
// Every entry is appended to a daily file (kept KEEP_DAYS days) and pushed to
// the listeners (the renderer console). Entry: { time, level, message, details, depth }
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 14;
const FILE_PREFIX = 'uploader-';
const LEVEL_LABELS = {
  debug: 'DEBUG',
  info: 'INFO',
  title: 'INFO',
  success: 'OK',
  warn: 'WARN',
  error: 'ERROR',
};
// "2026-10-09 10:36:17.123 ERROR " -> details are aligned under the message
const DETAILS_MARGIN = ' '.repeat(30);

let logDir = null;
const listeners = new Set();

function pad(n, size = 2) {
  return String(n).padStart(size, '0');
}

function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function init(dir) {
  logDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  pruneOldFiles();
}

function listLogFiles() {
  if (!logDir) return [];
  return fs.readdirSync(logDir)
    .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith('.log'))
    .sort()
    .map((name) => path.join(logDir, name));
}

function pruneOldFiles() {
  const limit = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  for (const file of listLogFiles()) {
    try {
      if (fs.statSync(file).mtimeMs < limit) fs.unlinkSync(file);
    } catch (e) {
      // ignore: a locked old log must not prevent the app from starting
    }
  }
}

function formatForFile(entry) {
  const d = new Date(entry.time);
  const label = (LEVEL_LABELS[entry.level] || entry.level.toUpperCase()).padEnd(5);
  const indent = '  '.repeat(entry.depth || 0);
  let text = `${localDate(d)} ${localTime(d)} ${label} ${indent}${entry.message}`;
  if (entry.details) {
    text += '\n' + entry.details.split('\n').map((line) => `${DETAILS_MARGIN}${indent}${line}`).join('\n');
  }
  return text + '\n';
}

function write(level, message, details, depth) {
  const entry = { time: new Date().toISOString(), level, message: String(message), depth };
  if (details) entry.details = String(details);
  if (logDir) {
    try {
      const file = path.join(logDir, `${FILE_PREFIX}${localDate(new Date())}.log`);
      fs.appendFileSync(file, formatForFile(entry), 'utf-8');
    } catch (e) {
      // never break an upload because the log file cannot be written
    }
  }
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch (e) {
      // ignore listener failures (window closed...)
    }
  }
  return entry;
}

// Logger bound to an indentation depth (patient > setup > file)
function create(depth = 0) {
  return {
    debug: (message, details) => write('debug', message, details, depth),
    info: (message, details) => write('info', message, details, depth),
    title: (message, details) => write('title', message, details, depth),
    success: (message, details) => write('success', message, details, depth),
    warn: (message, details) => write('warn', message, details, depth),
    error: (message, details) => write('error', message, details, depth),
    nested: () => create(depth + 1),
  };
}

function onEntry(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Write a single support file: header + every kept daily log
function exportTo(targetPath, headerLines) {
  const parts = [...headerLines, ''];
  for (const file of listLogFiles()) {
    parts.push(`===== ${path.basename(file)} =====`);
    parts.push(fs.readFileSync(file, 'utf-8'));
  }
  fs.writeFileSync(targetPath, parts.join('\n'), 'utf-8');
}

module.exports = {
  init,
  create,
  onEntry,
  exportTo,
  getDir: () => logDir,
};
