const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const datePattern = /^\d{4}\-(0?[1-9]|1[012])\-(0?[1-9]|[12][0-9]|3[01])$/;
const taverniersUpperPattern = /^.*u\d+\....$/i;
const taverniersLowerPattern = /^.*l\d+\....$/i;
const mistralPattern = /^.*tape \d+ de \d+.*\....$/i;
const mainUpperPattern = /^.*_u\d+\.[^.]+$/i;
const mainLowerPattern = /^.*_l\d+\.[^.]+$/i;

const JSON_TIMEOUT_MS = 60 * 1000;
const UPLOAD_TIMEOUT_MS = 0; // big STL files on slow connections: no limit
// The server processes each model after its upload and answers 503 to the
// cutline import until it is done: cutlines are sent after ALL the models,
// after a first delay, then retried by rounds.
// (the tests pass shorter timings to runUpload)
const DEFAULT_CUTLINE_TIMINGS = {
  firstDelayMs: 30 * 1000,
  retryDelayMs: 20 * 1000,
  maxWaitMs: 15 * 60 * 1000,
};
const MAX_BODY_IN_LOG = 600;
const POSITION_LABELS = ['maxillaire', 'mandibulaire'];

const NETWORK_HINTS = {
  ENOTFOUND: "adresse du serveur introuvable (vérifiez l'URL dans les paramètres et la connexion internet)",
  EAI_AGAIN: 'résolution DNS impossible (vérifiez la connexion internet)',
  ECONNREFUSED: 'le serveur refuse la connexion (serveur arrêté ou mauvaise URL)',
  ECONNRESET: 'connexion interrompue par le serveur',
  ETIMEDOUT: 'délai de connexion dépassé',
  ECONNABORTED: 'délai de réponse dépassé',
  ERR_NETWORK: 'erreur réseau',
};

const noopLog = {
  debug() {}, info() {}, title() {}, success() {}, warn() {}, error() {},
  nested() { return noopLog; },
};

// Error that stops the whole run (server unreachable, credentials refused...)
class FatalUploadError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

function stripAccents(s) {
  return (s || '').normalize('NFD').replace(/\p{Mn}/gu, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seconds(ms) {
  return `${Math.ceil(ms / 1000)} s`;
}

// One-line, size-limited view of a server reply body for the logs
function summarizeBody(data) {
  if (data === undefined || data === null || data === '') return '';
  let text;
  try {
    text = typeof data === 'string' ? data : JSON.stringify(data);
  } catch (e) {
    text = String(data);
  }
  const title = /<title>([^<]*)<\/title>/i.exec(text);
  if (title) text = `(page HTML) ${title[1]}`;
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > MAX_BODY_IN_LOG ? `${text.slice(0, MAX_BODY_IN_LOG)}…` : text;
}

// Explanation for the user in the journal; the raw server reply goes to the
// technical details (log file, or journal when "détails techniques" is on)
function logFailure(log, message, hint, reply) {
  log.error(message, hint || reply.describe());
  if (hint) log.debug(reply.describe());
}

function createClient({ baseUrl, credentials, log }) {
  let headers = {};

  async function send(method, urlPath, { data, makeForm, params, timeout = JSON_TIMEOUT_MS } = {}) {
    const form = makeForm ? makeForm() : null;
    const started = Date.now();
    let reply;
    try {
      reply = await axios.request({
        method,
        url: `${baseUrl}${urlPath}`,
        params,
        data: form || data,
        headers: form ? { ...headers, ...form.getHeaders() } : headers,
        timeout,
        validateStatus: () => true,
      });
    } catch (err) {
      const hint = NETWORK_HINTS[err.code] || err.message;
      throw new FatalUploadError(
        `Serveur injoignable : ${hint}.`,
        `${method.toUpperCase()} ${baseUrl}${urlPath}\n${[err.code, err.message].filter(Boolean).join(' - ')}`,
      );
    }
    log.debug(`${method.toUpperCase()} ${urlPath} → HTTP ${reply.status} (${Date.now() - started} ms)`);
    reply.describe = () => {
      const body = summarizeBody(reply.data);
      return `${method.toUpperCase()} ${urlPath} → HTTP ${reply.status}${body ? `\nRéponse du serveur : ${body}` : ''}`;
    };
    return reply;
  }

  async function login() {
    headers = {};
    const reply = await send('post', '/api/1/token/', { data: credentials });
    if (reply.status === 200 && reply.data?.access) {
      headers = { Authorization: `Bearer ${reply.data.access}` };
      return;
    }
    if (reply.status === 400 || reply.status === 401) {
      throw new FatalUploadError("Connexion refusée : nom d'utilisateur ou mot de passe incorrect.", reply.describe());
    }
    throw new FatalUploadError(`Connexion au serveur impossible (HTTP ${reply.status}).`, reply.describe());
  }

  // Access tokens only live 10 minutes: log in again once on 401
  async function request(method, urlPath, options) {
    const reply = await send(method, urlPath, options);
    if (reply.status !== 401) return reply;
    log.debug('Session expirée : reconnexion au serveur');
    await login();
    return send(method, urlPath, options);
  }

  return { login, request };
}

// Patients ------------------------------------------------------------------

async function getOrCreatePatient({ run, firstName, lastName, birthDate, log }) {
  const fullName = `${firstName} ${lastName}`;
  const reply = await run.client.request('post', '/api/1/patients/get_or_create', {
    data: { first_name: firstName, last_name: lastName, birth_date: birthDate },
  });
  if (reply.status === 201 && reply.data?.id) {
    log.success(`Nouveau patient créé dans InPlan : ${fullName}`);
    return { id: reply.data.id, created: true };
  }
  if (reply.status === 200 && reply.data?.id) {
    log.info(`Patient existant retrouvé : ${fullName}`);
    return { id: reply.data.id, created: false };
  }
  // InPlan knows this name but cannot tell which patient it is without a birth date
  const homonyms = reply.status === 409 || /same (first and last )?name/i.test(summarizeBody(reply.data));
  if (homonyms) {
    const folder = `${lastName}_${firstName}`;
    log.warn(
      `Un patient ${fullName} existe déjà dans InPlan : ses fichiers n'ont pas été envoyés pour l'instant.`,
      [
        'Pour indiquer de quel patient il s\'agit, ajoutez sa date de naissance à la fin du nom du dossier, puis relancez l\'upload :',
        `   ${folder}  →  ${folder}_AAAA-MM-JJ   (par exemple ${folder}_2012-05-31)`,
        '• Même patient : utilisez la date de naissance de sa fiche InPlan (renseignez-la d\'abord dans InPlan si elle est vide).',
        '• Homonyme (une autre personne) : utilisez sa propre date de naissance, un nouveau patient sera créé.',
      ].join('\n'),
    );
    log.debug(reply.describe());
    return { toCheck: true };
  }
  logFailure(log, `Patient ${fullName} non traité : réponse inattendue du serveur.`, null, reply);
  return null;
}

// Setups --------------------------------------------------------------------

async function findExistingSetup({ client, setupName, patientId }) {
  let urlPath = '/api/1/setups';
  let params = { patient_id: patientId, name: setupName, page_size: 100 };
  while (urlPath) {
    const reply = await client.request('get', urlPath, { params });
    if (reply.status !== 200) return { id: null, reply };
    const content = reply.data;
    const setups = Array.isArray(content) ? content : (content?.results || []);
    const match = setups.find((setup) => setup.name === setupName);
    if (match) return { id: match.id };
    // Follow the pagination ("next" is absolute and already carries the filters)
    urlPath = null;
    if (!Array.isArray(content) && content?.next) {
      const next = new URL(content.next);
      urlPath = next.pathname + next.search;
      params = undefined;
    }
  }
  return { id: null };
}

async function getOrCreateSetup({ run, setupName, patientId, log }) {
  const { client, stats } = run;
  const reply = await client.request('post', '/api/1/setups', {
    data: { name: setupName, patient: patientId },
  });
  if (reply.status === 201 && reply.data?.id) {
    stats.setupsCreated += 1;
    log.success('Setup créé dans InPlan');
    return reply.data.id;
  }
  if (reply.status === 409) {
    const existing = await findExistingSetup({ client, setupName, patientId });
    if (existing.id) {
      stats.setupsReused += 1;
      log.info('Setup déjà présent dans InPlan : seuls les nouveaux fichiers y seront ajoutés');
      return existing.id;
    }
    stats.setupErrors += 1;
    logFailure(
      log,
      `Setup "${setupName}" introuvable alors que le serveur indique qu'il existe déjà.`,
      'Le patient est peut-être archivé dans InPlan.',
      existing.reply || reply,
    );
    return null;
  }
  stats.setupErrors += 1;
  logFailure(log, `Setup "${setupName}" non créé : réponse inattendue du serveur.`, null, reply);
  return null;
}

// Files ---------------------------------------------------------------------

function getPosition(fileName) {
  const normalized = stripAccents(fileName).toLowerCase();
  if (mainUpperPattern.test(normalized)) return 0;
  if (mainLowerPattern.test(normalized)) return 1;
  const isUpper = (
    normalized.includes('superieur') ||
    normalized.includes('maxil') ||
    normalized.includes('upper') ||
    taverniersUpperPattern.test(normalized)
  );
  const isLower = (
    normalized.includes('inferieur') ||
    normalized.includes('mand') ||
    normalized.includes('lower') ||
    taverniersLowerPattern.test(normalized)
  );
  if ((isUpper || isLower) && !(isUpper && isLower)) {
    return isLower ? 1 : 0;
  }
  return -1;
}

function getRankAndCategory(fileName) {
  const nums = fileName.match(/\d+/g) || [];
  let rank = 0;
  let isOriginal = false;
  let isTemplate = false;
  if (nums.length === 0) {
    isOriginal = true;
    rank = 0;
  } else if (mistralPattern.test(fileName)) {
    // second to last number
    rank = parseInt(nums[nums.length - 2], 10);
  } else {
    rank = parseInt(nums[nums.length - 1], 10);
  }
  return { rank, isOriginal, isTemplate };
}

function isNewModel(name) {
  return name.endsWith('.stl') && !name.startsWith('uploaded_') && !name.startsWith('compressed_');
}

function isNewCutline(name) {
  return name.endsWith('.pts') && !name.startsWith('uploaded_') && !name.startsWith('compressed_');
}

async function collectFiles(dirPath, predicate) {
  const found = [];
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      found.push(...await collectFiles(full, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

async function renameAfterUpload(filePath, log) {
  const target = path.join(path.dirname(filePath), `uploaded_${path.basename(filePath)}`);
  try {
    await fs.promises.rename(filePath, target);
  } catch (e) {
    log.warn(`Fichier envoyé mais non renommé : ${path.basename(filePath)}`, `Il sera renvoyé au prochain upload.\n${e.message}`);
  }
}

async function uploadOneModel({ run, filePath, patientId, setupId, log }) {
  const { client, stats } = run;
  const fileName = path.basename(filePath);
  const position = getPosition(fileName);
  if (position < 0) {
    stats.modelErrors += 1;
    log.error(
      `Modèle ${fileName} ignoré : impossible de déterminer maxillaire ou mandibulaire.`,
      'Renommez le fichier, par exemple Nom_U01.stl (maxillaire) ou Nom_L01.stl (mandibulaire).',
    );
    return;
  }
  const { rank, isOriginal, isTemplate } = getRankAndCategory(fileName);
  log.info(`Envoi du modèle ${fileName}…`);
  const reply = await client.request('post', '/api/1/models', {
    timeout: UPLOAD_TIMEOUT_MS,
    makeForm: () => {
      const form = new FormData();
      form.append('setup_rank', String(rank));
      form.append('type', String(position));
      form.append('setup_id', String(setupId));
      form.append('patient', String(patientId));
      form.append('is_original', String(!!isOriginal));
      form.append('is_template', String(!!isTemplate));
      form.append('file', fs.createReadStream(filePath));
      return form;
    },
  });
  if (reply.status === 201) {
    stats.models += 1;
    run.lastModelUploadAt = Date.now();
    log.success(`${fileName} chargé (${POSITION_LABELS[position]}, étape ${rank})`);
    if (run.renameAfter) await renameAfterUpload(filePath, log);
    return;
  }
  stats.modelErrors += 1;
  if (reply.status === 500) {
    logFailure(
      log,
      `Modèle ${fileName} non chargé : il existe probablement déjà dans InPlan.`,
      'Supprimez le modèle existant dans InPlan si vous voulez le remplacer.',
      reply,
    );
  } else if (reply.status === 413) {
    logFailure(log, `Modèle ${fileName} non chargé : fichier trop volumineux pour le serveur.`, null, reply);
  } else {
    logFailure(log, `Modèle ${fileName} non chargé (HTTP ${reply.status}).`, null, reply);
  }
}

// One import attempt: "ok", "not-ready" (model still processed) or "failed"
async function sendOneCutline({ run, item, log }) {
  const { client, stats } = run;
  const reply = await client.request('post', '/api/1/cutlines/existing_pts', {
    timeout: UPLOAD_TIMEOUT_MS,
    makeForm: () => {
      const form = new FormData();
      form.append('setup_id', String(item.setupId));
      form.append('file', fs.createReadStream(item.filePath));
      return form;
    },
  });
  if (reply.status === 201 || reply.status === 202) {
    stats.cutlines += 1;
    log.success(`${item.label} chargée`);
    if (run.renameAfter) await renameAfterUpload(item.filePath, log);
    return 'ok';
  }
  if (reply.status === 503) {
    log.debug(`${item.label} : modèle pas encore prêt`, reply.describe());
    return 'not-ready';
  }
  stats.cutlineErrors += 1;
  if (reply.status === 404) {
    // The server matches the .pts to the model with the same position and step
    const fileName = path.basename(item.filePath);
    const position = getPosition(fileName);
    const expected = position >= 0
      ? `modèle ${POSITION_LABELS[position]} de l'étape ${getRankAndCategory(fileName).rank}`
      : 'modèle correspondant';
    logFailure(
      log,
      `${item.label} non chargée : pas de ${expected} dans ce setup.`,
      'Chargez d\'abord le .stl de cette étape : il doit avoir le même nom que le .pts (ex. Nom_U01.stl → Nom_U01.pts).',
      reply,
    );
  } else if (reply.status === 403) {
    logFailure(
      log,
      `${item.label} non chargée : import des lignes de découpe refusé pour ce compte.`,
      "L'option lignes de découpe n'est peut-être pas activée pour le cabinet : contactez OrthoIN3D.",
      reply,
    );
  } else if (reply.status === 400) {
    logFailure(log, `${item.label} non chargée : fichier .pts refusé par le serveur.`, null, reply);
  } else {
    logFailure(log, `${item.label} non chargée (HTTP ${reply.status}).`, null, reply);
  }
  return 'failed';
}

// Cutlines are imported once every model of the run is uploaded, after a delay
// that lets the server process the models. Cutlines whose model is still being
// processed go back in the queue instead of blocking the others.
async function uploadCutlines({ run, log }) {
  const queue = run.cutlineQueue;
  if (queue.length === 0) return;
  log.title(`Lignes de découpe (${queue.length})`);
  const cutlineLog = log.nested();

  const { firstDelayMs, retryDelayMs, maxWaitMs } = run.cutlineTimings;
  const firstWait = run.lastModelUploadAt ? firstDelayMs - (Date.now() - run.lastModelUploadAt) : 0;
  if (firstWait > 0) {
    cutlineLog.info(`Attente de ${seconds(firstWait)} pour laisser le serveur traiter les modèles…`);
    await sleep(firstWait);
  }

  const deadline = Date.now() + maxWaitMs;
  let pending = queue;
  while (pending.length > 0) {
    const notReady = [];
    for (const item of pending) {
      if (await sendOneCutline({ run, item, log: cutlineLog }) === 'not-ready') notReady.push(item);
    }
    if (notReady.length === 0) return;

    if (Date.now() + retryDelayMs > deadline) {
      for (const item of notReady) {
        run.stats.cutlineErrors += 1;
        cutlineLog.error(
          `${item.label} non chargée : le modèle n'est toujours pas prêt sur le serveur.`,
          `Le serveur traite encore le modèle après ${Math.round(maxWaitMs / 60000)} minutes d'attente. Relancez l'upload plus tard.`,
        );
      }
      return;
    }
    cutlineLog.info(
      `${notReady.length} ligne(s) de découpe en attente : modèle pas encore prêt sur le serveur, nouvel essai dans ${seconds(retryDelayMs)}`,
    );
    await sleep(retryDelayMs);
    pending = notReady;
  }
}

// Folders -------------------------------------------------------------------

async function uploadSetup({ run, setupDir, patientFolder, patientId, log }) {
  const setupName = path.basename(setupDir);
  log.title(`Setup ${setupName}`);
  const fileLog = log.nested();
  const setupId = await getOrCreateSetup({ run, setupName, patientId, log: fileLog });
  if (!setupId) return;
  const models = await collectFiles(setupDir, isNewModel);
  const cutlines = await collectFiles(setupDir, isNewCutline);
  if (models.length === 0 && cutlines.length === 0) {
    fileLog.info('Aucun nouveau fichier à envoyer');
    return;
  }
  for (const filePath of models) {
    await uploadOneModel({ run, filePath, patientId, setupId, log: fileLog });
  }
  for (const filePath of cutlines) {
    run.cutlineQueue.push({ filePath, setupId, label: `${patientFolder} › ${setupName} › ${path.basename(filePath)}` });
  }
  if (cutlines.length > 0) {
    fileLog.info(`${cutlines.length} ligne(s) de découpe à envoyer après tous les modèles`);
  }
}

async function uploadPatient({ run, patientDir, log }) {
  const { stats } = run;
  const folderName = path.basename(patientDir);
  log.title(`Patient ${folderName}`);
  const patientLog = log.nested();
  const [lastName, firstName, third] = folderName.split('_');
  if (!lastName || !firstName) {
    stats.patientErrors += 1;
    patientLog.error('Dossier ignoré : nom ou prénom manquant.', 'Format attendu : Nom_Prenom ou Nom_Prenom_AAAA-MM-JJ');
    return;
  }
  const birthDate = third && datePattern.test(third) ? third : null;
  if (third && !birthDate) {
    patientLog.warn(`"${third}" n'est pas une date de naissance au format AAAA-MM-JJ : ignoré`);
  }
  stats.patients += 1;
  const patient = await getOrCreatePatient({ run, firstName, lastName, birthDate, log: patientLog });
  if (!patient) {
    stats.patientErrors += 1;
    return;
  }
  if (patient.toCheck) {
    stats.patientsToCheck.push(folderName);
    return;
  }
  const modelsBefore = stats.models;
  const entries = await fs.promises.readdir(patientDir, { withFileTypes: true });
  const setupDirs = entries.filter((entry) => entry.isDirectory());
  if (setupDirs.length === 0) patientLog.warn('Aucun dossier de setup pour ce patient');
  for (const entry of setupDirs) {
    await uploadSetup({
      run,
      setupDir: path.join(patientDir, entry.name),
      patientFolder: folderName,
      patientId: patient.id,
      log: patientLog,
    });
  }
  if (patient.created) {
    stats.newPatients.push({ name: `${firstName} ${lastName}`, models: stats.models - modelsBefore });
  }
}

// Run -----------------------------------------------------------------------

function createStats() {
  return {
    patients: 0,
    patientErrors: 0,
    patientsToCheck: [],
    newPatients: [],
    setupsCreated: 0,
    setupsReused: 0,
    setupErrors: 0,
    models: 0,
    modelErrors: 0,
    cutlines: 0,
    cutlineErrors: 0,
  };
}

function countErrors(stats) {
  return stats.patientErrors + stats.setupErrors + stats.modelErrors + stats.cutlineErrors;
}

function logSummary(log, stats) {
  const errors = countErrors(stats);
  log.title('Bilan');
  const summaryLog = log.nested();
  summaryLog.info(`Patients traités : ${stats.patients} (dont ${stats.newPatients.length} créé(s))`);
  summaryLog.info(`Setups : ${stats.setupsCreated} créé(s), ${stats.setupsReused} déjà existant(s)`);
  summaryLog.info(`Fichiers chargés : ${stats.models} modèle(s), ${stats.cutlines} ligne(s) de découpe`);
  if (stats.patientsToCheck.length > 0) {
    summaryLog.info(
      `${stats.patientsToCheck.length} patient(s) à compléter avec une date de naissance : ${stats.patientsToCheck.join(', ')}`,
    );
  }
  // Not logged as an error: the journal counters must only count the errors themselves
  if (errors > 0) summaryLog.info(`${errors} erreur(s) : voir les lignes en rouge ci-dessus`);
  else summaryLog.success('Aucune erreur');
}

async function runUpload({ rootDir, baseUrl, credentials, renameAfterUpload, log = noopLog, cutlineTimings }) {
  const run = {
    client: null,
    renameAfter: !!renameAfterUpload,
    stats: createStats(),
    cutlineQueue: [],
    cutlineTimings: { ...DEFAULT_CUTLINE_TIMINGS, ...cutlineTimings },
    lastModelUploadAt: 0,
  };
  const { stats } = run;
  try {
    if (!rootDir || !fs.existsSync(rootDir)) {
      throw new FatalUploadError(`Dossier racine introuvable : ${rootDir || '(aucun)'}`);
    }
    log.info(`Serveur : ${baseUrl}`);
    log.info(`Dossier racine : ${rootDir}`);
    run.client = createClient({ baseUrl, credentials, log });
    await run.client.login();
    log.success(`Connecté en tant que ${credentials.username}`);

    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory());
    const patientDirs = dirs.filter((entry) => entry.name.includes('_'));
    const ignored = dirs.filter((entry) => !entry.name.includes('_'));
    if (ignored.length > 0) {
      log.warn(
        `${ignored.length} dossier(s) ignoré(s) : le nom doit être au format Nom_Prenom`,
        ignored.map((entry) => entry.name).join(', '),
      );
    }
    if (patientDirs.length === 0) log.warn('Aucun dossier patient trouvé dans le dossier racine');

    // 1. Patients, setups and models
    for (const entry of patientDirs) {
      try {
        await uploadPatient({ run, patientDir: path.join(rootDir, entry.name), log });
      } catch (err) {
        if (err instanceof FatalUploadError) throw err;
        stats.patientErrors += 1;
        log.nested().error(`Erreur inattendue pendant le traitement de ${entry.name}`, err.stack || String(err));
      }
    }
    // 2. Cutlines, once every model is uploaded
    await uploadCutlines({ run, log });
  } catch (err) {
    if (!(err instanceof FatalUploadError)) throw err;
    log.error(err.message, err.details);
    if (run.renameAfter && stats.models + stats.cutlines > 0) {
      log.info("Relancez l'upload une fois le problème corrigé : les fichiers déjà envoyés (préfixe uploaded_) ne seront pas renvoyés.");
    }
    logSummary(log, stats);
    return { ok: false, error: err.message, stats: { ...stats, errors: countErrors(stats) + 1 } };
  }
  logSummary(log, stats);
  return { ok: true, stats: { ...stats, errors: countErrors(stats) } };
}

async function testConnection({ baseUrl, credentials, log = noopLog }) {
  try {
    await createClient({ baseUrl, credentials, log }).login();
    log.success(`Test de connexion réussi sur ${baseUrl} (${credentials.username})`);
    return { ok: true };
  } catch (err) {
    if (!(err instanceof FatalUploadError)) throw err;
    log.error(`Test de connexion échoué : ${err.message}`, err.details);
    return { ok: false, error: err.message };
  }
}

module.exports = { runUpload, testConnection, getPosition, getRankAndCategory };
