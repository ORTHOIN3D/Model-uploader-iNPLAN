// Mandatory updates from the GitHub releases ("publish" in package.json).
// A published release is detected at startup and every CHECK_INTERVAL_MS,
// downloaded in the background, then the renderer blocks until it is installed.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { releaseNotesToText, describeUpdateError } = require('./update-messages');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/ORTHOIN3D/Model-uploader-iNPLAN/releases/latest';

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
