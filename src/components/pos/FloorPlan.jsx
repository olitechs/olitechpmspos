import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Grid2X2, Move, Pencil, Save, X } from 'lucide-react';
import { useStore } from '@/data/AppStore';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import { tableLabel } from '@/lib/posTables';

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

// Active sessions are authoritative operational records. If a session's table
// is missing from the saved floor layout, surface it as a recovered floor tile
// instead of hiding an open order that still blocks shift closing.
function buildFloorZones(configuredZones, sessions) {
  const zones = Array.isArray(configuredZones) ? configuredZones : [];
  const knownTableIds = new Set(zones.flatMap((zone) => (zone.tables || []).map((table) => String(table.id))));
  const orphanSessions = Object.entries(sessions || {}).filter(([tableKey, session]) => (
    session && session.status !== 'closed' && !knownTableIds.has(String(tableKey))
  ));
  if (!orphanSessions.length) return zones;

  const recoveredByZone = new Map();
  orphanSessions.forEach(([tableKey, session]) => {
    const groupId = session.zoneId || '__recovered_active_sessions__';
    const existing = recoveredByZone.get(groupId) || [];
    const index = existing.length;
    existing.push({
      id: tableKey,
      number: String(session.tableNumber || tableKey),
      seats: Math.max(1, Number(session.guests) || 4),
      x: 24 + (index % 5) * 148,
      y: 24 + Math.floor(index / 5) * 136,
      w: 124,
      h: 112,
      recovered: true,
    });
    recoveredByZone.set(groupId, existing);
  });

  let result = [...zones];
  recoveredByZone.forEach((tables, groupId) => {
    const existingIndex = result.findIndex((zone) => String(zone.id) === String(groupId));
    if (existingIndex >= 0) {
      result[existingIndex] = { ...result[existingIndex], tables: [...(result[existingIndex].tables || []), ...tables] };
    } else {
      result.push({
        id: groupId,
        name: groupId === '__recovered_active_sessions__' ? 'Active tables (recovered)' : 'Previously configured zone',
        tables,
        recovered: true,
      });
    }
  });
  return result;
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
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [activeZoneId, setActiveZoneId] = useState(store.zones[0]?.id);
  const [shape, setShape] = useState(() => safeRead(SHAPE_KEY, 'square'));
  const [designMode, setDesignMode] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [arrivalsToday, setArrivalsToday] = useState(null);
  const [arrivalsFailed, setArrivalsFailed] = useState(false);
  const floorZones = useMemo(() => buildFloorZones(store.zones, store.sessions), [store.zones, store.sessions]);
  const zone = floorZones.find((z) => z.id === activeZoneId) || floorZones[0];

  // Real arrivals for today, so the floor summary never shows an invented
  // reservation count. `null` means "not loaded", which renders as a dash.
  useEffect(() => {
    let active = true;
    if (!propertyId) { setArrivalsToday(null); setArrivalsFailed(false); return undefined; }
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const closed = new Set(['cancelled', 'canceled', 'no_show', 'no-show', 'checked_out']);
    pmsService.listReservations(propertyId)
      .then((rows) => {
        if (!active) return;
        setArrivalsToday((rows || []).filter((row) => {
          const status = String(row.status || row.booking_status || '').toLowerCase();
          return String(row.arrival || '').slice(0, 10) === todayKey && !closed.has(status);
        }).length);
        setArrivalsFailed(false);
      })
      .catch((error) => {
        console.error('[POS] today\'s reservations could not be loaded', error);
        if (!active) return;
        setArrivalsToday(null);
        setArrivalsFailed(true);
      });
    return () => { active = false; };
  }, [propertyId]);

  useEffect(() => { localStorage.setItem(SHAPE_KEY, shape); }, [shape]);
  useEffect(() => {
    const ticker = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(ticker);
  }, []);

  const displayTables = useMemo(() => (zone?.tables || []).map((t) => ({
    ...t,
    zoneId: zone?.id,
    zoneName: zone?.name,
  })), [zone]);

  const moveTable = (id, x, y) => {
    const t = zone?.tables.find((item) => item.id === id);
    if (t && store.moveTable) store.moveTable(zone.id, id, x, y);
  };

  const saveLayout = () => {
    setDesignMode(false);
  };

  if (store.floorLoading) return (
    <div role="status" aria-live="polite" className="flex h-full min-h-48 flex-col justify-center gap-4 bg-[var(--canvas)] p-6">
      <div className="mx-auto w-full max-w-xl space-y-3">
        <div className="h-10 animate-pulse rounded-xl bg-[var(--surface)]" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]" />)}
        </div>
        <p className="text-center text-sm text-[var(--text-muted)]">Loading shared floor zones and tables…</p>
      </div>
    </div>
  );

  if (store.floorError) return (
    <div role="alert" className="flex h-full min-h-48 items-center justify-center bg-[var(--canvas)] p-6 text-center">
      <div className="max-w-md rounded-2xl border border-[var(--danger)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-black text-[var(--text)]">Floor configuration unavailable</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{store.floorError}</p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">No table sessions or orders have been modified.</p>
      </div>
    </div>
  );

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
  floorZones.forEach((z) => z.tables.forEach((t) => {
    const s = store.getSession(t.id);
    if (!s) return;
    if (s.status === 'occupied') { occupied++; openChecks++; covers += s.guests || 0; }
    else if (s.status === 'unsettled') { openChecks++; covers += s.guests || 0; }
  }));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--canvas)] text-[var(--text)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 pb-2 pt-3 lg:px-4">
        {floorZones.map((z) => (
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
          <div className="grid grid-cols-2 gap-3"><SummaryRow label="Covers Seated" value={covers} /><SummaryRow label="Tables Occupied" value={occupied} /><SummaryRow label="Open Checks" value={openChecks} /><SummaryRow label="Arrivals Today" value={arrivalsToday ?? (arrivalsFailed ? 'n/a' : '—')} hint={arrivalsFailed ? 'Reservations could not be loaded.' : 'Reservations arriving today.'} /></div>
        </div>
        <aside className="hidden w-48 shrink-0 flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 xl:flex">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--primary)]">Today</h3>
          <SummaryRow label="Covers Seated" value={covers} />
          <SummaryRow label="Tables Occupied" value={occupied} />
          <SummaryRow label="Open Checks" value={openChecks} />
          <SummaryRow label="Arrivals Today" value={arrivalsToday ?? (arrivalsFailed ? 'n/a' : '—')} hint={arrivalsFailed ? 'Reservations could not be loaded.' : 'Reservations arriving today.'} />
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
function SummaryRow({ label, value, hint }) { return <div className="flex min-w-0 flex-col" title={hint}><span className="text-2xl font-bold text-[var(--text)]">{value}</span><span className="text-xs leading-tight text-[var(--text-muted)]">{label}</span></div>; }
