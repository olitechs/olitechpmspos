import React, { useMemo, useState } from 'react';
import { Barcode, Printer, Search } from 'lucide-react';
import { toast } from 'sonner';
import { buildBarcodeLabelDocument, normalizeCode39 } from '@/services/barcodeLabelCore';

export default function StoreBarcodeLabels({ products = [] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState({});
  const [quantities, setQuantities] = useState({});
  const filtered = useMemo(() => products.filter((product) => {
    const value = String(query || '').trim().toLowerCase();
    return !value || [product.name, product.sku, product.barcode].some((field) => String(field || '').toLowerCase().includes(value));
  }), [products, query]);
  const eligible = filtered.filter((product) => {
    try { normalizeCode39(product.barcode || product.sku); return true; } catch { return false; }
  });
  const selectedProducts = products.filter((product) => selected[product.id]);
  const print = () => {
    try {
      const html = buildBarcodeLabelDocument(selectedProducts.map((product) => ({
        ...product, quantity: quantities[product.id] || 1,
      })));
      const popup = window.open('', '_blank');
      if (!popup) { toast.error('Allow pop-ups to print barcode labels.'); return; }
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
    } catch (error) { toast.error(error.message || 'Could not prepare barcode labels.'); }
  };
  return <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-black"><Barcode size={20}/> Barcode Label Printing</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Select inventory items, choose the number of labels and print on a 50 × 30 mm label layout.</p></div>
      <button type="button" onClick={print} disabled={!selectedProducts.length} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[var(--on-primary)] disabled:opacity-40"><Printer size={16}/> Print selected labels ({selectedProducts.length})</button>
    </div>
    <label className="relative block"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, SKU or barcode" className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] pl-9 pr-3 text-sm"/></label>
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full min-w-[600px] text-sm"><thead><tr className="bg-[var(--surface-2)] text-left text-xs"><th className="p-3">Select</th><th className="p-3">Product</th><th className="p-3">SKU / Barcode</th><th className="p-3">Labels</th></tr></thead>
        <tbody>{filtered.map((product) => {
          let value = product.barcode || product.sku || '';
          let valid = true; try { value = normalizeCode39(value); } catch { valid = false; }
          return <tr key={product.id} className="border-t border-[var(--border)]">
            <td className="p-3"><input type="checkbox" aria-label={`Select ${product.name}`} disabled={!valid} checked={!!selected[product.id]} onChange={(event) => setSelected((current) => ({ ...current, [product.id]: event.target.checked }))}/></td>
            <td className="p-3 font-semibold">{product.name}</td><td className="p-3 font-mono text-xs">{value || 'No SKU/barcode'} {!valid && <span className="text-[var(--warning-text)]">· unsupported / missing</span>}</td>
            <td className="p-3"><input type="number" min="1" max="100" value={quantities[product.id] || 1} onChange={(event) => setQuantities((current) => ({ ...current, [product.id]: Math.max(1, Math.min(100, Number(event.target.value) || 1)) }))} className="h-9 w-20 rounded border border-[var(--border)] bg-[var(--canvas)] px-2" aria-label={`Label quantity for ${product.name}`}/></td>
          </tr>;
        })}</tbody></table>
      {filtered.length === 0 && <p className="p-6 text-center text-sm text-[var(--text-muted)]">No matching inventory products.</p>}
    </div>
    <p className="text-xs text-[var(--text-muted)]">{eligible.length} of {filtered.length} visible items have a Code 39 compatible SKU or barcode. Missing or unsupported codes must be corrected on the product record before printing.</p>
  </section>;
}
