const $ = (id) => document.getElementById(id);

const rootDirEl = $('rootDir');
const usernameEl = $('username');
const passwordEl = $('password');
const baseUrlEl = $('baseUrl');
const renameAfterEl = $('renameAfter');
const rememberPasswordEl = $('rememberPassword');
const verboseLogEl = $('verboseLog');
const startBtn = $('start');
const logEl = $('log');
const uploadSummaryEl = $('uploadSummary');
const loadingBar = $('loadingBar');
const statusMessage = $('statusMessage');
const updateModal = $('updateModal');
const updateBadge = $('updateBadge');

const DEFAULT_PROD_URL = 'https://api.orthoin3d.com';
const MAX_LOG_LINES = 5000;
const LEVEL_ICONS = { debug: '·', info: '›', title: '▸', success: '✓', warn: '⚠', error: '✗' };
const UPDATE_BLOCKING_STATES = ['downloading', 'downloaded', 'error'];

let isUploading = false;
let updateState = { status: 'idle' };
const counts = { error: 0, warn: 0 };

// Journal -------------------------------------------------------------------

function plural(n, word) {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

function renderCounters() {
  $('errorCount').textContent = counts.error ? plural(counts.error, 'erreur') : '';
  $('warnCount').textContent = counts.warn ? plural(counts.warn, 'avertissement') : '';
}

function appendLog(entry) {
  const depth = entry.depth || 0;
  const line = document.createElement('div');
  line.className = `log-line level-${entry.level}`;
  line.dataset.depth = String(depth);
  line.style.setProperty('--depth', depth);

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = `[${new Date(entry.time).toLocaleTimeString('fr-FR')}]`;
  const icon = document.createElement('span');
  icon.className = 'log-icon';
  icon.textContent = LEVEL_ICONS[entry.level] || '›';
  const message = document.createElement('span');
  message.className = 'log-msg';
  message.textContent = entry.message;
  line.append(time, icon, message);

  if (entry.details) {
    const details = document.createElement('div');
    details.className = 'log-details';
    details.textContent = entry.details;
    line.append(details);
  }

  const atBottom = Math.abs(logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight) < 8;
  logEl.append(line);
  while (logEl.childElementCount > MAX_LOG_LINES) logEl.firstElementChild.remove();
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;

  if (entry.level === 'error' || entry.level === 'warn') {
    counts[entry.level] += 1;
    renderCounters();
  }
}

// Messages produced by the window itself (form validation...)
function localLog(level, message) {
  appendLog({ time: new Date().toISOString(), level, message, depth: 0 });
}

function clearLog() {
  logEl.replaceChildren();
  counts.error = 0;
  counts.warn = 0;
  renderCounters();
}

window.inplan.onLog(appendLog);
$('clearLog').addEventListener('click', clearLog);
$('onlyProblems').addEventListener('change', (e) => logEl.classList.toggle('only-problems', e.target.checked));

// Settings ------------------------------------------------------------------

function selectedTheme() {
  return document.querySelector('input[name="theme"]:checked')?.value || 'system';
}

function collectConfig() {
  return {
    rootDir: rootDirEl.value.trim(),
    baseUrl: baseUrlEl.value.trim(),
    username: usernameEl.value.trim(),
    password: passwordEl.value,
    rememberPassword: rememberPasswordEl.checked,
    renameAfter: renameAfterEl.checked,
    theme: selectedTheme(),
    verboseLog: verboseLogEl.checked,
  };
}

let saveTimer = null;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.inplan.saveConfig(collectConfig()), 250);
}

async function loadConfig() {
  const config = await window.inplan.loadConfig();
  rootDirEl.value = config.rootDir || '';
  baseUrlEl.value = config.baseUrl || DEFAULT_PROD_URL;
  usernameEl.value = config.username || '';
  passwordEl.value = config.password || '';
  rememberPasswordEl.checked = config.rememberPassword !== false;
  renameAfterEl.checked = config.renameAfter !== false;
  verboseLogEl.checked = !!config.verboseLog;
  logEl.classList.toggle('show-debug', verboseLogEl.checked);
  const theme = document.querySelector(`input[name="theme"][value="${config.theme || 'system'}"]`);
  if (theme) theme.checked = true;
}

for (const el of [rootDirEl, baseUrlEl, usernameEl, passwordEl]) {
  el.addEventListener('input', saveConfig);
  el.addEventListener('change', saveConfig);
}
for (const el of [renameAfterEl, rememberPasswordEl]) {
  el.addEventListener('change', saveConfig);
}
verboseLogEl.addEventListener('change', () => {
  logEl.classList.toggle('show-debug', verboseLogEl.checked);
  saveConfig();
});
for (const radio of document.querySelectorAll('input[name="theme"]')) {
  // Saving applies the theme immediately (main process sets nativeTheme)
  radio.addEventListener('change', () => window.inplan.saveConfig(collectConfig()));
}

$('setDefaultProd').addEventListener('click', () => {
  baseUrlEl.value = DEFAULT_PROD_URL;
  saveConfig();
});

$('chooseRoot').addEventListener('click', async () => {
  const dir = await window.inplan.chooseRoot();
  if (dir) {
    rootDirEl.value = dir;
    saveConfig();
  }
});

function setInlineStatus(el, ok, text) {
  el.className = `inline-status ${ok ? 'ok' : 'ko'}`;
  el.textContent = text;
}

$('testConnection').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  const result = $('testResult');
  const { baseUrl, username, password } = collectConfig();
  if (!username || !password) {
    setInlineStatus(result, false, "Renseignez d'abord le nom d'utilisateur et le mot de passe.");
    return;
  }
  button.disabled = true;
  result.className = 'inline-status';
  result.textContent = 'Connexion…';
  const res = await window.inplan.testConnection({ baseUrl: baseUrl || DEFAULT_PROD_URL, username, password });
  button.disabled = false;
  setInlineStatus(result, res.ok, res.ok ? '✓ Connexion réussie' : `✗ ${res.error}`);
});

$('exportLogs').addEventListener('click', async () => {
  const res = await window.inplan.exportLogs();
  if (res.canceled) return;
  setInlineStatus($('exportResult'), res.ok, res.ok
    ? `✓ Fichier enregistré : ${res.filePath}`
    : `✗ Enregistrement impossible : ${res.error}`);
});
$('contactSupport').addEventListener('click', () => window.inplan.contactSupport());
$('openLogsFolder').addEventListener('click', () => window.inplan.openLogsFolder());

// Modals --------------------------------------------------------------------

function openModal(id) {
  $(id).classList.add('active');
}

function closeModal(id) {
  $(id).classList.remove('active');
}

$('settingsBtn').addEventListener('click', () => openModal('settingsModal'));
$('helpBtn').addEventListener('click', () => openModal('helpModal'));
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => closeModal(button.dataset.close));
}
for (const modal of document.querySelectorAll('.modal:not(.blocking)')) {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal(modal.id);
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal('settingsModal');
    closeModal('helpModal');
  }
});

// Upload --------------------------------------------------------------------

function setUploading(state) {
  isUploading = state;
  startBtn.disabled = state;
  loadingBar.classList.toggle('active', state);
  if (state) {
    statusMessage.className = 'status-message';
    statusMessage.textContent = '';
  }
}

function showStatus(kind, message) {
  statusMessage.className = `status-message active ${kind}`;
  statusMessage.textContent = message;
}

function addStat(list, label, value, className) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = String(value);
  if (className) dd.className = className;
  list.append(dt, dd);
}

function renderSummary(stats) {
  const title = document.createElement('h3');
  title.textContent = 'Dernier envoi';
  if (!stats) {
    uploadSummaryEl.replaceChildren(title);
    return;
  }
  const list = document.createElement('dl');
  list.className = 'stats';
  addStat(list, 'Patients traités', stats.patients);
  addStat(list, 'Nouveaux patients', stats.newPatients.length);
  if (stats.patientsToCheck.length > 0) addStat(list, 'Patients à vérifier', stats.patientsToCheck.length, 'stat-warn');
  addStat(list, 'Setups créés', stats.setupsCreated);
  addStat(list, 'Setups existants', stats.setupsReused);
  addStat(list, 'Modèles chargés', stats.models);
  addStat(list, 'Lignes de découpe', stats.cutlines);
  addStat(list, 'Erreurs', stats.errors, stats.errors ? 'stat-error' : 'stat-ok');
  const children = [title, list];

  if (stats.patientsToCheck.length > 0) {
    const subtitle = document.createElement('h4');
    subtitle.textContent = 'À compléter avec une date de naissance';
    const items = document.createElement('ul');
    for (const folder of stats.patientsToCheck) {
      const item = document.createElement('li');
      item.textContent = folder;
      items.append(item);
    }
    children.push(subtitle, items);
  }

  if (stats.newPatients.length > 0) {
    const subtitle = document.createElement('h4');
    subtitle.textContent = 'Nouveaux patients';
    const items = document.createElement('ul');
    for (const patient of stats.newPatients) {
      const item = document.createElement('li');
      item.textContent = `${patient.name} (${plural(patient.models || 0, 'modèle')})`;
      items.append(item);
    }
    children.push(subtitle, items);
  }
  uploadSummaryEl.replaceChildren(...children);
}

startBtn.addEventListener('click', async () => {
  if (isUploading || updateModal.classList.contains('active')) return;
  const { rootDir, baseUrl, username, password, renameAfter } = collectConfig();
  if (!rootDir) return localLog('warn', 'Veuillez choisir le dossier racine des patients.');
  if (!username || !password) return localLog('warn', "Veuillez saisir le nom d'utilisateur et le mot de passe.");

  clearLog();
  setUploading(true);
  let res;
  try {
    res = await window.inplan.startUpload({
      rootDir,
      baseUrl: baseUrl || DEFAULT_PROD_URL,
      username,
      password,
      renameAfterUpload: renameAfter,
    });
  } catch (error) {
    res = { ok: false, error: error?.message || 'Erreur inconnue' };
  }
  setUploading(false);
  if (res.stats) renderSummary(res.stats);

  const toCheck = res.stats?.patientsToCheck?.length || 0;
  const toCheckText = `${plural(toCheck, 'patient')} à compléter avec une date de naissance`;
  if (!res.ok) {
    showStatus('error', `Upload interrompu : ${res.error}`);
  } else if (res.stats.errors > 0) {
    showStatus('warning', `Upload terminé avec ${plural(res.stats.errors, 'erreur')}${toCheck ? ` et ${toCheckText}` : ''} : voir le journal`);
  } else if (toCheck > 0) {
    showStatus('warning', `Upload terminé : ${toCheckText} (voir le journal)`);
  } else {
    showStatus('success', 'Upload terminé sans erreur');
  }
  // An update found during the upload is shown once it is over
  applyUpdateState(updateState);
});

// Updates -------------------------------------------------------------------

function updateStatusText(state) {
  switch (state.status) {
    case 'disabled': return 'Mises à jour automatiques désactivées (version de développement).';
    case 'idle':
    case 'checking': return 'Recherche de mises à jour…';
    case 'up-to-date': return `Vous utilisez la dernière version (v${state.currentVersion}).`;
    case 'downloading': return `Version ${state.version} en cours de téléchargement (${state.percent || 0} %).`;
    case 'downloaded': return `Version ${state.version} prête à être installée.`;
    case 'error': return `Échec du téléchargement de la version ${state.version} : ${state.message}`;
    case 'check-failed': return `Impossible de vérifier les mises à jour : ${state.message}`;
    default: return '';
  }
}

function renderUpdateModal(state) {
  $('updateVersion').textContent = state.version || '';
  const notes = $('updateNotes');
  notes.textContent = state.releaseNotes || '';
  notes.classList.toggle('hidden', !state.releaseNotes);
  $('updateProgress').style.width = `${state.status === 'downloaded' ? 100 : state.percent || 0}%`;
  document.querySelector('#updateModal .progress').classList.toggle('failed', state.status === 'error');

  const progressText = $('updateProgressText');
  if (state.status === 'downloading') {
    progressText.textContent = `Téléchargement en cours… ${state.percent || 0} %`;
  } else if (state.status === 'downloaded') {
    progressText.textContent = "Téléchargement terminé. L'application va redémarrer après l'installation.";
  } else {
    progressText.textContent = `Le téléchargement a échoué : ${state.message}. Vérifiez la connexion internet puis réessayez.`;
  }
  $('updateInstall').disabled = state.status !== 'downloaded';
  $('updateRetry').classList.toggle('hidden', state.status !== 'error');
}

function applyUpdateState(state) {
  updateState = state;
  $('updateStatusText').textContent = updateStatusText(state);
  $('checkUpdates').disabled = state.status === 'disabled' || state.status === 'checking' || state.status === 'downloading';

  const blocking = UPDATE_BLOCKING_STATES.includes(state.status);
  updateBadge.classList.toggle('hidden', !blocking);
  if (!blocking) {
    updateModal.classList.remove('active');
    return;
  }
  updateBadge.textContent = `Mise à jour ${state.version} ${isUploading ? 'en attente' : 'requise'}`;
  renderUpdateModal(state);
  // Never interrupt a running upload: the modal opens when it is over
  if (!isUploading) {
    closeModal('settingsModal');
    closeModal('helpModal');
    updateModal.classList.add('active');
  }
}

window.inplan.onUpdateState(applyUpdateState);
updateBadge.addEventListener('click', () => {
  if (!isUploading) updateModal.classList.add('active');
});
$('checkUpdates').addEventListener('click', () => window.inplan.checkForUpdates());
$('updateRetry').addEventListener('click', () => window.inplan.checkForUpdates());
$('updateManual').addEventListener('click', () => window.inplan.openReleasesPage());
$('updateInstall').addEventListener('click', (e) => {
  e.currentTarget.disabled = true;
  $('updateProgressText').textContent = 'Installation en cours…';
  window.inplan.installUpdate();
});

// Startup -------------------------------------------------------------------

(async () => {
  renderCounters();
  await loadConfig();
  const info = await window.inplan.getAppInfo();
  $('appVersion').textContent = `v${info.version}`;
  $('supportEmail').textContent = info.supportEmail;
  applyUpdateState(await window.inplan.getUpdateState());
})();
