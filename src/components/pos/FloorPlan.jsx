import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Grid2X2, Move, Pencil, Save, X } from 'lucide-react';
import { useStore } from '@/data/AppStore';
import { RESERVATIONS_TONIGHT, tableLabel } from '@/data/mockData';

const SHAPE_KEY = 'tableShapeMode';
const POSITION_KEY = 'tableLayoutPositions';
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
    free: { bg: 'var(--room-clean)', fg: 'var(--room-clean-foreground)', border: 'var(--room-clean)', label: 'Open' },
    occupied: { bg: 'var(--room-occupied)', fg: 'var(--on-primary)', border: 'var(--room-occupied)', label: 'Occupied' },
    bill: { bg: 'var(--danger)', fg: 'var(--danger-foreground)', border: 'var(--danger)', label: 'Bill printed' },
    reserved: { bg: 'var(--room-checkout)', fg: 'var(--on-primary)', border: 'var(--room-checkout)', label: 'Reserved' },
    paid: { bg: 'var(--success)', fg: 'var(--on-primary)', border: 'var(--success)', label: 'Paid / closing' },
  }[status] || { bg: 'var(--room-clean)', fg: 'var(--room-clean-foreground)', border: 'var(--room-clean)', label: 'Open' };
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
    className="floor-table-tile absolute flex min-h-28 select-none flex-col items-stretch justify-start overflow-hidden rounded-xl p-2 transition-shadow"
    style={{left:designMode?table.x:undefined,top:designMode?table.y:undefined,width:geometry.width,minHeight:geometry.height,borderRadius:geometry.radius,
      background:statusMeta.bg,color:statusMeta.fg,
      border:`2px solid ${statusMeta.border}`,boxShadow:table.selected?'0 0 0 3px var(--focus), var(--shadow)':'none',
      position:designMode?'absolute':'relative',cursor:designMode?'grab':'pointer',touchAction:'none'}}>
    <div className="flex w-full min-w-0 items-start justify-between gap-2">
      <span className="min-w-0 truncate text-[15px] font-bold leading-tight">{tableLabel(table)}</span>
      <span className="shrink-0 text-[11px] font-semibold">{table.seats} seats</span>
    </div>
    <div className="mt-2 flex min-w-0 items-center justify-between gap-1">
      <span className="truncate text-sm font-bold leading-tight">{statusMeta.label}</span>
      {status === 'occupied' && orderCount > 0 && <span className="shrink-0 rounded-full bg-[var(--primary-soft)] px-2 py-1 text-[11px] font-bold text-[var(--primary)]">{orderCount} items</span>}
    </div>
    {waiterName && <div className="mt-1 max-w-full truncate text-[12px] leading-tight" title={waiterName}>{waiterName}</div>}
    {status === 'occupied' && <div className="mt-1 text-[12px] font-medium leading-tight">{guests}p • {elapsedLabel(session?.openedAt, now)}</div>}
    {status === 'bill' && <span className="mt-1 max-w-full truncate rounded bg-[var(--danger-soft)] px-1.5 py-1 text-[11px] font-bold uppercase leading-tight text-[var(--danger-text)]">Bill printed</span>}
    {designMode&&<Move size={14} className="absolute bottom-1 right-1 opacity-80"/>}
  </button>;
}
export default function FloorPlan({ onTableSelect }) {
  const store = useStore();
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [activeZoneId, setActiveZoneId] = useState(store.zones[0]?.id);
  const [shape, setShape] = useState(() => safeRead(SHAPE_KEY, 'square'));
  const [designMode, setDesignMode] = useState(false);
  const [positions, setPositions] = useState(() => safeRead(POSITION_KEY, {}));
  const [now, setNow] = useState(() => Date.now());
  const zone = store.zones.find((z) => z.id === activeZoneId) || store.zones[0];

  useEffect(() => { localStorage.setItem(SHAPE_KEY, shape); }, [shape]);
  useEffect(() => { localStorage.setItem(POSITION_KEY, JSON.stringify(positions)); }, [positions]);
  useEffect(() => {
    const ticker = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(ticker);
  }, []);

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

  if (!zone) return (
    <div role="status" aria-live="polite" className="flex h-full min-h-48 items-center justify-center bg-[var(--canvas)] p-6 text-center">
      <div className="max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-black text-[var(--text)]">No floor zones configured</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">Add a floor zone and tables in Settings → Table Setup before seating guests.</p>
      </div>
    </div>
  );

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--canvas)] text-[var(--text)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 pb-2 pt-3 lg:px-4">
        {store.zones.map((z) => (
          <button key={z.id} type="button" onClick={() => setActiveZoneId(z.id)} className={`min-h-11 shrink-0 whitespace-nowrap rounded-full border-2 px-5 text-sm font-bold ${z.id===zone.id?'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]':'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--primary-soft)]'}`}>{z.name}</button>
        ))}
        <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] p-1 lg:ml-auto">
          <button type="button" onClick={() => setShape('square')} className={`flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-bold ${shape==='square'?'bg-[var(--primary)] text-[var(--on-primary)]':'bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--primary-soft)]'}`}><Grid2X2 size={14} /> Square</button>
          <button type="button" onClick={() => setShape('circle')} className={`flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-bold ${shape==='circle'?'bg-[var(--primary)] text-[var(--on-primary)]':'bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--primary-soft)]'}`}><Circle size={14} /> Circle</button>
          <button type="button" onClick={() => setDesignMode((v) => !v)} className={`flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-bold ${designMode?'bg-[var(--primary-soft)] text-[var(--primary)]':'bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--primary-soft)]'}`}><Pencil size={14} /> Design Layout</button>
          {designMode && <button type="button" onClick={saveLayout} className="flex min-h-11 items-center gap-1 rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-[var(--on-primary)]"><Save size={14} /> Save</button>}
          {designMode && <button type="button" onClick={() => setDesignMode(false)} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text)] hover:bg-[var(--primary-soft)]" title="Close design mode" aria-label="Close design mode"><X size={14} /></button>}
        </div>
      </div>

      {designMode && <div className="mx-3 mb-2 shrink-0 rounded-lg bg-[var(--primary)] px-3 py-3 text-sm font-bold text-[var(--on-primary)] lg:mx-4">Design Layout ON — drag tables to rearrange them. Amounts are intentionally hidden from the floor.</div>}

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-3 lg:flex-row lg:px-4 lg:pb-4">
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--canvas)]">
          {displayTables.length === 0 ? (
            <div role="status" aria-live="polite" className="flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center">
              <h2 className="text-base font-black text-[var(--text)]">No tables in {zone.name}</h2>
              <p className="max-w-md text-sm text-[var(--text-muted)]">Add tables in Settings → Table Setup, then return to the floor to start service.</p>
            </div>
          ) : designMode ? (
            <div className="relative" style={{ width: canvasW, height: canvasH, minWidth: '100%' }}>
              {displayTables.map((t) => <Tile key={t.id} table={{ ...t, selected: selectedTableId === t.id }} session={store.getSession(t.id)} shape={shape} designMode={designMode} onSelect={(table) => { setSelectedTableId(table.id); onTableSelect(table); }} onMove={moveTable} now={now} />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 items-start justify-items-center gap-4 p-4 sm:grid-cols-3 xl:grid-cols-5">
              {displayTables.map((t) => <Tile key={t.id} table={{ ...t, selected: selectedTableId === t.id }} session={store.getSession(t.id)} shape={shape} designMode={false} onSelect={(table) => { setSelectedTableId(table.id); onTableSelect(table); }} onMove={moveTable} now={now} />)}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 lg:hidden">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--primary)]">Today</h3>
          <div className="grid grid-cols-2 gap-3"><SummaryRow label="Covers Seated" value={covers} /><SummaryRow label="Tables Occupied" value={occupied} /><SummaryRow label="Open Checks" value={openChecks} /><SummaryRow label="Reservations Tonight" value={RESERVATIONS_TONIGHT} /></div>
        </div>
        <aside className="hidden w-48 shrink-0 flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 xl:flex">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--primary)]">Today</h3>
          <SummaryRow label="Covers Seated" value={covers} />
          <SummaryRow label="Tables Occupied" value={occupied} />
          <SummaryRow label="Open Checks" value={openChecks} />
          <SummaryRow label="Reservations Tonight" value={RESERVATIONS_TONIGHT} />
          <div className="mt-2 border-t border-[var(--border)] pt-3">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--primary)]">Legend</h4>
            <Legend label="Open / Available" fill="var(--room-clean)" border="var(--room-clean)" />
            <Legend label="Occupied" fill="var(--room-occupied)" border="var(--room-occupied)" />
            <Legend label="Reserved" fill="var(--room-checkout)" border="var(--room-checkout)" />
            <Legend label="Printed / Unsettled" fill="var(--danger)" border="var(--danger)" />
            <Legend label="Paid / closing" fill="var(--success)" border="var(--success)" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Legend({ label, fill, border }) { return <div className="mb-1.5 flex items-center gap-2"><span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: fill, border: `2px solid ${border}` }} /><span className="text-xs text-[var(--text-muted)]">{label}</span></div>; }
function SummaryRow({ label, value }) { return <div className="flex min-w-0 flex-col"><span className="text-2xl font-bold text-[var(--text)]">{value}</span><span className="text-xs leading-tight text-[var(--text-muted)]">{label}</span></div>; }
