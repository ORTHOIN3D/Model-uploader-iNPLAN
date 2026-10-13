const test = require('node:test');
const assert = require('node:assert/strict');
const { runUpload, testConnection, getPosition, getRankAndCategory } = require('../src/uploader');
const { startMockApi, describeRequest } = require('./helpers/mock-api');
const { makeTree, listFiles, removeTree, captureLog } = require('./helpers/files');

const credentials = { username: 'u', password: 'p' };
const FAST_CUTLINES = { firstDelayMs: 0, retryDelayMs: 10, maxWaitMs: 300 };
const HOMONYM_REPLY = { error: 'A patient with the same first and last name already exists. Please provide a birth date.' };

// Runs an upload against a fresh fake API and a fresh folder tree
async function upload(t, { tree, routes, renameAfterUpload = true, cutlineTimings = FAST_CUTLINES }) {
  const api = await startMockApi(routes);
  const rootDir = makeTree(tree);
  t.after(async () => {
    removeTree(rootDir);
    await api.close();
  });
  const { log, entries } = captureLog();
  const result = await runUpload({ rootDir, baseUrl: api.baseUrl, credentials, renameAfterUpload, log, cutlineTimings });
  return { result, api, entries, files: listFiles(rootDir) };
}

const routesOf = (api) => api.requests.map((request) => request.route);
const requestsTo = (api, route) => api.requests.filter((request) => request.route === route);

// Reference tree and what v0.1.0 sent for it (recorded by running the v0.1.0
// uploader against this tree). Only the order of the cutlines changed since.
const REFERENCE_TREE = [
  'Dupont_Jean_1990-05-15/Setup 1/Dupont_U01.stl',
  'Dupont_Jean_1990-05-15/Setup 1/Dupont_L01.stl',
  'Dupont_Jean_1990-05-15/Setup 1/Dupont_U01.pts',
  'Dupont_Jean_1990-05-15/Setup 1/Dupont_L01.pts',
  'Dupont_Jean_1990-05-15/Setup 1/sous-dossier/Dupont_U02.stl',
  'Dupont_Jean_1990-05-15/Setup 1/sous-dossier/Dupont_U02.pts',
  'Dupont_Jean_1990-05-15/Setup 1/uploaded_Dupont_U00.stl',
  'Dupont_Jean_1990-05-15/Setup 1/compressed_Dupont_L00.stl',
  'Dupont_Jean_1990-05-15/Setup 1/Dupont_L09.STL',
  'Dupont_Jean_1990-05-15/Setup 1/notes.txt',
  'Dupont_Jean_1990-05-15/Setup 2/Modèle supérieur étape 2 de 10.stl',
  'Dupont_Jean_1990-05-15/Setup 2/Mandibule u3.stl',
  'Dupont_Jean_1990-05-15/Setup 2/AnonymeB_lower (3).stl',
  'Dupont_Jean_1990-05-15/Setup 2/AnonymeB_lower (3).pts',
  'Dupont_Jean_1990-05-15/Setup 2/maxillaire.stl',
  'Dupont_Jean_1990-05-15/fichier_racine_patient.stl',
  'Martin_Lea/SetupA/Martin_u4.stl',
  'Martin_Lea/SetupA/Martin_l4.stl',
  'Martin_Lea/SetupA/Martin_l4.pts',
  'Martin_Lea_Pierre/S/Martin_U01.stl',
  'SansUnderscore/S/x_U01.stl',
  'Vide_Patient/',
];

const json = (body) => JSON.stringify(body, Object.keys(body).sort());
const model = (file, setup, patient, rank, type, isOriginal = false) => `POST /api/1/models ${json({
  file: `FILE:${file}`,
  is_original: String(isOriginal),
  is_template: 'false',
  patient,
  setup_id: setup,
  setup_rank: String(rank),
  type: String(type),
})}`;
const cutline = (file, setup) => `POST /api/1/cutlines/existing_pts ${json({ file: `FILE:${file}`, setup_id: setup })}`;
const patient = (lastName, firstName, birthDate) => `POST /api/1/patients/get_or_create ${json({
  birth_date: birthDate, first_name: firstName, last_name: lastName,
})}`;
const setup = (name, patientId) => `POST /api/1/setups ${json({ name, patient: patientId })}`;

const V010_REQUESTS = [
  `POST /api/1/token/ ${json({ password: 'p', username: 'u' })}`,
  patient('Dupont', 'Jean', '1990-05-15'),
  patient('Martin', 'Lea', null),
  patient('Martin', 'Lea', null),
  patient('Vide', 'Patient', null),
  setup('Setup 1', 'patient-Dupont-Jean'),
  setup('Setup 2', 'patient-Dupont-Jean'),
  setup('SetupA', 'patient-Martin-Lea'),
  setup('S', 'patient-Martin-Lea'),
  model('Dupont_U01.stl', 'setup-Setup 1', 'patient-Dupont-Jean', 1, 0),
  model('Dupont_L01.stl', 'setup-Setup 1', 'patient-Dupont-Jean', 1, 1),
  model('Dupont_U02.stl', 'setup-Setup 1', 'patient-Dupont-Jean', 2, 0),
  model('Modèle supérieur étape 2 de 10.stl', 'setup-Setup 2', 'patient-Dupont-Jean', 2, 0),
  model('AnonymeB_lower (3).stl', 'setup-Setup 2', 'patient-Dupont-Jean', 3, 1),
  model('maxillaire.stl', 'setup-Setup 2', 'patient-Dupont-Jean', 0, 0, true),
  model('Martin_u4.stl', 'setup-SetupA', 'patient-Martin-Lea', 4, 0),
  model('Martin_l4.stl', 'setup-SetupA', 'patient-Martin-Lea', 4, 1),
  model('Martin_U01.stl', 'setup-S', 'patient-Martin-Lea', 1, 0),
  cutline('Dupont_U01.pts', 'setup-Setup 1'),
  cutline('Dupont_L01.pts', 'setup-Setup 1'),
  cutline('Dupont_U02.pts', 'setup-Setup 1'),
  cutline('AnonymeB_lower (3).pts', 'setup-Setup 2'),
  cutline('Martin_l4.pts', 'setup-SetupA'),
];

const V010_FILES_AFTER = [
  'Dupont_Jean_1990-05-15/Setup 1/Dupont_L09.STL',
  'Dupont_Jean_1990-05-15/Setup 1/compressed_Dupont_L00.stl',
  'Dupont_Jean_1990-05-15/Setup 1/notes.txt',
  'Dupont_Jean_1990-05-15/Setup 1/sous-dossier/uploaded_Dupont_U02.pts',
  'Dupont_Jean_1990-05-15/Setup 1/sous-dossier/uploaded_Dupont_U02.stl',
  'Dupont_Jean_1990-05-15/Setup 1/uploaded_Dupont_L01.pts',
  'Dupont_Jean_1990-05-15/Setup 1/uploaded_Dupont_L01.stl',
  'Dupont_Jean_1990-05-15/Setup 1/uploaded_Dupont_U00.stl',
  'Dupont_Jean_1990-05-15/Setup 1/uploaded_Dupont_U01.pts',
  'Dupont_Jean_1990-05-15/Setup 1/uploaded_Dupont_U01.stl',
  'Dupont_Jean_1990-05-15/Setup 2/Mandibule u3.stl',
  'Dupont_Jean_1990-05-15/Setup 2/uploaded_AnonymeB_lower (3).pts',
  'Dupont_Jean_1990-05-15/Setup 2/uploaded_AnonymeB_lower (3).stl',
  'Dupont_Jean_1990-05-15/Setup 2/uploaded_Modèle supérieur étape 2 de 10.stl',
  'Dupont_Jean_1990-05-15/Setup 2/uploaded_maxillaire.stl',
  'Dupont_Jean_1990-05-15/fichier_racine_patient.stl',
  'Martin_Lea/SetupA/uploaded_Martin_l4.pts',
  'Martin_Lea/SetupA/uploaded_Martin_l4.stl',
  'Martin_Lea/SetupA/uploaded_Martin_u4.stl',
  'Martin_Lea_Pierre/S/uploaded_Martin_U01.stl',
  'SansUnderscore/S/x_U01.stl',
];

const ONE_SETUP = ['Martin_Lea/SetupA/Martin_l4.stl', 'Martin_Lea/SetupA/Martin_l4.pts'];

test('nommage des fichiers : maxillaire / mandibulaire et étape comme la v0.1.0', () => {
  const cases = [
    ['Dupont_U01.stl', 0, 1],
    ['Dupont_L01.stl', 1, 1],
    ['Martin_u4.stl', 0, 4],
    ['Martin_l4.stl', 1, 4],
    ['AnonymeB_lower (3).stl', 1, 3],
    ['AnonymeB_upper (12).stl', 0, 12],
    ['Modèle supérieur étape 2 de 10.stl', 0, 2],
    ['Inférieur étape 7 de 20.stl', 1, 7],
    ['maxillaire.stl', 0, 0],
    ['mandibulaire.stl', 1, 0],
    ['Mandibule u3.stl', -1, 3],
    ['sans_indice.stl', -1, 0],
  ];
  for (const [name, position, rank] of cases) {
    assert.equal(getPosition(name), position, `position de ${name}`);
    assert.equal(getRankAndCategory(name).rank, rank, `étape de ${name}`);
  }
  assert.equal(getRankAndCategory('maxillaire.stl').isOriginal, true);
  assert.equal(getRankAndCategory('Dupont_U01.stl').isOriginal, false);
});

test('mêmes requêtes et mêmes fichiers renommés que la v0.1.0', async (t) => {
  const { api, files, result } = await upload(t, { tree: REFERENCE_TREE });
  assert.deepEqual(api.requests.map(describeRequest).sort(), [...V010_REQUESTS].sort());
  assert.deepEqual(files, V010_FILES_AFTER);
  assert.equal(api.requests[0].auth, null, 'la connexion part sans jeton');
  assert.ok(api.requests.slice(1).every((request) => request.auth === 'Bearer token-1'), 'jeton sur toutes les autres requêtes');
  assert.equal(result.ok, true);
  assert.equal(result.stats.models, 9);
  assert.equal(result.stats.cutlines, 5);
});

test('lignes de découpe envoyées après tous les modèles, après le délai initial', async (t) => {
  const { api } = await upload(t, {
    tree: REFERENCE_TREE,
    cutlineTimings: { ...FAST_CUTLINES, firstDelayMs: 300 },
  });
  const routes = routesOf(api);
  const lastModel = routes.lastIndexOf('POST /api/1/models');
  const firstCutline = routes.indexOf('POST /api/1/cutlines/existing_pts');
  assert.ok(lastModel < firstCutline, 'aucune ligne de découpe avant le dernier modèle');
  assert.ok(api.requests[firstCutline].at - api.requests[lastModel].at >= 250, 'délai respecté');
});

test('rien n\'est renommé quand le renommage est désactivé', async (t) => {
  const { files } = await upload(t, { tree: ONE_SETUP, renameAfterUpload: false });
  assert.deepEqual(files, [...ONE_SETUP].sort());
});

test('setup déjà présent (409) : réutilisé au lieu d\'arrêter l\'upload', async (t) => {
  const { api, result } = await upload(t, {
    tree: ONE_SETUP,
    routes: {
      'POST /api/1/setups': () => [409, { detail: 'Setup name already exist' }],
      'GET /api/1/setups': ({ query }) => [200, { count: 1, next: null, results: [{ id: 'setup-existant', name: query.name }] }],
    },
  });
  const [lookup] = requestsTo(api, 'GET /api/1/setups');
  assert.deepEqual([lookup.query.patient_id, lookup.query.name], ['patient-Martin-Lea', 'SetupA']);
  assert.equal(requestsTo(api, 'POST /api/1/models')[0].body.setup_id, 'setup-existant');
  assert.equal(result.stats.setupsReused, 1);
  assert.equal(result.stats.errors, 0);
});

test('ligne de découpe acceptée avec une réponse 201 comme 202', async (t) => {
  const { result, files } = await upload(t, {
    tree: ONE_SETUP,
    routes: { 'POST /api/1/cutlines/existing_pts': () => [201, {}] },
  });
  assert.equal(result.stats.cutlines, 1);
  assert.ok(files.includes('Martin_Lea/SetupA/uploaded_Martin_l4.pts'));
});

test('modèle pas encore prêt (503) : nouvel essai puis succès', async (t) => {
  let calls = 0;
  const { api, result } = await upload(t, {
    tree: ONE_SETUP,
    routes: { 'POST /api/1/cutlines/existing_pts': () => ((calls += 1) <= 2 ? [503, {}] : [202, {}]) },
  });
  assert.equal(requestsTo(api, 'POST /api/1/cutlines/existing_pts').length, 3);
  assert.equal(result.stats.cutlines, 1);
  assert.equal(result.stats.errors, 0);
});

test('une ligne de découpe en attente ne bloque pas les suivantes', async (t) => {
  const { api, result } = await upload(t, {
    tree: [...ONE_SETUP, 'Martin_Lea/SetupA/Martin_u4.stl', 'Martin_Lea/SetupA/Martin_u4.pts'],
    routes: {
      'POST /api/1/cutlines/existing_pts': ({ body }, all) => {
        const tries = all.filter((r) => r.body?.file === body.file).length;
        return body.file === 'FILE:Martin_l4.pts' && tries === 1 ? [503, {}] : [202, {}];
      },
    },
  });
  const sent = requestsTo(api, 'POST /api/1/cutlines/existing_pts').map((r) => r.body.file);
  assert.deepEqual(sent, ['FILE:Martin_l4.pts', 'FILE:Martin_u4.pts', 'FILE:Martin_l4.pts']);
  assert.equal(result.stats.cutlines, 2);
});

test('modèle jamais prêt : erreur claire après le délai maximal, fichier non renommé', async (t) => {
  const { result, files, entries } = await upload(t, {
    tree: ONE_SETUP,
    routes: { 'POST /api/1/cutlines/existing_pts': () => [503, {}] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.stats.cutlineErrors, 1);
  assert.ok(files.includes('Martin_Lea/SetupA/Martin_l4.pts'));
  assert.ok(entries.some((e) => e.level === 'error' && e.message.includes("toujours pas prêt")));
});

test('ligne de découpe sans modèle (404) : le message indique le modèle attendu', async (t) => {
  const { entries } = await upload(t, {
    tree: ['Fdj_France/Setup/AnonymeB_lower (1).pts'],
    routes: { 'POST /api/1/cutlines/existing_pts': () => [404, {}] },
  });
  const error = entries.find((e) => e.level === 'error');
  assert.match(error.message, /pas de modèle mandibulaire de l'étape 1/);
});

for (const [label, reply] of [['400', [400, HOMONYM_REPLY]], ['409', [409, {}]]]) {
  test(`patient homonyme (${label}) : avertissement avec la marche à suivre, rien n'est envoyé`, async (t) => {
    const { api, result, entries } = await upload(t, {
      tree: ['Peter_Beatbox/Setup/Peter_U01.stl'],
      routes: { 'POST /api/1/patients/get_or_create': () => reply },
    });
    assert.deepEqual(result.stats.patientsToCheck, ['Peter_Beatbox']);
    assert.equal(result.stats.errors, 0);
    assert.deepEqual(routesOf(api), ['POST /api/1/token/', 'POST /api/1/patients/get_or_create']);
    const warning = entries.find((e) => e.level === 'warn');
    assert.match(warning.message, /existe déjà dans InPlan/);
    assert.match(warning.details, /Peter_Beatbox_AAAA-MM-JJ/);
    assert.ok(!entries.some((e) => e.level === 'error'));
  });
}

test('jeton expiré (401) : reconnexion puis nouvel essai', async (t) => {
  let logins = 0;
  const { api, result } = await upload(t, {
    tree: ['Martin_Lea/SetupA/Martin_l4.stl'],
    routes: {
      'POST /api/1/token/': () => [200, { access: `token-${(logins += 1)}` }],
      'POST /api/1/models': ({ auth }) => (auth === 'Bearer token-1' ? [401, { detail: 'Token expired' }] : [201, {}]),
    },
  });
  const tokens = requestsTo(api, 'POST /api/1/token/');
  assert.equal(tokens.length, 2);
  assert.equal(tokens[1].auth, null, 'la reconnexion n\'envoie pas l\'ancien jeton');
  assert.equal(requestsTo(api, 'POST /api/1/models').at(-1).auth, 'Bearer token-2');
  assert.equal(result.stats.models, 1);
});

test('identifiants refusés : arrêt avec un message clair', async (t) => {
  const { api, result } = await upload(t, {
    tree: ONE_SETUP,
    routes: { 'POST /api/1/token/': () => [401, { detail: 'No active account found with the given credentials' }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /mot de passe incorrect/);
  assert.deepEqual(routesOf(api), ['POST /api/1/token/']);
});

test('serveur injoignable : arrêt avec un message clair', async (t) => {
  const api = await startMockApi();
  await api.close();
  const rootDir = makeTree(ONE_SETUP);
  t.after(() => removeTree(rootDir));
  const result = await runUpload({ rootDir, baseUrl: api.baseUrl, credentials, cutlineTimings: FAST_CUTLINES });
  assert.equal(result.ok, false);
  assert.match(result.error, /Serveur injoignable/);
});

test('une erreur serveur sur un patient n\'arrête pas les autres', async (t) => {
  const { api, result } = await upload(t, {
    tree: ['Alpha_Anna/S/Alpha_U01.stl', 'Gamma_Carl/S/Gamma_U01.stl'],
    routes: {
      'POST /api/1/patients/get_or_create': ({ body }) => (body.last_name === 'Alpha'
        ? [500, '<html><title>Server Error (500)</title></html>']
        : [201, { id: `patient-${body.last_name}` }]),
    },
  });
  assert.equal(result.stats.patientErrors, 1);
  assert.deepEqual(requestsTo(api, 'POST /api/1/models').map((r) => r.body.file), ['FILE:Gamma_U01.stl']);
});

test('modèle déjà présent (409) : message neutre, pas une erreur, fichier non renommé', async (t) => {
  const { result, files, entries } = await upload(t, {
    tree: ['Fdj_France/Setup/AnonymeB_lower (3).stl', 'Fdj_France/Setup/AnonymeB_lower (4).stl'],
    routes: {
      'POST /api/1/models': ({ body }) => (body.file === 'FILE:AnonymeB_lower (3).stl'
        ? [409, { detail: 'Model already exists' }]
        : [201, {}]),
    },
  });
  assert.equal(result.stats.errors, 0);
  assert.equal(result.stats.modelsAlreadyPresent, 1);
  assert.equal(result.stats.models, 1);
  assert.deepEqual(files, ['Fdj_France/Setup/AnonymeB_lower (3).stl', 'Fdj_France/Setup/uploaded_AnonymeB_lower (4).stl']);
  const notice = entries.find((e) => e.message.includes('AnonymeB_lower (3).stl déjà présent'));
  assert.equal(notice.level, 'info');
  assert.equal(notice.message, 'AnonymeB_lower (3).stl déjà présent dans InPlan (mandibulaire, étape 3) : non renvoyé');
  assert.ok(!entries.some((e) => ['error', 'warn'].includes(e.level)), 'ni erreur ni avertissement');
  assert.ok(entries.some((e) => e.level === 'debug' && /HTTP 409/.test(e.message)), 'réponse du serveur gardée pour le support');
});

test('modèle refusé (500) : erreur, fichier non renommé, l\'upload continue', async (t) => {
  const { result, files } = await upload(t, {
    tree: ['Martin_Lea/S1/Martin_U01.stl', 'Martin_Lea/S2/Martin_L01.stl'],
    routes: { 'POST /api/1/models': ({ body }) => (body.file === 'FILE:Martin_U01.stl' ? [500, {}] : [201, {}]) },
  });
  assert.equal(result.stats.modelErrors, 1);
  assert.equal(result.stats.models, 1);
  assert.deepEqual(files, ['Martin_Lea/S1/Martin_U01.stl', 'Martin_Lea/S2/uploaded_Martin_L01.stl']);
});

test('test de connexion : réussi puis refusé', async (t) => {
  let accept = true;
  const api = await startMockApi({ 'POST /api/1/token/': () => (accept ? [200, { access: 't' }] : [401, {}]) });
  t.after(() => api.close());
  assert.deepEqual(await testConnection({ baseUrl: api.baseUrl, credentials }), { ok: true });
  accept = false;
  const refused = await testConnection({ baseUrl: api.baseUrl, credentials });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /mot de passe incorrect/);
});
