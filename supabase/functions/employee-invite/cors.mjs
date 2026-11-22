const VERCEL_APP_HOST = /^olitechpmspos(?:-[a-z0-9-]+)?\.vercel\.app$/i;

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins(value) {
  return String(value || '')
    .split(/[;,\n]/)
    .map(normalizeOrigin)
    .filter(Boolean);
}

export function isAllowedInviteOrigin(origin, { appUrl, allowedOrigins = '' } = {}) {
  const normalized = normalizeOrigin(origin);
  if (!normalized || normalized !== origin) return false;

  const appOrigin = normalizeOrigin(appUrl) || 'https://app.olitechs.co.ke';
  const productionOrigins = new Set([
    'https://olitechs.co.ke',
    'https://www.olitechs.co.ke',
    'https://app.olitechs.co.ke',
  ]);
  if (normalized === appOrigin || productionOrigins.has(normalized) || configuredOrigins(allowedOrigins).includes(normalized)) return true;

  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' && VERCEL_APP_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function buildInviteCorsHeaders(req, { appUrl, allowedOrigins = '' } = {}) {
  const appOrigin = normalizeOrigin(appUrl) || 'https://app.olitechs.co.ke';
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = isAllowedInviteOrigin(origin, { appUrl, allowedOrigins })
    ? origin
    : appOrigin;

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, Access-Control-Request-Headers',
  };
}
