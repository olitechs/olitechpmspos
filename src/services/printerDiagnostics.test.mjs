import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPrintDiagnostics, saveDiagnosticsFile, exportPrintDiagnostics } from './printerDiagnostics.js';

const jsonResponse = (body, { status = 200 } = {}) => ({ ok: status < 300, status, json: async () => body });

function fakeDocument() {
  const appended = [];
  const anchor = {
    clicked: 0,
    click() { this.clicked += 1; },
    remove() { this.removed = true; },
  };
  return {
    anchor,
    appended,
    body: { appendChild: (node) => appended.push(node) },
    createElement: () => anchor,
  };
}

function fakeUrls() {
  const revoked = [];
  return {
    created: [],
    createObjectURL(blob) { this.created.push(blob); return 'blob:diagnostics-1'; },
    revokeObjectURL(url) { revoked.push(url); },
    get revoked() { return revoked; },
  };
}

test('the agent bundle is fetched and handed back with its file name', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return jsonResponse({ ok: true, fileName: 'OliTechs-PrintAgent-Diagnostics-2026-11-11_12-00-00-000.json', bytes: 900, bundle: { format: 1, agent: { version: '2.2.0' } } });
  };

  const result = await requestPrintDiagnostics('127.0.0.1:8631/', { fetchImpl });
  assert.equal(request.url, '127.0.0.1:8631/diagnostics');
  assert.equal(request.init.method, 'POST');
  assert.equal(result.ok, true);
  assert.equal(result.bundle.agent.version, '2.2.0');
  assert.match(result.fileName, /Diagnostics-.*\.json$/);
});

test('an unreachable agent is explained without a stack trace', async () => {
  const result = await requestPrintDiagnostics('http://127.0.0.1:8631', {
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AGENT_UNREACHABLE');
  assert.match(result.message, /not reachable/);
});

test('an agent that refuses diagnostics returns its message', async () => {
  const result = await requestPrintDiagnostics('http://127.0.0.1:8631', {
    fetchImpl: async () => jsonResponse({ ok: false, code: 'RATE_LIMITED', message: 'Too many printer requests.' }, { status: 429 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RATE_LIMITED');
  assert.match(result.message, /Too many/);
});

test('saving downloads a JSON file with the agent name and cleans up the blob URL', () => {
  const documentRef = fakeDocument();
  const urlApi = fakeUrls();
  const timers = [];
  const saved = saveDiagnosticsFile({
    bundle: { format: 1 },
    fileName: 'OliTechs-PrintAgent-Diagnostics-test.json',
    documentRef,
    urlApi,
    setTimeoutFn: (fn) => timers.push(fn),
  });

  assert.equal(saved.ok, true);
  assert.equal(documentRef.anchor.download, 'OliTechs-PrintAgent-Diagnostics-test.json');
  assert.equal(documentRef.anchor.clicked, 1);
  assert.equal(documentRef.anchor.removed, true);
  assert.equal(documentRef.appended.length, 1);
  assert.equal(urlApi.revoked.length, 0, 'the URL must stay valid until the download starts');

  timers.forEach((fn) => fn());
  assert.deepEqual(urlApi.revoked, ['blob:diagnostics-1']);
  assert.equal(urlApi.created[0].type, 'application/json');
});

test('saving without content fails loudly instead of downloading an empty file', () => {
  assert.throws(() => saveDiagnosticsFile({ bundle: null }), /no diagnostics content/i);
});

test('the one-click export saves the file and reports its name', async () => {
  const documentRef = fakeDocument();
  const result = await exportPrintDiagnostics({
    agentUrl: 'http://127.0.0.1:8631',
    fetchImpl: async () => jsonResponse({ ok: true, fileName: 'OliTechs-PrintAgent-Diagnostics-x.json', bytes: 120, bundle: { format: 1 } }),
    documentRef,
    urlApi: fakeUrls(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.fileName, 'OliTechs-PrintAgent-Diagnostics-x.json');
  assert.equal(documentRef.anchor.clicked, 1);
});

test('a failed export never triggers a download', async () => {
  const documentRef = fakeDocument();
  const result = await exportPrintDiagnostics({
    agentUrl: 'http://127.0.0.1:8631',
    fetchImpl: async () => { throw new Error('offline'); },
    documentRef,
    urlApi: fakeUrls(),
  });

  assert.equal(result.ok, false);
  assert.equal(documentRef.anchor.clicked, 0, 'a failed export must not start a download');
});
