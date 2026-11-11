import { normalizeAgentBaseUrl } from './printerHealthCore.js';

/**
 * One-click support file.
 *
 * The agent builds the bundle (it is the only place that can see the queue, the
 * service lock and the logs) and saves its own copy. This module fetches that
 * bundle and saves it to the staff member's Downloads folder, so it can be
 * attached to a support request without anyone opening a file manager.
 */

export async function requestPrintDiagnostics(agentUrl, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const base = normalizeAgentBaseUrl(agentUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}/diagnostics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.ok || !body?.bundle) {
      return {
        ok: false,
        code: body?.code || `HTTP_${response.status}`,
        message: body?.message || 'The diagnostics file could not be created on this computer.',
      };
    }
    return {
      ok: true,
      bundle: body.bundle,
      fileName: body.fileName || 'OliTechs-PrintAgent-Diagnostics.json',
      bytes: body.bytes || 0,
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === 'AbortError' ? 'DIAGNOSTICS_TIMEOUT' : 'AGENT_UNREACHABLE',
      message: error?.name === 'AbortError'
        ? 'The print agent took too long to prepare the diagnostics file.'
        : 'The print agent is not reachable on this computer, so it cannot create a diagnostics file.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function saveDiagnosticsFile({
  bundle,
  fileName,
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
  setTimeoutFn = globalThis.setTimeout,
} = {}) {
  if (!bundle) throw new Error('There is no diagnostics content to save.');
  if (!documentRef?.createElement || !documentRef?.body) throw new Error('This browser cannot save files.');

  const name = String(fileName || 'OliTechs-PrintAgent-Diagnostics.json');
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const href = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  documentRef.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeoutFn(() => urlApi.revokeObjectURL(href), 10000);
  return { ok: true, fileName: name };
}

/** The button in Settings → Printers calls this once. */
export async function exportPrintDiagnostics({ agentUrl, fetchImpl, documentRef, urlApi } = {}) {
  const result = await requestPrintDiagnostics(agentUrl, { fetchImpl });
  if (!result.ok) return result;
  const saved = saveDiagnosticsFile({ bundle: result.bundle, fileName: result.fileName, documentRef, urlApi });
  return { ok: true, fileName: saved.fileName, bytes: result.bytes };
}
