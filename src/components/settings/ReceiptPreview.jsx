import React from 'react';
import { buildUnsettledReceiptText } from '@/services/printTemplates';

export default function ReceiptPreview({ settings, data = {}, type = 'RECEIPT', printer = { paper_width: '80mm' } }) {
  if (type === 'UNSETTLED') {
    const text = buildUnsettledReceiptText(settings, data, { printer, copyLabel: 'CUSTOMER COPY', now: new Date('2026-11-05T12:46:00.000Z') })
      .replace(/\x1D\x21\x01|\x1D\x21\x00|\x1BE\x01|\x1BE\x00/g, '');
    return <div className="mx-auto w-full max-w-[380px] overflow-visible rounded-lg bg-[var(--print-paper)] p-4 shadow-xl">
      {settings.logo_url && <img src={settings.logo_url} alt="Company logo" className="mx-auto mb-3 max-h-16 max-w-[170px] object-contain [filter:grayscale(1)_contrast(2)]" />}
      <pre className="m-0 overflow-visible whitespace-pre-wrap bg-[var(--print-paper)] p-0 font-sans text-[11px] font-normal leading-[1.4] tracking-[0.01em] text-[var(--print-ink)]">{text}</pre>
    </div>;
  }
  const money = (n) => Number(n || 0).toFixed(2);
  const items = data.items || [];
  const drink = (i) => ['drinks','drink','bibite'].includes(String(i.category||'').toLowerCase()) || String(i.center||'').toLowerCase()==='bar';
  const food = items.filter(i=>!drink(i)), drinks = items.filter(drink);
  return <div className="mx-auto w-[302px] receipt-preview-paper rounded-lg bg-[var(--print-paper)] p-4 font-sans text-[11px] font-normal leading-[1.4] tracking-[0.01em] text-[var(--print-ink)] shadow-xl">
    {settings.logo_url && <img src={settings.logo_url} alt="" className="mx-auto mb-2 max-h-16 max-w-[170px] object-contain [filter:grayscale(1)_contrast(2)]" />}
    <div className="text-center font-black">{settings.property_name || 'PROPERTY NAME'}</div>
    <div className="text-center">{settings.address_line1 || 'Address line 1'}<br/>{settings.address_line2 || 'Address line 2'}<br/>{settings.phone || '+254...'}<br/>{settings.email || 'email@example.com'}<br/>{settings.website || 'website'}<br/>KRA PIN: {settings.kra_pin || 'PIN'}</div>
    {settings.extra_header_line && <div className="text-center">{settings.extra_header_line}</div>}
    <div className="my-2 border-t border-dashed border-[var(--print-border)]"/>
    <div className="text-center font-black">{type==='UNSETTLED'?'UNSETTLED RECEIPT':'FINAL RECEIPT'}</div>
    <div>Waiter: {data.waiter||'Waiter'} <span className="float-right">Table: {data.table||'T1'}</span></div>
    <div>Covers: {data.covers ?? 2} <span className="float-right">Date: {new Date().toLocaleDateString('en-KE')}</span></div>
    {food.length&&drinks.length ? <><div className="my-2 text-center font-black">--- FOOD ---</div>{food.map((i,k)=><Row key={'f'+k} i={i}/>) }<div className="my-2 text-center font-black">--- DRINKS ---</div>{drinks.map((i,k)=><Row key={'d'+k} i={i}/>)}</> : (food.length?food:drinks).map((i,k)=><Row key={k} i={i}/>)}
    <div className="my-2 border-t border-[var(--print-border)] pt-1 text-right text-lg font-black">TOTAL {data.currency||''} {money(data.total)}</div>
    {type==='RECEIPT'&&<div className="border-t border-dashed border-[var(--print-border)] pt-2">Payment Method: <b>{data.paymentMethod||'Cash'}</b></div>}
    {type==='RECEIPT'&&<div className="mt-3 text-center">{settings.footer_line1||'Thank you.'}<br/>{settings.footer_line2||''}</div>}
    <div className="mt-2 text-right font-black">Check No: {data.checkNo||data.orderNumber||'—'}</div>
    {(data.voidedCount || data.voidedItems?.length) ? <div className="mt-2 border-t border-dashed border-[var(--print-border)] pt-2 text-center text-[9px] font-black">{Number(data.voidedCount || data.voidedItems?.length || 0)} item{Number(data.voidedCount || data.voidedItems?.length || 0) === 1 ? '' : 's'} voided - See void slip #{data.voidSlipNumber || '—'}</div> : null}
  </div>;
}
function Row({i}){ return <div className="flex gap-1 text-[12px] font-normal leading-relaxed"><span className="w-7">{i.qty}x</span><span className="flex-1">{i.name}</span><span>{(Number(i.qty||0)*Number(i.price||0)).toFixed(2)}</span></div>; }
