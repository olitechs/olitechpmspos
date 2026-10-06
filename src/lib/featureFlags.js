// Lightweight feature flags for additive Back Office modules.
const DEFAULTS = {
  backoffice: false,
  printerGroupRouting: false,
};
const ENV_KEYS = {
  backoffice: import.meta.env?.VITE_FF_BACKOFFICE,
  printerGroupRouting: import.meta.env?.VITE_FF_PRINTER_GROUP_ROUTING,
};
function parse(value) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}
export function isFeatureEnabled(name) {
  try {
    const local = parse(globalThis.localStorage?.getItem(`olitech_ff_${name}`));
    if (local !== null) return local;
  } catch {}
  const env = parse(ENV_KEYS[name]);
  if (env !== null) return env;
  return Boolean(DEFAULTS[name]);
}
