// Texts shown about updates. Kept apart from updater.js (which needs Electron)
// so the tests can run with plain Node.

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

module.exports = { releaseNotesToText, describeUpdateError };
