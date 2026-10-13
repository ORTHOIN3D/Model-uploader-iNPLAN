// Fake InPlan API for the tests: records every request and answers like the
// real server by default. Any route can be overridden: { 'POST /api/1/models': handler }
// where handler(request, allRequests) returns [status, body].
const http = require('http');

const DEFAULT_ROUTES = {
  'POST /api/1/token/': () => [200, { access: 'token-1', refresh: 'refresh-1' }],
  'POST /api/1/patients/get_or_create': ({ body }) => [201, { id: `patient-${body.last_name}-${body.first_name}` }],
  'POST /api/1/setups': ({ body }) => [201, { id: `setup-${body.name}` }],
  'GET /api/1/setups': () => [200, { count: 0, next: null, previous: null, results: [] }],
  'POST /api/1/models': ({ body }) => [201, { id: `model-${body.file}` }],
  'POST /api/1/cutlines/existing_pts': () => [202, { job_id: 'job-1' }],
};

// Multipart fields as { name: value }, uploaded files as "FILE:<file name>"
function parseBody(contentType, raw) {
  if (raw.length === 0) return null;
  if (!contentType.startsWith('multipart/')) return JSON.parse(raw.toString('utf8'));
  const text = raw.toString('latin1');
  const fields = {};
  const part = /name="([^"]+)"(?:; filename="([^"]*)")?\r\n(?:Content-Type: [^\r]*\r\n)?\r\n([^\r]*)/g;
  for (const [, name, fileName, value] of text.matchAll(part)) {
    fields[name] = fileName !== undefined
      ? `FILE:${Buffer.from(fileName, 'latin1').toString('utf8')}`
      : Buffer.from(value, 'latin1').toString('utf8');
  }
  return fields;
}

// "POST /api/1/setups {"name":"S1","patient":"p1"}" with sorted keys, easy to compare
function describeRequest({ route, body }) {
  return body ? `${route} ${JSON.stringify(body, Object.keys(body).sort())}` : route;
}

async function startMockApi(routes = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://localhost');
      const request = {
        at: Date.now(),
        route: `${req.method} ${url.pathname}`,
        query: Object.fromEntries(url.searchParams),
        auth: req.headers.authorization || null,
        body: parseBody(req.headers['content-type'] || '', Buffer.concat(chunks)),
      };
      requests.push(request);
      const handler = routes[request.route] || DEFAULT_ROUTES[request.route];
      const [status, data] = handler ? await handler(request, requests) : [404, {}];
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

module.exports = { startMockApi, describeRequest };
