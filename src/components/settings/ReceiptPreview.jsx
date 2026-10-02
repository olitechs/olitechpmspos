import React from 'react';

export default function ReceiptPreview({ settings, data = {}, type = 'RECEIPT' }) {
  const money = (n) => Number(n || 0).toFixed(2);
  const items = data.items || [];
  const drink = (i) => ['drinks','drink','bibite'].includes(String(i.category||'').toLowerCase()) || String(i.center||'').toLowerCase()==='bar';
  const food = items.filter(i=>!drink(i)), drinks = items.filter(drink);
  return <div className="mx-auto w-[302px] rounded-lg bg-white p-4 font-mono text-[11px] leading-[1.35] text-black shadow-xl">
    {settings.logo_url && <img src={settings.logo_url} alt="" className="mx-auto mb-2 max-h-16 max-w-[170px] object-contain" />}
    <div className="text-center font-black">{settings.property_name || 'PROPERTY NAME'}</div>
    <div className="text-center">{settings.address_line1 || 'Address line 1'}<br/>{settings.address_line2 || 'Address line 2'}<br/>{settings.phone || '+254...'}<br/>{settings.email || 'email@example.com'}<br/>{settings.website || 'website'}<br/>KRA PIN: {settings.kra_pin || 'PIN'}</div>
    {settings.extra_header_line && <div className="text-center">{settings.extra_header_line}</div>}
    <div className="my-2 border-t border-dashed border-black"/>
    <div className="text-center font-black">{type==='UNSETTLED'?'UNSETTLED RECEIPT':'FINAL RECEIPT'}</div>
    <div>Waiter: {data.waiter||'Waiter'} <span className="float-right">Table: {data.table||'T1'}</span></div>
    <div>Covers: {data.covers ?? 2} <span className="float-right">Date: {new Date().toLocaleDateString('en-KE')}</span></div>
    {food.length&&drinks.length ? <><div className="my-2 text-center font-black">--- FOOD ---</div>{food.map((i,k)=><Row key={'f'+k} i={i}/>) }<div className="my-2 text-center font-black">--- DRINKS ---</div>{drinks.map((i,k)=><Row key={'d'+k} i={i}/>)}</> : (food.length?food:drinks).map((i,k)=><Row key={k} i={i}/>)}
    <div className="my-2 border-t border-black pt-1 text-right text-lg font-black">TOTAL {data.currency||''} {money(data.total)}</div>
    {type==='RECEIPT'&&<div className="border-t border-dashed pt-2">Payment Method: <b>{data.paymentMethod||'Cash'}</b></div>}
    <div className="mt-3 text-center">{settings.footer_line1||'Thank you.'}<br/>{settings.footer_line2||''}</div>
    <div className="mt-2 text-right font-black">Check No: {data.checkNo||data.orderNumber||'—'}</div>
  </div>;
}
function Row({i}){ return <div className="flex gap-1"><span className="w-7">{i.qty}x</span><span className="flex-1">{i.name}</span><span>{(Number(i.qty||0)*Number(i.price||0)).toFixed(2)}</span></div>; }
