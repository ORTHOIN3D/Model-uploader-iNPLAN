// Mandatory updates from the GitHub releases ("publish" in package.json).
// A published release is detected at startup and every CHECK_INTERVAL_MS,
// downloaded in the background, then the renderer blocks until it is installed.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/ORTHOIN3D/Model-uploader-iNPLAN/releases/latest';

// GitHub release notes come as HTML
function releaseNotesToText(notes) {
  if (!notes) return '';
  const html = Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : String(notes);
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Short explanation for the settings panel (the full error goes to the log file)
function describeUpdateError(err) {
  const text = String(err?.message || err);
  if (/\b404\b/.test(text)) return 'source des mises à jour introuvable (dépôt GitHub privé ou inexistant)';
  if (/No published versions/i.test(text)) return 'aucune version publiée pour le moment';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i.test(text)) {
    return 'pas de connexion à internet ou GitHub injoignable';
  }
  return text.split('\n')[0];
}

function initUpdater({ log, onState }) {
  let state = { status: 'idle' };
  const setState = (next) => {
    state = { ...next, currentVersion: app.getVersion() };
    onState(state);
  };

  if (!app.isPackaged) {
    setState({ status: 'disabled' });
    log.debug('Mises à jour automatiques désactivées en mode développement');
    return { check() {}, install() {}, getState: () => state };
  }

  const updaterLog = (message) => log.debug(`[mise à jour] ${message}`);
  autoUpdater.logger = { info: updaterLog, warn: updaterLog, error: updaterLog, debug: updaterLog };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let pendingVersion = null;

  autoUpdater.on('checking-for-update', () => {
    // A download in progress stays visible during periodic checks
    if (!pendingVersion) setState({ status: 'checking' });
  });
  autoUpdater.on('update-not-available', () => {
    setState({ status: 'up-to-date' });
  });
  autoUpdater.on('update-available', (info) => {
    if (pendingVersion !== info.version) {
      log.info(`Mise à jour ${info.version} disponible : téléchargement en cours`);
    }
    pendingVersion = info.version;
    setState({
      status: 'downloading',
      version: info.version,
      percent: 0,
      releaseNotes: releaseNotesToText(info.releaseNotes),
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    setState({ ...state, status: 'downloading', percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Mise à jour ${info.version} téléchargée : prête à être installée`);
    setState({ ...state, status: 'downloaded', version: info.version, percent: 100 });
  });
  autoUpdater.on('error', (err) => {
    const message = describeUpdateError(err);
    if (pendingVersion) {
      log.error(`Téléchargement de la mise à jour ${pendingVersion} impossible : ${message}`, err?.stack || String(err));
      setState({ ...state, status: 'error', version: pendingVersion, message });
    } else {
      // Offline or GitHub unreachable: never block the app for that
      log.debug(`Vérification des mises à jour impossible : ${message}`);
      setState({ status: 'check-failed', message });
    }
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch(() => {
      // already reported by the "error" event
    });
  };
  setInterval(check, CHECK_INTERVAL_MS);

  return {
    check,
    install: () => {
      log.info('Installation de la mise à jour et redémarrage');
      // silent install, then relaunch the app
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
    },
    getState: () => state,
  };
}

module.exports = { initUpdater, RELEASES_URL };
