import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Grid2X2, Move, Pencil, Save, X } from 'lucide-react';
import { useStore } from '@/data/AppStore';
import { RESERVATIONS_TONIGHT, tableLabel } from '@/data/mockData';
import { BORDER, MUTED_DARK } from '@/data/themePalette';

const SHAPE_KEY = 'tableShapeMode';
const POSITION_KEY = 'tableLayoutPositions';
const SHAPES = {
  square: { width: 112, height: 84, radius: 12 },
  circle: { width: 88, height: 88, radius: '50%' },
};

function elapsedLabel(openedAt) {
  const mins = Math.max(0, Math.floor((Date.now() - openedAt) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function safeRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

function Tile({ table, session, shape, designMode, onSelect, onMove }) {
  const rawStatus = session?.status || table.status || 'free';
  const status = rawStatus === 'unsettled' ? 'bill' : rawStatus;
  const statusMeta = {
    free: { color:'var(--table-free)', label:'Free' },
    occupied: { color:'var(--table-occupied)', label:'Occupied' },
    bill: { color:'var(--table-bill)', label:'Awaiting payment' },
    reserved: { color:'var(--table-reserved)', label:'Reserved' },
    paid: { color:'var(--table-paid)', label:'Paid / closing' },
  }[status] || { color:'var(--table-free)', label:'Free' };
  const geometry = SHAPES[shape];
  const orderCount = Number(session?.orderCount || 0);
  const guests = Number(session?.guests || 0);
  const dragRef = useRef(null);
  const movedRef = useRef(false);

  const pointerDown = (e) => {
    if (!designMode) return;
    e.preventDefault(); movedRef.current = false;
    dragRef.current = { startX:e.clientX,startY:e.clientY,x:table.x,y:table.y };
    const move = (event) => {
      if (!dragRef.current) return;
      const dx=event.clientX-dragRef.current.startX, dy=event.clientY-dragRef.current.startY;
      if(Math.abs(dx)+Math.abs(dy)>4) movedRef.current=true;
      onMove(table.id,Math.max(8,dragRef.current.x+dx),Math.max(8,dragRef.current.y+dy));
    };
    const up=()=>{dragRef.current=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};
    window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
  };

  return <button type="button" onPointerDown={pointerDown}
    onClick={()=>{if(!designMode||!movedRef.current)onSelect(table)}}
    title={designMode?`Drag ${tableLabel(table)}`:`Open ${tableLabel(table)} — ${statusMeta.label}`}
    aria-label={`${tableLabel(table)}, ${statusMeta.label}`}
    className="absolute flex flex-col items-center justify-center select-none overflow-hidden transition-shadow min-h-12"
    style={{left:designMode?table.x:undefined,top:designMode?table.y:undefined,width:geometry.width,height:geometry.height,borderRadius:geometry.radius,
      background:status==='free'?'var(--surface)':statusMeta.color,color:status==='free'?'var(--text)':'var(--action-text)',
      border:`2px solid ${statusMeta.color}`,boxShadow:table.selected?'0 0 0 3px var(--focus), var(--shadow)':'none',
      position:designMode?'absolute':'relative',cursor:designMode?'grab':'pointer',padding:8,touchAction:'none'}}>
    <div className="flex items-center justify-center gap-2 w-full min-w-0">
      <span className="font-black text-[13px] leading-none truncate max-w-[72px]">{tableLabel(table)}</span>
      <span className="shrink-0" style={{width:8,height:8,borderRadius:'50%',background:statusMeta.color,border:'1px solid var(--surface)'}}/>
    </div>
    <div className="font-bold text-[10px] leading-tight mt-1">{statusMeta.label}</div>
    <div className="font-bold text-[10px] leading-tight mt-1">{table.seats} seats</div>
    {status==='occupied'&&<div className="font-black text-[10px] leading-tight mt-1 truncate max-w-full">{guests}p • {elapsedLabel(session.openedAt)}</div>}
    {status==='bill'&&<span className="mt-1 max-w-full truncate rounded px-1.5 py-0.5 text-[8px] font-black uppercase leading-tight" style={{background:'var(--table-bill)',color:'var(--action-text)'}}>BILL PRINTED</span>}
    {designMode&&<Move size={11} className="absolute bottom-1 opacity-60"/>}
    {status==='occupied'&&orderCount>0&&<span className="absolute top-1 right-1 min-w-5 h-5 px-1 rounded-full text-[8px] font-black flex items-center justify-center" style={{background:'var(--text)',color:'var(--surface)'}}>{orderCount}</span>}
  </button>;
}
export default function FloorPlan({ onTableSelect }) {
  const store = useStore();
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [activeZoneId, setActiveZoneId] = useState(store.zones[0]?.id);
  const [shape, setShape] = useState(() => safeRead(SHAPE_KEY, 'square'));
  const [designMode, setDesignMode] = useState(false);
  const [positions, setPositions] = useState(() => safeRead(POSITION_KEY, {}));
  const zone = store.zones.find((z) => z.id === activeZoneId) || store.zones[0];

  useEffect(() => { localStorage.setItem(SHAPE_KEY, shape); }, [shape]);
  useEffect(() => { localStorage.setItem(POSITION_KEY, JSON.stringify(positions)); }, [positions]);

  const displayTables = useMemo(() => (zone?.tables || []).map((t) => ({
    ...t,
    ...(positions[t.id] || {}),
    zoneId: zone?.id,
    zoneName: zone?.name,
  })), [zone, positions]);

  const moveTable = (id, x, y) => {
    setPositions((prev) => ({ ...prev, [id]: { x: Math.round(x), y: Math.round(y) } }));
    const t = zone?.tables.find((item) => item.id === id);
    if (t && store.moveTable) store.moveTable(zone.id, id, x, y);
  };

  const saveLayout = () => {
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(positions)); } catch { /* ignore storage errors */ }
    setDesignMode(false);
  };

  if (!zone) return null;

  const geometry = SHAPES[shape];
  const canvasW = Math.max(620, ...displayTables.map((t) => t.x + geometry.width + 24));
  const canvasH = Math.max(430, ...displayTables.map((t) => t.y + geometry.height + 24));
  let covers = 0, occupied = 0, openChecks = 0;
  store.zones.forEach((z) => z.tables.forEach((t) => {
    const s = store.getSession(t.id);
    if (!s) return;
    if (s.status === 'occupied') { occupied++; openChecks++; covers += s.guests || 0; }
    else if (s.status === 'unsettled') { openChecks++; covers += s.guests || 0; }
  }));

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:'var(--bg)' }}>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0 overflow-x-auto">
        {store.zones.map((z) => (
          <button key={z.id} onClick={() => setActiveZoneId(z.id)} className="px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap shrink-0" style={{ background:z.id===zone.id?'var(--action)':'transparent',color:z.id===zone.id?'var(--action-text)':'var(--text)',border:`1.5px solid ${z.id===zone.id?'var(--action)': 'var(--border)'}` }}>{z.name}</button>
        ))}
        <div className="ml-auto flex items-center gap-1 shrink-0 rounded-xl p-1 bg-[var(--surface)] border-2 border-[var(--border)]">
          <button type="button" onClick={() => setShape('square')} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-black" style={{background:shape==='square'?'var(--action)':'var(--surface)',color:shape==='square'?'var(--action-text)':'var(--text)'}}><Grid2X2 size={14} /> Square</button>
          <button type="button" onClick={() => setShape('circle')} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-black" style={{background:shape==='circle'?'var(--action)':'var(--surface)',color:shape==='circle'?'var(--action-text)':'var(--text)'}}><Circle size={14} /> Circle</button>
          <button type="button" onClick={() => setDesignMode((v) => !v)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-black border-l-2 border-[var(--border)]" style={{ background:designMode?'var(--text)':'var(--surface)',color:designMode?'var(--action)':'var(--text)' }}><Pencil size={14} /> Design Layout</button>
          {designMode && <button type="button" onClick={saveLayout} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-black" style={{ background:'var(--action)',color:'var(--action-text)' }}><Save size={14} /> Save</button>}
          {designMode && <button type="button" onClick={() => setDesignMode(false)} className="p-2 rounded-lg text-[var(--text)]" title="Close design mode"><X size={14} /></button>}
        </div>
      </div>

      {designMode && <div className="mx-4 mb-2 rounded-lg px-3 py-2 text-xs font-bold bg-[var(--text)] text-[var(--action)] shrink-0">Design Layout ON — drag tables to rearrange them. Amounts are intentionally hidden from the floor.</div>}

      <div className="flex flex-1 gap-4 px-4 pb-4 min-h-0">
        <div className="flex-1 overflow-auto rounded-xl" style={{ background:'var(--surface)', border: `1px solid ${BORDER}` }}>
          {designMode ? (
            <div className="relative" style={{ width: canvasW, height: canvasH, minWidth: '100%' }}>
              {displayTables.map((t) => <Tile key={t.id} table={{ ...t, selected: selectedTableId === t.id }} session={store.getSession(t.id)} shape={shape} designMode={designMode} onSelect={(table) => { setSelectedTableId(table.id); onTableSelect(table); }} onMove={moveTable} />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 p-5 items-center justify-items-center">
              {displayTables.map((t) => <Tile key={t.id} table={{ ...t, selected: selectedTableId === t.id }} session={store.getSession(t.id)} shape={shape} designMode={false} onSelect={(table) => { setSelectedTableId(table.id); onTableSelect(table); }} onMove={moveTable} />)}
            </div>
          )}
        </div>

        <div className="hidden xl:flex shrink-0 rounded-xl p-4 flex-col gap-3" style={{ background:'var(--surface)', width: 180 }}>
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color:'var(--action)' }}>Today</h3>
          <SummaryRow label="Covers Seated" value={covers} />
          <SummaryRow label="Tables Occupied" value={occupied} />
          <SummaryRow label="Open Checks" value={openChecks} />
          <SummaryRow label="Reservations Tonight" value={RESERVATIONS_TONIGHT} />
          <div className="mt-2 pt-3" style={{ borderTop:'1px solid var(--border)' }}>
            <h4 className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color:'var(--action)' }}>Legend</h4>
            <Legend label="Open / Available" fill="#EAB308" border="#CA8A04" />
            <Legend label="Occupied" fill="#EF4444" border="#DC2626" />
            <Legend label="Printed / Unsettled" fill="#FFFFFF" border="#D1D5DB" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ label, fill, border }) { return <div className="flex items-center gap-2 mb-1.5"><span className="w-3.5 h-3.5 rounded shrink-0" style={{ background: fill, border: `2px solid ${border}` }} /><span className="text-xs" style={{ color: MUTED_DARK }}>{label}</span></div>; }
function SummaryRow({ label, value }) { return <div className="flex flex-col"><span className="text-2xl font-mono font-bold text-white">{value}</span><span className="text-xs leading-tight" style={{ color: MUTED_DARK }}>{label}</span></div>; }
