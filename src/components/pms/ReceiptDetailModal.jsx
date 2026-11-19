import React from 'react';
import { X, Printer } from 'lucide-react';
import { NAVY, TEAL, SURFACE, SURFACE2, BORDER, MUTED } from '@/data/themePalette';
import { printReceipt as printDirectReceipt } from '@/services/printService';
import { resolveReceiptDocumentPresentation } from '@/services/receiptDocumentCore';

function fmtKes(n) {
  return `KES ${Math.max(0, Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

const PAYMENT_LABEL = { cash: 'Cash', card: 'Card', mpesa: 'M-Pesa', room: 'Room Charge', bank: 'Bank Transfer' };

export default function ReceiptDetailModal({ receipt, onClose }) {
  if (!receipt) return null;
  const { document } = resolveReceiptDocumentPresentation(receipt);
  const items = document.items;

  const printReceipt = async () => {
    const result = await printDirectReceipt('RECEIPT', {
      propertyId: receipt.property_id || receipt.propertyId,
      receiptRecord: receipt,
      orderNumber: document.orderNumber,
      checkNo: document.orderNumber,
      receiptNumber: document.receiptNumber,
    });
    if (!result.ok) {
      window.alert(result.friendlyError || 'The receipt printer is offline or not configured.');
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-[var(--overlay-scrim)] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl" style={{ background: SURFACE }}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4" style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}` }}>
          <h2 className="text-base font-bold" style={{ color: NAVY }}>Receipt {document.displayReference}</h2>
          <button onClick={onClose} className="p-2 rounded-lg" style={{ color: MUTED }}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-xs space-y-1" style={{ color: MUTED }}>
            <div>{document.createdAt ? new Date(document.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date not recorded'}</div>
            <div>Table {document.tableNumber || '—'}{document.roomNumber ? ` · Room ${document.roomNumber} — ${document.guestName || ''}` : ''}</div>
            <div>Paid via: <b style={{ color: NAVY }}>{PAYMENT_LABEL[document.paymentMethod] || document.paymentMethod}</b></div>
            <div className="text-[10px]">{document.snapshotStatus === 'captured' ? 'Company details preserved from receipt issue time.' : 'Legacy receipt: original company header and footer were not captured.'}</div>
            {document.status === 'voided' && <div className="font-bold text-[var(--danger-text)]">VOIDED RECEIPT</div>}
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            {items.length ? items.map((item, index) => (
              <div key={item.id || index} className="flex justify-between gap-3 px-3 py-2 text-sm" style={{ borderBottom: `1px solid ${BORDER}`, background: index % 2 ? SURFACE2 : SURFACE }}>
                <span className="min-w-0">
                  <div>{item.quantity}x {item.name}</div>
                  {item.modifiers.length > 0 && <div className="text-[10px]" style={{ color: MUTED }}>{item.modifiers.join(' · ')}</div>}
                  <div className="text-[10px]" style={{ color: MUTED }}>{fmtKes(item.unitPrice)} each</div>
                </span>
                <b className="shrink-0">{fmtKes(item.lineTotal)}</b>
              </div>
            )) : <div className="p-4 text-sm text-center" style={{ color: MUTED }}>No line items recorded.</div>}
          </div>
          <div className="space-y-1 text-sm" style={{ color: NAVY }}>
            <div className="flex justify-between"><span style={{ color: MUTED }}>Subtotal</span><span>{fmtKes(document.totals.subtotal)}</span></div>
            {document.totals.discountAmount > 0 && <div className="flex justify-between"><span style={{ color: MUTED }}>Discount{receipt.discount_name ? ` · ${receipt.discount_name}` : ''}</span><span>- {fmtKes(document.totals.discountAmount)}</span></div>}
            <div className="flex justify-between"><span style={{ color: MUTED }}>VAT / tax</span><span>{fmtKes(document.totals.vat)}</span></div>
            <div className="flex justify-between pt-1 font-bold" style={{ borderTop: `1px solid ${BORDER}` }}><span>Total</span><span>{fmtKes(document.totals.total)}</span></div>
          </div>
          {document.paymentAllocations.length > 1 && <div className="rounded-lg border p-3 text-xs" style={{ borderColor: BORDER }}>
            <div className="mb-2 font-semibold" style={{ color: NAVY }}>Split tender allocations</div>
            {document.paymentAllocations.map((allocation, index) => <div key={allocation.id || index} className="flex justify-between gap-3 py-1" style={{ color: MUTED }}>
              <span>{PAYMENT_LABEL[allocation.method] || allocation.method}{allocation.reservationId ? ` · Reservation ${allocation.reservationId.slice(0, 8)}` : ''}{allocation.folioChargeId ? ` · Folio ${allocation.folioChargeId.slice(0, 8)}` : ''}</span>
              <b style={{ color: NAVY }}>{fmtKes(allocation.amount)}</b>
            </div>)}
          </div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ border: `1px solid ${BORDER}`, color: MUTED }}>Close</button>
            <button onClick={printReceipt} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold" style={{ background: TEAL, color: 'var(--on-primary)' }}><Printer size={14} /> Print Receipt</button>
          </div>
        </div>
      </div>
    </div>
  );
}
