const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseNotesToText, describeUpdateError } = require('../src/update-messages');

test('erreurs de mise à jour expliquées simplement', () => {
  const notFound = new Error('HttpError: 404 \n"method: GET url: https://github.com/ORTHOIN3D/Model-uploader-iNPLAN/releases.atom"');
  assert.equal(describeUpdateError(notFound), 'source des mises à jour introuvable (dépôt GitHub privé ou inexistant)');
  assert.equal(describeUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')), 'pas de connexion à internet ou GitHub injoignable');
  assert.equal(describeUpdateError(new Error('getaddrinfo ENOTFOUND github.com')), 'pas de connexion à internet ou GitHub injoignable');
  assert.equal(describeUpdateError(new Error('No published versions on GitHub')), 'aucune version publiée pour le moment');
  assert.equal(describeUpdateError(new Error('Autre problème\ndétails techniques')), 'Autre problème');
});

test('notes de version GitHub (HTML) converties en texte', () => {
  const html = '<ul>\n<li>Correction des <strong>lignes de découpe</strong></li>\n<li>Thème &amp; journal</li>\n</ul>';
  assert.equal(releaseNotesToText(html), '• Correction des lignes de découpe\n\n• Thème & journal');
  assert.equal(releaseNotesToText([{ note: '<p>Première</p>' }, { note: 'Seconde' }]), 'Première\n\nSeconde');
  assert.equal(releaseNotesToText(null), '');
});
