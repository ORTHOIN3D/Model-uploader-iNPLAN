const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../src/logger');

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inplan-uploader-logs-'));
test.after(() => fs.rmSync(logDir, { recursive: true, force: true }));

function todayLog() {
  const files = fs.readdirSync(logDir).filter((name) => name.endsWith('.log'));
  assert.equal(files.length, 1);
  return fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
}

test('supprime au démarrage les fichiers de logs de plus de 14 jours', () => {
  const old = path.join(logDir, 'uploader-2020-01-01.log');
  const recent = path.join(logDir, 'uploader-2099-01-01.log');
  fs.writeFileSync(old, 'ancien');
  fs.writeFileSync(recent, 'récent');
  const twentyDaysAgo = (Date.now() - 20 * 24 * 3600 * 1000) / 1000;
  fs.utimesSync(old, twentyDaysAgo, twentyDaysAgo);
  logger.init(logDir);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(recent));
  fs.unlinkSync(recent);
});

test('écrit chaque entrée dans le fichier du jour et la transmet à la fenêtre', () => {
  const received = [];
  const unsubscribe = logger.onEntry((entry) => received.push(entry));
  const log = logger.create();
  log.info('Démarrage');
  log.nested().error('Modèle X non chargé', 'ligne 1\nligne 2');
  unsubscribe();
  log.warn('après désabonnement');

  assert.deepEqual(received.map((e) => [e.level, e.depth, e.message]), [
    ['info', 0, 'Démarrage'],
    ['error', 1, 'Modèle X non chargé'],
  ]);
  const content = todayLog();
  assert.match(content, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} INFO  Démarrage$/m);
  assert.match(content, / ERROR   Modèle X non chargé$/m);
  // details are aligned under the message, with the same indentation
  assert.match(content, /^ {32}ligne 1$/m);
  assert.match(content, /^ {32}ligne 2$/m);
  assert.match(content, / WARN  après désabonnement$/m);
});

test('exporte un fichier pour le support avec l\'en-tête et tout le journal', () => {
  const target = path.join(logDir, 'export.txt');
  logger.exportTo(target, ['iNPLAN Model uploader - fichier de logs', 'Version : test']);
  const exported = fs.readFileSync(target, 'utf-8');
  assert.match(exported, /^iNPLAN Model uploader - fichier de logs\nVersion : test\n/);
  assert.match(exported, /===== uploader-\d{4}-\d\d-\d\d\.log =====/);
  assert.match(exported, /Modèle X non chargé/);
});
