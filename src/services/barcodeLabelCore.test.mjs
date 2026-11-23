import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBarcodeLabelDocument, code39Svg, normalizeCode39 } from './barcodeLabelCore.js';

test('Code 39 barcode generation normalizes and renders a valid SVG', () => {
  assert.equal(normalizeCode39(' ab-123 '), 'AB-123');
  const svg = code39Svg('AB-123');
  assert.match(svg, /<svg/);
  assert.match(svg, /<rect/);
  assert.match(svg, /Code 39 barcode \*AB-123\*/);
});

test('Code 39 rejects empty and unsupported barcode values', () => {
  assert.throws(() => normalizeCode39(''), /required/);
  assert.throws(() => normalizeCode39('SKU_123'), /Code 39 compatible/);
  assert.throws(() => normalizeCode39('A'.repeat(41)), /40 characters/);
});

test('label document repeats selected labels and escapes untrusted product names', () => {
  const html = buildBarcodeLabelDocument([{ name: '<script>alert(1)</script>', sku: 'ABC-123', quantity: 2 }], 'Test Property');
  assert.equal((html.match(/class="label"/g) || []).length, 2);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /@page\{size:50mm 30mm/);
});
