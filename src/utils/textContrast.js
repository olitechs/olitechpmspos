const YELLOW_BGS = ['#B6FF2E', '#9CE622', '#FFEE32', '#F9A825'];
const DARK_BGS = ['#23262f', '#262B32', '#202020', '#333533'];

function normalizeHex(hex) {
  return String(hex || '').trim().toUpperCase();
}

/**
 * Returns the required foreground color for the OliTechs premium palette.
 * Yellow surfaces always use dark text; dark surfaces always use white text.
 */
export function getTextColorForBg(hex) {
  const normalized = normalizeHex(hex);
  if (YELLOW_BGS.includes(normalized)) return '#23262f';
  if (DARK_BGS.includes(normalized)) return '#FFFFFF';
  return '#23262f';
}

export { YELLOW_BGS, DARK_BGS };
