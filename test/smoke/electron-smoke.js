// Smoke test of the real application (main process + preload + window).
// Needs Electron, so it runs with "npm run test:smoke", not with "npm test".
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TIMEOUT_MS = 60 * 1000;
const failures = [];
const rendererErrors = [];

// Settings as saved by v0.1.0 (password in clear text): they must be kept and migrated
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'inplan-uploader-smoke-'));
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
  rootDir: 'C:\\Patients',
  baseUrl: 'https://api.orthoin3d.com',
  username: 'demo',
  password: 'mot-de-passe-test',
  renameAfter: false,
}));

require('../../src/main');
app.setPath('userData', userData);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(label, condition) {
  if (!condition) failures.push(label);
}

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  for (const error of rendererErrors) failures.push(`erreur dans la fenêtre : ${error}`);
  if (failures.length > 0) {
    console.error(`Smoke test : ${failures.length} échec(s)`);
    for (const failure of failures) console.error(`  - ${failure}`);
  } else {
    console.log('Smoke test : OK');
  }
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch (e) {
    // Chromium still holds some files of the temporary profile: leave it to the OS
  }
  app.exit(failures.length > 0 ? 1 : 0);
}

setTimeout(() => {
  failures.push(`délai de ${TIMEOUT_MS / 1000} s dépassé`);
  finish();
}, TIMEOUT_MS);

app.on('browser-window-created', (_event, win) => {
  const contents = win.webContents;
  contents.on('console-message', (event, legacyLevel, legacyMessage) => {
    const level = event?.level ?? legacyLevel;
    if (level === 'error' || level === 3) rendererErrors.push(event?.message ?? legacyMessage);
  });
  contents.on('render-process-gone', (_e, details) => {
    failures.push(`fenêtre plantée : ${details.reason}`);
    finish();
  });

  contents.once('did-finish-load', async () => {
    try {
      await wait(1000);
      const js = (code) => contents.executeJavaScript(code);

      const page = await js(`({
        bridge: typeof window.inplan,
        version: document.getElementById('appVersion').textContent,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        renameAfter: document.getElementById('renameAfter').checked,
        baseUrl: document.getElementById('baseUrl').value,
        pageScrolls: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
      })`);
      check('pont IPC exposé à la fenêtre', page.bridge === 'object');
      check(`version affichée (« ${page.version} »)`, /^v\d+\.\d+\.\d+/.test(page.version));
      check('réglages de la v0.1.0 repris', page.username === 'demo'
        && page.password === 'mot-de-passe-test'
        && page.renameAfter === false
        && page.baseUrl === 'https://api.orthoin3d.com');
      check('la fenêtre elle-même ne défile pas', !page.pageScrolls);

      const saved = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf-8'));
      check('mot de passe en clair retiré de la config', saved.password === undefined);
      check('mot de passe enregistré chiffré', typeof saved.passwordEncrypted === 'string'
        && !saved.passwordEncrypted.includes('mot-de-passe-test'));

      // Journal: colored lines, details and counters
      const time = new Date().toISOString();
      contents.send('log:entry', { time, level: 'error', message: 'erreur de test', details: 'détail', depth: 1 });
      contents.send('log:entry', { time, level: 'warn', message: 'avertissement de test', depth: 0 });
      await wait(300);
      const journal = await js(`({
        errors: document.getElementById('errorCount').textContent,
        warnings: document.getElementById('warnCount').textContent,
        details: document.querySelector('#log .level-error .log-details')?.textContent,
      })`);
      check(`compteur d'erreurs (« ${journal.errors} »)`, journal.errors === '1 erreur');
      check(`compteur d'avertissements (« ${journal.warnings} »)`, journal.warnings === '1 avertissement');
      check("détails de l'erreur affichés", journal.details === 'détail');

      // Mandatory update: blocking window, install button once downloaded
      contents.send('update:state', { status: 'downloaded', version: '9.9.9', currentVersion: '0.0.0', percent: 100 });
      await wait(300);
      const update = await js(`({
        open: document.getElementById('updateModal').classList.contains('active'),
        install: !document.getElementById('updateInstall').disabled,
      })`);
      check('fenêtre de mise à jour obligatoire affichée', update.open);
      check("bouton d'installation actif", update.install);
      contents.send('update:state', { status: 'up-to-date', currentVersion: '0.0.0' });
      await wait(300);
      check('fenêtre de mise à jour fermée une fois à jour',
        !(await js("document.getElementById('updateModal').classList.contains('active')")));
    } catch (error) {
      failures.push(error.stack || String(error));
    }
    finish();
  });
});
