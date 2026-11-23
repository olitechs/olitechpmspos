const CODE39 = Object.freeze({
  '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn',
  '4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw',
  '8':'wnnwnnwnn','9':'nnwwnnwnn','A':'wnnnnwnnw','B':'nnwnnwnnw',
  'C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn',
  'G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn',
  'K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww',
  'O':'wnnnwnnwn','P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn',
  'S':'nnwnnnwwn','T':'nnnnwnwwn','U':'wwnnnnnnw','V':'nwwnnnnnw',
  'W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn',
  '-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','$':'nwnwnwnnn',
  '/':'nwnwnnnwn','+':'nwnnnwnwn','%':'nnnwnwnwn','*':'nwnnwnwnn',
});

export function normalizeCode39(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) throw new Error('A barcode or SKU is required.');
  if (normalized.length > 40) throw new Error('Barcode values must be 40 characters or fewer for this label format.');
  if ([...normalized].some((character) => !CODE39[character] || character === '*')) {
    throw new Error('Use a Code 39 compatible SKU/barcode: A–Z, 0–9, space, - . $ / + %.');
  }
  return normalized;
}

export function code39Svg(value, { height = 48, narrow = 2, wide = 5 } = {}) {
  const data = `*${normalizeCode39(value)}*`;
  let x = 0;
  const bars = [];
  [...data].forEach((character, characterIndex) => {
    const pattern = CODE39[character];
    [...pattern].forEach((width, index) => {
      const size = width === 'w' ? wide : narrow;
      if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${size}" height="${height}" />`);
      x += size;
    });
    if (characterIndex < data.length - 1) x += narrow;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Code 39 barcode ${data}" viewBox="0 0 ${x} ${height}" width="100%" height="${height}" preserveAspectRatio="none"><rect width="${x}" height="${height}" fill="Canvas"/><g fill="CanvasText">${bars.join('')}</g></svg>`;
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
})[character]);

export function buildBarcodeLabelDocument(items, propertyName = 'OliTechs Stores') {
  const labels = [];
  for (const item of items || []) {
    const value = normalizeCode39(item.barcode || item.sku);
    const quantity = Math.max(1, Math.min(100, Math.floor(Number(item.quantity) || 1)));
    const barcode = code39Svg(value);
    for (let index = 0; index < quantity; index += 1) {
      labels.push(`<article class="label"><strong>${escapeHtml(item.name)}</strong><div class="barcode">${barcode}</div><small>${escapeHtml(value)}</small></article>`);
    }
  }
  if (!labels.length) throw new Error('Select at least one product to print.');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Inventory barcode labels</title><style>
    @page{size:50mm 30mm;margin:2mm}*{box-sizing:border-box}body{margin:0;font:10px Arial,sans-serif;color:CanvasText}
    .sheet{display:grid;grid-template-columns:50mm;gap:0;align-items:start}
    .label{width:46mm;height:26mm;padding:1.5mm;border:0.2mm solid #ddd;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden;break-inside:avoid;break-after:page}
    .label strong{font-size:9px;line-height:1.15;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .barcode{width:100%;height:13mm}.barcode svg{display:block;width:100%;height:100%}
    .label small{font:8px monospace;letter-spacing:.5px}
    @media screen{body{padding:12px;background:#eee}.sheet{margin:auto}.label{background:Canvas}}
    @media print{body{padding:0}.sheet{gap:0}.label{border:0}.label:last-child{break-after:auto}}
  </style></head><body><main class="sheet">${labels.join('')}</main><script>window.addEventListener('load',()=>{window.focus();window.print()});</script></body></html>`;
}
