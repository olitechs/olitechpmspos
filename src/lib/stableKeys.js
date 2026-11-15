// React keys for a positional list whose length is driven by a form value
// (for example one age input per child). The values keep their existing array
// shape; only the DOM identity is stable, so growing or shrinking the list
// never recycles an input that belonged to a different row.
let sequence = 0;

export function createStableKey(prefix = 'item') {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export function resizeStableKeys(keys, count, createKey = createStableKey) {
  const target = Math.max(0, Number(count) || 0);
  const next = Array.isArray(keys) ? keys.slice(0, target) : [];
  while (next.length < target) next.push(createKey());
  return next;
}
