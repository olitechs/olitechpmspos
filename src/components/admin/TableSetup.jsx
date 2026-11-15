import React, { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/data/AppStore';
import { TABLE_CARD, tableLabel } from '@/lib/posTables';
const NAVY = 'var(--text)';
const TEAL = 'var(--primary)';
const SAND = 'var(--canvas)';
const SURFACE = 'var(--surface)';
const SURFACE2 = 'var(--sidebar)';
const BORDER = 'var(--border)';
const MUTED = 'var(--text-muted)';
const DESTRUCTIVE = 'var(--danger)';

const MIN_W = Math.round(TABLE_CARD.w * 0.6);
const MIN_H = Math.round(TABLE_CARD.h * 0.6);

export default function TableSetup() {
  const store = useStore();
  const [activeZoneId, setActiveZoneId] = useState(store.zones[0]?.id);
  const [newZoneName, setNewZoneName] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const canvasRef = useRef(null);

  const zone = store.zones.find((z) => z.id === activeZoneId) || store.zones[0];
  const selected = zone?.tables.find((t) => t.id === selectedId);

  const startDrag = (e, table) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const ox = table.x, oy = table.y;
    const tw = table.w || TABLE_CARD.w, th = table.h || TABLE_CARD.h;
    const move = (ev) => {
      const nx = Math.max(0, Math.min(rect.width - tw, ox + (ev.clientX - sx)));
      const ny = Math.max(0, Math.min(rect.height - th, oy + (ev.clientY - sy)));
      store.moveTable(zone.id, table.id, nx, ny);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e, table) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(table.id);
    const sx = e.clientX, sy = e.clientY;
    const ow = table.w || TABLE_CARD.w, oh = table.h || TABLE_CARD.h;
    const move = (ev) => {
      const nw = Math.max(MIN_W, ow + (ev.clientX - sx));
      const nh = Math.max(MIN_H, oh + (ev.clientY - sy));
      store.updateTable(zone.id, table.id, { w: Math.round(nw), h: Math.round(nh) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!zone) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: SAND }}>
        <div className="text-sm" style={{ color: MUTED }}>No zones yet — add one to begin.</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col" style={{ background: SAND }}>
      {/* Zones bar */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0 overflow-x-auto" style={{ borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
        {store.zones.map((z) => (
          <button
            key={z.id}
            onClick={() => { setActiveZoneId(z.id); setSelectedId(null); }}
            className="px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap shrink-0"
            style={{
              background: z.id === zone?.id ? TEAL : SURFACE,
              color: z.id === zone?.id ? 'var(--on-primary)' : MUTED,
              border: `1.5px solid ${z.id === zone?.id ? TEAL : BORDER}`,
            }}
          >
            {z.name} <span style={{ opacity: 0.6 }}>· {z.tables.length}</span>
          </button>
        ))}
        <div className="flex items-center gap-1 ml-1 shrink-0">
          <input
            value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} placeholder="New zone…"
            className="px-3 py-1.5 rounded-lg text-sm outline-none w-32"
            style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}
          />
          <button
            onClick={() => { if (newZoneName.trim()) { store.addZone(newZoneName.trim()); setNewZoneName(''); } }}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1"
            style={{ background: TEAL, color: 'var(--on-primary)' }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {!zone ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-sm rounded-2xl p-6 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <h2 className="text-base font-bold" style={{ color: NAVY }}>No floor zones yet</h2>
            <p className="mt-1 text-sm" style={{ color: MUTED }}>Create a zone above — for example Bar, Pool or Restaurant Room — then place tables on it.</p>
          </div>
        </div>
      ) : (
      <div className="flex flex-1 min-h-0">
        {/* Canvas */}
        <div className="flex-1 overflow-auto p-3">
          <div
            ref={canvasRef}
            className="relative"
            style={{ height: '100%', minHeight: '420px', background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 12 }}
          >
            {zone.tables.map((t) => {
              const w = t.w || TABLE_CARD.w;
              const h = t.h || TABLE_CARD.h;
              return (
                <div
                  key={t.id}
                  onPointerDown={(e) => { setSelectedId(t.id); startDrag(e, t); }}
                  style={{
                    position: 'absolute', left: t.x, top: t.y, width: w, height: h,
                    background: SURFACE, border: `2px solid ${selectedId === t.id ? TEAL : BORDER}`, borderRadius: 10,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                    cursor: 'grab', touchAction: 'none',
                    boxShadow: selectedId === t.id ? 'var(--shadow-overlay)' : 'none',
                  }}
                >
                  <span className="font-bold font-mono" style={{ color: NAVY, fontSize: Math.max(12, Math.min(16, w / 6)) }}>{tableLabel(t, zone.id)}</span>
                  <span className="text-xs" style={{ color: MUTED }}>{t.seats} seats</span>
                  {/* Resize handle (bottom-right) */}
                  <div
                    onPointerDown={(e) => startResize(e, t)}
                    style={{
                      position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize',
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 2,
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.5 }}>
                      <path d="M9 1 L1 9 M9 5 L5 9 M5 1 L1 5" stroke={NAVY} strokeWidth="1.2" fill="none" />
                    </svg>
                  </div>
                </div>
              );
            })}
            {zone.tables.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: MUTED }}>
                No tables — use “Add Table” to begin the floor plan.
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="shrink-0 overflow-y-auto p-4" style={{ width: '240px', background: SURFACE, borderLeft: `1px solid ${BORDER}` }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: MUTED }}>Zone</div>
          <input
            value={zone.name} onChange={(e) => store.renameZone(zone.id, e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm font-semibold outline-none mb-2"
            style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}
          />
          <button
            onClick={() => {
              if (store.zones.length > 1) {
                store.removeZone(zone.id);
                const next = store.zones.find((z) => z.id !== zone.id);
                setActiveZoneId(next.id);
              }
            }}
            className="w-full py-2 rounded-lg text-xs font-semibold mb-4 flex items-center justify-center gap-1"
            style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: DESTRUCTIVE }}
          >
            <Trash2 size={12} /> Delete Zone
          </button>

          <button
            onClick={() => store.addTable(zone.id)}
            className="w-full py-3 rounded-xl text-sm font-bold mb-4 flex items-center justify-center gap-1"
            style={{ background: TEAL, color: 'var(--on-primary)' }}
          >
            <Plus size={16} /> Add Table
          </button>

          {selected ? (
            <div className="pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
              <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: MUTED }}>Selected Table</div>
              <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Table number</label>
              <input
                type="number" min="1" value={selected.number}
                onChange={(e) => store.updateTable(zone.id, selected.id, { number: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg text-sm font-mono font-bold outline-none mb-3"
                style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}
              />
              <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Seats</label>
              <input
                type="number" min="1" value={selected.seats}
                onChange={(e) => store.updateTable(zone.id, selected.id, { seats: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg text-sm font-mono font-bold outline-none mb-4"
                style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}
              />
              <div className="flex gap-2 mb-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Width</label>
                  <input
                    type="number" min={MIN_W} value={selected.w || TABLE_CARD.w}
                    onChange={(e) => store.updateTable(zone.id, selected.id, { w: Math.max(MIN_W, Number(e.target.value)) })}
                    className="w-full px-2 py-2 rounded-lg text-sm font-mono font-bold outline-none"
                    style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Height</label>
                  <input
                    type="number" min={MIN_H} value={selected.h || TABLE_CARD.h}
                    onChange={(e) => store.updateTable(zone.id, selected.id, { h: Math.max(MIN_H, Number(e.target.value)) })}
                    className="w-full px-2 py-2 rounded-lg text-sm font-mono font-bold outline-none"
                    style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}
                  />
                </div>
              </div>
              <button
                onClick={() => { store.removeTable(zone.id, selected.id); setSelectedId(null); }}
                className="w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1"
                style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: DESTRUCTIVE }}
              >
                <Trash2 size={12} /> Remove Table
              </button>
              <div className="text-xs mt-3" style={{ color: MUTED }}>Drag tables to move; drag the corner handle to resize.</div>
            </div>
          ) : (
            <div className="text-xs" style={{ color: MUTED }}>Select a table to edit its number, capacity, size, or remove it.</div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}