const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, safeStorage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('./logger');
const { runUpload, testConnection } = require('./uploader');
const { initUpdater, RELEASES_URL } = require('./updater');

const APP_ID = 'com.inplan.modeluploader';
const SUPPORT_EMAIL = 'support@orthoin3d.com';
const THEMES = ['system', 'light', 'dark'];

// Development runs must not touch the installed app's settings and logs
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'inplan-model-uploader-dev'));
}

logger.init(path.join(app.getPath('userData'), 'logs'));
const log = logger.create();

let mainWindow = null;
let updater = null;
let isUploading = false;

process.on('uncaughtException', (err) => log.error('Erreur interne inattendue', err?.stack || String(err)));
process.on('unhandledRejection', (reason) => log.error('Erreur interne inattendue', reason?.stack || String(reason)));

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

logger.onEntry((entry) => send('log:entry', entry));

function systemInfo() {
  return [
    `Version de l'application : ${app.getVersion()}`,
    `Electron ${process.versions.electron} - Chrome ${process.versions.chrome} - Node ${process.versions.node}`,
    `Système : ${os.type()} ${os.release()} (${os.arch()})`,
  ];
}

// Configuration file ------------------------------------------------------

const getConfigPath = () => path.join(app.getPath('userData'), 'config.json');

function readConfigFile() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    log.warn('Configuration illisible : valeurs par défaut utilisées', e.message);
  }
  return {};
}

function writeConfigFile(config) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    log.error("Impossible d'enregistrer la configuration", e.message);
    return false;
  }
}

// The password is encrypted with the Windows user account (DPAPI)
function encryptPassword(password) {
  if (!password || !safeStorage.isEncryptionAvailable()) return undefined;
  return safeStorage.encryptString(password).toString('base64');
}

function decryptPassword(encrypted) {
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch (e) {
    log.warn('Mot de passe enregistré illisible : merci de le ressaisir');
    return '';
  }
}

function loadConfig() {
  const stored = readConfigFile();
  // v0.1.0 stored the password in clear text: encrypt it once
  if (stored.password !== undefined) {
    stored.passwordEncrypted = encryptPassword(stored.password);
    delete stored.password;
    writeConfigFile(stored);
    log.info('Mot de passe enregistré désormais chiffré');
  }
  return {
    rootDir: stored.rootDir || '',
    baseUrl: stored.baseUrl || '',
    username: stored.username || '',
    password: decryptPassword(stored.passwordEncrypted),
    rememberPassword: stored.rememberPassword !== false,
    renameAfter: stored.renameAfter !== false,
    theme: THEMES.includes(stored.theme) ? stored.theme : 'system',
    verboseLog: !!stored.verboseLog,
  };
}

function saveConfig(config) {
  const stored = {
    rootDir: config.rootDir || '',
    baseUrl: config.baseUrl || '',
    username: config.username || '',
    rememberPassword: config.rememberPassword !== false,
    renameAfter: config.renameAfter !== false,
    theme: THEMES.includes(config.theme) ? config.theme : 'system',
    verboseLog: !!config.verboseLog,
  };
  if (stored.rememberPassword) stored.passwordEncrypted = encryptPassword(config.password);
  nativeTheme.themeSource = stored.theme;
  return writeConfigFile(stored);
}

// Window ------------------------------------------------------------------

function createWindow() {
  // Large by default, but never bigger than the screen (taskbar excluded)
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1400, workArea.width),
    height: Math.min(960, workArea.height),
    minWidth: 900,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1120' : '#f3f5f9',
    title: 'iNPLAN Model uploader',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The page never navigates nor opens windows: external links go through shell
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('did-finish-load', () => updater.check());

  mainWindow.on('close', (event) => {
    if (!isUploading) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ["Continuer l'upload", 'Quitter quand même'],
      defaultId: 0,
      cancelId: 0,
      title: 'Upload en cours',
      message: 'Un upload est en cours.',
      detail: 'Si vous quittez maintenant, les fichiers restants ne seront pas envoyés.',
    });
    if (choice === 0) event.preventDefault();
    else log.warn("Application fermée pendant l'upload");
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    Menu.setApplicationMenu(null);
    nativeTheme.themeSource = loadConfig().theme;
    log.info(`Démarrage de iNPLAN Model uploader v${app.getVersion()}`, systemInfo().join('\n'));
    updater = initUpdater({ log, onState: (state) => send('update:state', state) });
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}

// IPC handlers ------------------------------------------------------------

function fileStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

ipcMain.handle('app:getInfo', () => ({
  version: app.getVersion(),
  isPackaged: app.isPackaged,
  supportEmail: SUPPORT_EMAIL,
}));

ipcMain.handle('dialog:chooseRoot', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths?.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('config:load', () => loadConfig());

ipcMain.handle('config:save', (_event, config) => saveConfig(config));

ipcMain.handle('upload:start', async (_event, payload) => {
  if (isUploading) return { ok: false, error: 'Un upload est déjà en cours' };
  const { rootDir, baseUrl, username, password, renameAfterUpload } = payload;
  isUploading = true;
  log.title("Démarrage de l'upload");
  try {
    return await runUpload({
      rootDir,
      baseUrl,
      credentials: { username, password },
      renameAfterUpload,
      log,
    });
  } catch (e) {
    log.error("Erreur interne pendant l'upload", e?.stack || String(e));
    return { ok: false, error: e?.message || String(e) };
  } finally {
    isUploading = false;
  }
});

ipcMain.handle('upload:testConnection', (_event, { baseUrl, username, password }) => (
  testConnection({ baseUrl, credentials: { username, password }, log })
));

ipcMain.handle('logs:export', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Enregistrer le fichier de logs',
    defaultPath: path.join(app.getPath('downloads'), `inplan-model-uploader-logs-${fileStamp()}.txt`),
    filters: [{ name: 'Fichier texte', extensions: ['txt'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  const config = readConfigFile();
  try {
    logger.exportTo(res.filePath, [
      'iNPLAN Model uploader - fichier de logs pour le support',
      `Généré le : ${new Date().toLocaleString('fr-FR')}`,
      ...systemInfo(),
      `Serveur : ${config.baseUrl || '(par défaut)'}`,
      `Utilisateur : ${config.username || '(non renseigné)'}`,
      `Dossier racine : ${config.rootDir || '(non renseigné)'}`,
      `Renommage après envoi : ${config.renameAfter !== false ? 'oui' : 'non'}`,
    ]);
  } catch (e) {
    log.error("Impossible d'enregistrer le fichier de logs", e.message);
    return { ok: false, error: e.message };
  }
  log.info(`Fichier de logs enregistré : ${res.filePath}`);
  shell.showItemInFolder(res.filePath);
  return { ok: true, filePath: res.filePath };
});

ipcMain.handle('logs:openFolder', () => shell.openPath(logger.getDir()));

ipcMain.handle('support:contact', () => {
  const subject = encodeURIComponent(`[Model uploader v${app.getVersion()}] Problème rencontré`);
  const body = encodeURIComponent(
    'Bonjour,\n\nDécrivez ici le problème rencontré :\n\n\n'
    + 'Pensez à joindre le fichier de logs (Paramètres > Télécharger le fichier de logs).\n',
  );
  return shell.openExternal(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
});

ipcMain.handle('update:getState', () => updater.getState());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:install', () => updater.install());
ipcMain.handle('update:openReleases', () => shell.openExternal(RELEASES_URL));
