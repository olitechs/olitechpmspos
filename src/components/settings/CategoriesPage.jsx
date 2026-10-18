import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, RefreshCw, Save } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

export default function CategoriesPage() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('category')
      .eq('property_id', propertyId);

    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      const counts = new Map();
      (data || []).forEach((row) => {
        const name = (row.category || 'Uncategorized').trim() || 'Uncategorized';
        counts.set(name, (counts.get(name) || 0) + 1);
      });
      setRows(
        [...counts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    }
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const rename = async () => {
    if (!editing || !propertyId) return;
    const oldName = editing.original;
    const newName = String(editing.name || '').trim();
    if (!newName || newName === oldName) {
      setEditing(null);
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({ category: newName })
        .eq('property_id', propertyId)
        .eq('category', oldName);
      if (error) throw error;
      toast.success('Category renamed and products updated.');
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error?.message || 'Unable to rename category.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-[var(--bg)] p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">Back Office</div>
            <h1 className="text-2xl font-black text-[var(--text)]">Categories</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Property product categories. Existing inventory remains the source of truth.</p>
          </div>
          <button type="button" onClick={load} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[var(--text)] shadow-sm transition hover:bg-[var(--brand-soft)]" aria-label="Refresh categories">
            <RefreshCw size={17} />
          </button>
        </div>

        <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
          Categories are derived from the product master. Rename an existing category to update every product currently assigned to it.
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          {loading ? (
            <div className="p-10 text-center text-[var(--muted)]">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--brand-dark)] text-[var(--on-dark)]">
                  <tr>
                    <th className="p-3 text-left">Category</th>
                    <th className="p-3 text-right">Products</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="p-3 font-semibold text-[var(--text)]">{row.name}</td>
                      <td className="p-3 text-right text-[var(--muted)]">{row.count}</td>
                      <td className="p-3 text-right">
                        <button type="button" onClick={() => setEditing({ original: row.name, name: row.name })} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 font-semibold text-[var(--text)] transition hover:border-[var(--brand-primary)] hover:bg-[var(--brand-soft)]">
                          <Pencil size={15} />
                          Rename
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={3} className="p-10 text-center text-[var(--muted)]">No product categories yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {editing && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
            <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl">
              <h2 className="text-lg font-black text-[var(--text)]">Rename category</h2>
              <input
                autoFocus
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !busy) rename();
                  if (event.key === 'Escape' && !busy) setEditing(null);
                }}
                className="mt-4 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} disabled={busy} className="rounded-xl border border-[var(--border)] px-4 py-2.5 font-semibold text-[var(--text)] disabled:opacity-50">
                  Cancel
                </button>
                <button type="button" disabled={busy} onClick={rename} className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 font-black text-[var(--action-text)] disabled:cursor-not-allowed disabled:opacity-50">
                  <Save size={15} />
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
