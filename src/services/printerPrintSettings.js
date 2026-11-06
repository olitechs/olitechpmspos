import { normalizePrintSettings } from './escposJob.js';

const STORAGE_PREFIX = 'olitechs:thermal-printer-settings:v1:';

export function getPrinterPrintSettings(printer = {}, overrides = {}) {
  let saved = {};
  const printerId = printer?.id || overrides?.id;
  if (printerId && typeof window !== 'undefined') {
    try {
      saved = JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + printerId) || '{}');
    } catch (_) {
      saved = {};
    }
  }
  return normalizePrintSettings({
    ...printer,
    ...saved,
    ...overrides,
    paperWidth: overrides.paperWidth ?? saved.paperWidth ?? printer.paperWidth ?? printer.paper_width ?? '80mm',
  });
}

export function savePrinterPrintSettings(printerId, settings = {}) {
  if (!printerId || typeof window === 'undefined') return false;
  window.localStorage.setItem(STORAGE_PREFIX + printerId, JSON.stringify(normalizePrintSettings(settings)));
  return true;
}
