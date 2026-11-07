import React from 'react';
import { AlertTriangle, ArrowRight, Boxes, CalendarDays, MapPin, Package, Tag } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const MONEY = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 });

function value(value) {
  return value == null || value === '' ? 'Not recorded' : String(value);
}

function Stat({ label, value: statValue, hint }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
    <p className="mt-1 text-lg font-black text-[var(--text)]">{statValue}</p>
    {hint && <p className="mt-1 text-[10px] text-[var(--text-muted)]">{hint}</p>}
  </div>;
}

export default function StorekeeperAlertDetails({ alert, open, onOpenChange, canSeeCosts = false }) {
  if (!alert) return null;
  const product = alert.product || {};
  const stock = Number(product.current_stock);
  const unit = product.unit || 'units';
  const unitCost = Number(product.cost_price);
  const stockValue = Number.isFinite(stock) && Number.isFinite(unitCost) && canSeeCosts
    ? MONEY.format(stock * unitCost)
    : canSeeCosts ? 'Unavailable' : 'Restricted';
  const severity = alert.severity === 'critical'
    ? 'Critical'
    : alert.severity === 'high' ? 'High priority' : alert.severity === 'medium' ? 'Action needed' : 'Watch';

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-2xl border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--text)] shadow-[var(--shadow-overlay)]">
      <div className="border-b border-[var(--border)] bg-[var(--sidebar)] px-5 py-5 pr-12 sm:px-6">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${alert.severity === 'critical' ? 'bg-[var(--danger-soft)] text-[var(--danger-text)]' : alert.severity === 'high' ? 'bg-[var(--warning-soft)] text-[var(--warning-text)]' : 'bg-[var(--primary-soft)] text-[var(--deep-lagoon)]'}`}><AlertTriangle size={12}/>{severity}</span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-bold text-[var(--text-muted)]">{String(alert.type || 'alert').replaceAll('-', ' ')}</span>
          </div>
          <DialogTitle className="mt-3 text-xl font-black leading-tight">{product.name || 'Inventory activity'}</DialogTitle>
          <DialogDescription className="mt-1 leading-5">{alert.message || 'Review the recorded inventory condition and choose an operational next step.'}</DialogDescription>
        </DialogHeader>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        <section aria-label="Stock position" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="On hand" value={`${Number.isFinite(stock) ? stock.toLocaleString('en-KE') : '—'} ${unit}`} />
          <Stat label="Reorder level" value={`${value(product.min_stock)} ${unit}`} />
          <Stat label="Maximum / par" value={`${value(product.max_stock)} ${unit}`} />
          <Stat label="Current value" value={stockValue} hint="At current unit cost" />
        </section>

        <section aria-label="Item information" className="rounded-xl border border-[var(--border)] p-4">
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[var(--text-muted)]"><Package size={14}/> Item details</h3>
          <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
            <Detail icon={Tag} label="SKU / barcode" value={[product.sku, product.barcode].filter(Boolean).join(' · ') || 'Not recorded'} />
            <Detail icon={Boxes} label="Category / department" value={[product.category, product.production_center || product.department].filter(Boolean).join(' · ') || 'Not recorded'} />
            <Detail icon={MapPin} label="Saved stock location" value={value(product.location)} />
            <Detail icon={Package} label="Supplier" value={product.supplier?.name || product.supplier_name || 'Not recorded'} />
            {alert.expiryDate && <Detail icon={CalendarDays} label="Expiry date" value={alert.expiryDate} />}
          </dl>
        </section>

        <section className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--canvas)] p-3">
          <p className="text-xs font-bold text-[var(--text)]">Operational context</p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">This inspection uses the current property-scoped product record. Historical values, batch-level expiry or movement location are shown only when the source record provides them; no missing details are inferred.</p>
        </section>
      </div>

      <DialogFooter className="sticky bottom-0 flex-row flex-wrap gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:px-6">
        <Link to="/stores/purchasing" onClick={() => onOpenChange(false)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-[var(--on-primary)] hover:bg-[var(--deep-lagoon)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">Raise PO <ArrowRight size={14}/></Link>
        <Link to="/stores/transfers" onClick={() => onOpenChange(false)} className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg border border-[var(--border)] px-3 text-xs font-bold text-[var(--text)] hover:bg-[var(--sidebar)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">Transfer</Link>
        <Link to="/stores/inventory/counts" onClick={() => onOpenChange(false)} className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg border border-[var(--border)] px-3 text-xs font-bold text-[var(--text)] hover:bg-[var(--sidebar)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">Start count</Link>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function Detail({ icon: Icon, label, value: detailValue }) {
  return <div className="flex min-w-0 items-start gap-2"><Icon size={14} className="mt-0.5 shrink-0 text-[var(--primary)]"/><div className="min-w-0"><dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{label}</dt><dd className="mt-0.5 break-words text-xs font-semibold text-[var(--text)]">{detailValue}</dd></div></div>;
}
