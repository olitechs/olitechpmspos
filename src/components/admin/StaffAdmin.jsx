import React, { useState } from 'react';
import { Plus, Trash2, Pencil, Check } from 'lucide-react';
import { useStore } from '@/data/AppStore';
import { NAVY, TEAL, SAND, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE } from '@/data/themePalette';

export default function StaffAdmin() {
  const store = useStore();
  const [name, setName] = useState('');
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: SAND }}>
      <div className="max-w-xl rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
        <div className="px-5 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="text-sm font-bold" style={{ color: NAVY }}>Waiters</div>
          <div className="text-xs" style={{ color: MUTED }}>This list feeds the waiter field when opening a table.</div>
        </div>

        <div className="px-5 py-3 flex gap-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <input
            value={name} onChange={(e) => setName(e.target.value)} placeholder="Add waiter by name…"
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}
          />
          <button
            onClick={() => { if (name.trim()) { store.addStaff(name.trim()); setName(''); } }}
            className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1" style={{ background: TEAL, color: 'var(--text)' }}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        <div>
          {store.staff.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 px-5 py-2.5" style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 ? SURFACE2 : SURFACE }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: `${NAVY}14`, color: NAVY }}>
                {s.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </div>
              {editId === s.id ? (
                <>
                  <input
                    value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-lg text-sm outline-none" style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: NAVY }}
                  />
                  <button onClick={() => { if (editName.trim()) store.updateStaff(s.id, editName.trim()); setEditId(null); }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: TEAL, color: 'var(--text)' }}>
                    <Check size={14} />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium" style={{ color: NAVY }}>{s.name}</span>
                  <button onClick={() => { setEditId(s.id); setEditName(s.name); }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <Pencil size={14} style={{ color: MUTED }} />
                  </button>
                  <button onClick={() => store.removeStaff(s.id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <Trash2 size={14} style={{ color: DESTRUCTIVE }} />
                  </button>
                </>
              )}
            </div>
          ))}
          {store.staff.length === 0 && (
            <div className="px-5 py-8 text-center text-sm" style={{ color: MUTED }}>No waiters yet — add one above.</div>
          )}
        </div>
      </div>
    </div>
  );
}