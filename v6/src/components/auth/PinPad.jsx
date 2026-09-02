import React, { useEffect, useState } from 'react';
import { Delete, Eye, EyeOff, Lock, X } from 'lucide-react';

export default function PinPad({ onSubmit, title = 'Enter PIN', staffName = '', error = '', onClose, autoSubmit = true }) {
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [shake, setShake] = useState(false);
  useEffect(() => { if (error) { setShake(true); const t = setTimeout(() => setShake(false), 450); return () => clearTimeout(t); } }, [error]);
  const append = (digit) => { if (pin.length >= 6) return; const next = `${pin}${digit}`; setPin(next); if (autoSubmit && next.length >= 4) setTimeout(() => onSubmit(next), 80); };
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true">
      <div className={`w-full max-w-sm overflow-hidden rounded-3xl bg-[#090C11] shadow-2xl ${shake ? 'animate-[shake_.45s_ease-in-out]' : ''}`}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFD300] text-[#090C11]"><Lock size={18}/></div><div><div className="font-black text-white">{title}</div>{staffName && <div className="text-xs text-white/55">{staffName}</div>}</div></div>{onClose && <button onClick={onClose} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"><X size={18}/></button>}</div>
        <div className="p-5">
          <div className="mb-4 flex items-center justify-center gap-3 rounded-2xl bg-white px-4 py-4">{Array.from({ length: 6 }).map((_, i) => <span key={i} className={`h-3 w-3 rounded-full border-2 border-[#090C11] ${i < pin.length ? 'bg-[#090C11]' : 'bg-transparent'}`} />)}<button type="button" onClick={() => setShow((v) => !v)} className="ml-2 text-[#090C11]/55 hover:text-[#090C11]" title={show ? 'Hide PIN' : 'Show PIN'}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
          {show && pin && <div className="mb-3 text-center font-mono text-sm font-black tracking-[.4em] text-white">{pin}</div>}
          {error && <div className="mb-3 rounded-xl bg-red-500/15 px-3 py-2 text-center text-xs font-bold text-red-300">{error}</div>}
          <div className="grid grid-cols-3 gap-2">{[1,2,3,4,5,6,7,8,9].map((n) => <button key={n} onClick={() => append(n)} className="h-14 rounded-xl bg-[#FFD300] text-xl font-black text-[#090C11] hover:brightness-95 active:scale-95">{n}</button>)}<button onClick={() => setPin('')} className="h-14 rounded-xl border border-white/15 bg-white/10 text-xs font-black text-white hover:bg-white/15">Clear</button><button onClick={() => append(0)} className="h-14 rounded-xl bg-[#FFD300] text-xl font-black text-[#090C11] hover:brightness-95 active:scale-95">0</button><button onClick={() => setPin((v) => v.slice(0,-1))} className="h-14 rounded-xl border border-white/15 bg-white/10 text-white hover:bg-white/15"><Delete className="mx-auto" size={19}/></button></div>
          <button onClick={() => pin.length >= 4 && onSubmit(pin)} disabled={pin.length < 4} className="mt-3 w-full rounded-xl bg-white py-3 text-sm font-black text-[#090C11] disabled:cursor-not-allowed disabled:opacity-40">Submit PIN</button>
          <div className="mt-3 text-center text-[10px] font-semibold uppercase tracking-widest text-white/35">4–6 digit secure staff PIN</div>
        </div>
      </div>
    </div>
  );
}
