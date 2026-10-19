import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Circle, Grid2X2, Move, Pencil, Save, X } from 'lucide-react';
import { useStore } from '@/data/AppStore';
import { RESERVATIONS_TONIGHT, tableLabel } from '@/data/mockData';
import { BORDER, MUTED_DARK } from '@/data/themePalette';

const SHAPE_KEY = 'tableShapeMode';
const SHAPES = {
  square: { width: 124, height: 112, radius: 12 },
  circle: { width: 124, height: 124, radius: '50%' },
};

function elapsedLabel(openedAt, now) {
  if (!openedAt) return '—';
  const openedAtMs = typeof openedAt === 'number' ? openedAt : new Date(openedAt).getTime();
  if (!Number.isFinite(openedAtMs) || openedAtMs <= 0 || openedAtMs > now) return '—';
  const mins = Math.max(0, Math.floor((now - openedAtMs) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function safeRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

function Tile({ table, session, shape, designMode, onSelect, onMove, now }) {
  const rawStatus = session?.status || table.status || 'free';
  const status = rawStatus === 'unsettled' ? 'bill' : rawStatus;
  const statusMeta = {
    free: { bg:'var(--table-free-bg)', fg:'var(--table-free-fg)', border:'var(--table-free-border)', label:'Open' },
    occupied: { bg:'var(--table-occupied-bg)', fg:'var(--table-occupied-fg)', border:'var(--table-occupied-border)', label:'Occupied' },
    bill: { bg:'var(--table-bill-bg)', fg:'var(--table-bill-fg)', border:'var(--table-bill-border)', label:'Bill printed' },
    reserved: { bg:'var(--room-checkout)', fg:'var(--primary-foreground)', border:'var(--room-checkout)', label:'Reserved' },
    paid: { bg:'var(--success)', fg:'var(--primary-foreground)', border:'var(--success)', label:'Paid / closing' },
  }[status] || { bg:'var(--table-free-bg)', fg:'var(--table-free-fg)', border:'var(--table-free-border)', label:'Open' };
  const geometry = SHAPES[shape] || SHAPES.square;
  const orderCount = Number(session?.orderCount || 0);
  const guests = Number(session?.guests || 0);
  const waiterName = status === 'free'
    ? (table.assignedWaiterName || table.assigned_waiter_name || '')
    : (session?.waiterName || session?.waiter || table.assignedWaiterName || '');
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
    className="floor-table-tile absolute flex flex-col items-stretch justify-start select-none transition-shadow min-h-28"
    style={{left:designMode?table.x:undefined,top:designMode?table.y:undefined,width:geometry.width,minHeight:geometry.height,borderRadius:geometry.radius,
      background:statusMeta.bg,color:statusMeta.fg,
      border:`2px solid ${statusMeta.border}`,boxShadow:table.selected?'0 0 0 3px var(--focus), var(--shadow)':'none',
      position:designMode?'absolute':'relative',cursor:designMode?'grab':'pointer',padding:8,touchAction:'none'}}>
    <div className="flex w-full min-w-0 items-center justify-between gap-1">
      <span className="truncate text-[15px] font-bold leading-tight">{tableLabel(table)}</span>
      <span className="shrink-0 text-[11px] font-medium">{table.seats} seats</span>
    </div>
    <div className="mt-1 text-[12px] font-semibold leading-tight">{statusMeta.label}</div>
    {waiterName && <div className="mt-1 max-w-full truncate text-[12px] leading-tight" title={waiterName}>{waiterName}</div>}
    {status === 'occupied' && <div className="mt-1 text-[12px] font-medium leading-tight">{guests}p • {elapsedLabel(session?.openedAt, now)}</div>}
    {status === 'bill' && <span className="mt-1 max-w-full truncate rounded px-1.5 py-0.5 text-[12px] font-bold uppercase leading-tight" style={{background:'var(--border)',color:'var(--text)'}}>Bill printed</span>}
    {designMode&&<Move size={14} className="absolute bottom-1 right-1 opacity-70"/>}
    {status==='occupied'&&orderCount>0&&<span className="absolute top-1 right-1 min-w-5 h-5 px-1 rounded-full text-[12px] font-bold flex items-center justify-center" style={{background:'var(--primary-soft)',color:'var(--primary)'}}>{orderCount}</span>}
  </button>;
}
export default function FloorPlan({ onTableSelect }) {
  const store = useStore();
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [activeZoneId, setActiveZoneId] = useState(store.zones[0]?.id);
  const [shape, setShape] = useState(() => safeRead(SHAPE_KEY, 'square'));
  const [designMode, setDesignMode] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const zone = store.zones.find((z) => z.id === activeZoneId) || store.zones[0];

  useEffect(() => { localStorage.setItem(SHAPE_KEY, shape); }, [shape]);
  useEffect(() => {
    const ticker = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(ticker);
  }, []);

  const displayTables = useMemo(() => (zone?.tables || []).map((t) => ({
    ...t, zoneId: zone?.id, zoneName: zone?.name,
  })), [zone]);

  const moveTable = (id, x, y) => {
    if (zone?.tables.some((item) => item.id === id) && store.moveTable) store.moveTable(zone.id, id, x, y);
  };

  const saveLayout = async () => {
    try { await store.persistFloorConfiguration(); toast.success('Floor layout saved.'); setDesignMode(false); }
    catch (error) { toast.error(error?.message || 'Could not save floor layout.'); }
  };

  if (!zone) return null;

  const geometry = SHAPES[shape] || SHAPES.square;
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
    <div className="flex flex-col h-full overflow-hidden" style={{ background:'var(--floor-bg)' }}>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0 overflow-x-auto">
        {store.zones.map((z) => (
          <button key={z.id} onClick={() => setActiveZoneId(z.id)} className="px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap shrink-0" style={{ background:z.id===zone.id?'var(--action)':'transparent',color:z.id===zone.id?'var(--action-text)':'var(--text)',border:`1.5px solid ${z.id===zone.id?'var(--action)': 'var(--border)'}` }}>{z.name}</button>
        ))}
        <div className="ml-auto flex items-center gap-1 shrink-0 rounded-xl p-1 bg-[var(--surface)] border-2 border-[var(--border)]">
          <button type="button" onClick={() => setShape('square')} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold" style={{background:shape==='square'?'var(--action)':'var(--surface)',color:shape==='square'?'var(--action-text)':'var(--text)'}}><Grid2X2 size={14} /> Square</button>
          <button type="button" onClick={() => setShape('circle')} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold" style={{background:shape==='circle'?'var(--action)':'var(--surface)',color:shape==='circle'?'var(--action-text)':'var(--text)'}}><Circle size={14} /> Circle</button>
          <button type="button" onClick={() => setDesignMode((v) => !v)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold border-l-2 border-[var(--border)]" style={{ background:designMode?'var(--primary-soft)':'var(--surface)',color:designMode?'var(--primary)':'var(--text)' }}><Pencil size={14} /> Design Layout</button>
          {designMode && <button type="button" onClick={saveLayout} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold" style={{ background:'var(--action)',color:'var(--action-text)' }}><Save size={14} /> Save</button>}
          {designMode && <button type="button" onClick={() => setDesignMode(false)} className="p-2 rounded-lg text-[var(--text)]" title="Close design mode"><X size={14} /></button>}
        </div>
      </div>

      {designMode && <div className="mx-4 mb-2 rounded-lg px-3 py-2 text-xs font-bold bg-[var(--text)] text-[var(--action)] shrink-0">Design Layout ON — drag tables to rearrange them. Amounts are intentionally hidden from the floor.</div>}

      <div className="flex flex-1 gap-4 px-4 pb-4 min-h-0">
        <div className="flex-1 overflow-auto rounded-xl" style={{ background:'var(--floor-bg)', border: `1px solid ${BORDER}` }}>
          {designMode ? (
            <div className="relative" style={{ width: canvasW, height: canvasH, minWidth: '100%' }}>
              {displayTables.map((t) => <Tile key={t.id} table={{ ...t, selected: selectedTableId === t.id }} session={store.getSession(t.id)} shape={shape} designMode={designMode} onSelect={(table) => { setSelectedTableId(table.id); onTableSelect(table); }} onMove={moveTable} now={now} />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 p-5 items-start justify-items-center">
              {displayTables.map((t) => <Tile key={t.id} table={{ ...t, selected: selectedTableId === t.id }} session={store.getSession(t.id)} shape={shape} designMode={false} onSelect={(table) => { setSelectedTableId(table.id); onTableSelect(table); }} onMove={moveTable} now={now} />)}
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
            <Legend label="Open / Available" fill="var(--table-free-bg)" border="var(--table-free-border)" />
            <Legend label="Occupied" fill="var(--table-occupied-bg)" border="var(--table-occupied-border)" />
            <Legend label="Printed / Unsettled" fill="var(--table-bill-bg)" border="var(--table-bill-border)" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ label, fill, border }) { return <div className="flex items-center gap-2 mb-1.5"><span className="w-3.5 h-3.5 rounded shrink-0" style={{ background: fill, border: `2px solid ${border}` }} /><span className="text-xs" style={{ color: MUTED_DARK }}>{label}</span></div>; }
function SummaryRow({ label, value }) { return <div className="flex flex-col"><span className="text-2xl font-mono font-bold" style={{ color:'var(--text)' }}>{value}</span><span className="text-xs leading-tight" style={{ color: MUTED_DARK }}>{label}</span></div>; }
