import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Palette, RefreshCw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { inventoryService } from '@/services/inventoryService';

export default function MenuVisualEditor({ open, onClose, embedded = false, propertyId }) {
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const fileRefs = useRef({});

  const reload = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const rows = await inventoryService.listPosMenu(propertyId);
      setItems(rows);
      setDrafts(Object.fromEntries(rows.map((item) => [item.id, {
        tile_color: item.tile_color || '#2563eb',
        tile_text_color: item.tile_text_color || '#ffffff',
        tile_image_url: item.tile_image_url || '',
      }])));
    } catch (error) {
      toast.error(error.message || 'Could not load the POS menu.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) reload(); }, [open, propertyId]);

  const updateDraft = (id, patch) => {
    setDrafts((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  };

  const saveVisuals = async (item, patch = {}) => {
    const draft = { ...drafts[item.id], ...patch };
    setBusyId(item.id);
    try {
      await inventoryService.updatePosMenuItemVisuals({
        propertyId,
        id: item.id,
        tile_color: draft.tile_color,
        tile_text_color: draft.tile_text_color,
        tile_image_url: draft.tile_image_url,
      });
      setDrafts((previous) => ({ ...previous, [item.id]: draft }));
      setItems((previous) => previous.map((row) => row.id === item.id ? { ...row, ...draft } : row));
      window.dispatchEvent(new Event('olitech:menu-updated'));
      toast.success(`${item.name} appearance updated on the POS.`);
    } catch (error) {
      toast.error(error.message || 'Could not update the menu appearance.');
    } finally {
      setBusyId(null);
    }
  };

  const uploadPhoto = async (item, file) => {
    if (!file) return;
    setBusyId(item.id);
    try {
      const url = await inventoryService.uploadPosMenuItemImage(propertyId, file);
      await saveVisuals(item, { tile_image_url: url });
    } catch (error) {
      toast.error(error.message || 'Could not upload product photo.');
      setBusyId(null);
    } finally {
      const input = fileRefs.current[item.id];
      if (input) input.value = '';
    }
  };

  if (!open) return null;
  const shellClass = embedded
    ? 'flex min-h-[28rem] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--canvas)]'
    : 'fixed inset-0 z-[450] flex items-center justify-center bg-[var(--overlay-scrim)] p-3 md:p-6';
  return (
    <div className={shellClass}>
      <section className={embedded ? 'flex min-h-0 flex-1 flex-col' : 'flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--canvas)] shadow-2xl'}>
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text)]"><Palette size={19}/> POS Menu Appearance</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Upload product photos and adjust tile colours. Prices and stock are managed separately.</p>
          </div>
          {!embedded && <button type="button" onClick={onClose} aria-label="Close menu appearance" className="rounded-lg p-2 hover:bg-[var(--canvas)]"><X size={19}/></button>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--text-muted)]">{items.length} POS products</p>
            <button type="button" onClick={reload} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold"><RefreshCw size={14}/> Refresh</button>
          </div>
          {loading ? <div className="p-10 text-center text-sm text-[var(--text-muted)]">Loading menu…</div> : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const draft = drafts[item.id] || {};
                const busy = busyId === item.id;
                return (
                  <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex items-center gap-3">
                      {draft.tile_image_url
                        ? <img src={draft.tile_image_url} alt={item.name} className="h-16 w-16 rounded-lg border border-[var(--border)] object-cover"/>
                        : <div className="flex h-16 w-16 items-center justify-center rounded-lg text-xs font-bold" style={{backgroundColor:draft.tile_color,color:draft.tile_text_color}}>{item.name?.slice(0,2)?.toUpperCase()}</div>}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-[var(--text)]">{item.name}</h3>
                        <p className="mt-1 text-[11px] text-[var(--text-muted)]">{item.category || 'General'}</p>
                        <p className="mt-1 text-[10px] text-[var(--text-muted)]">Price and stock are read-only here</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="text-[11px] font-medium text-[var(--text-muted)]">Tile colour
                        <input type="color" value={draft.tile_color || '#2563eb'} onChange={(event) => updateDraft(item.id,{tile_color:event.target.value})} className="mt-1 h-9 w-full cursor-pointer rounded border border-[var(--border)]"/>
                      </label>
                      <label className="text-[11px] font-medium text-[var(--text-muted)]">Text colour
                        <input type="color" value={draft.tile_text_color || '#ffffff'} onChange={(event) => updateDraft(item.id,{tile_text_color:event.target.value})} className="mt-1 h-9 w-full cursor-pointer rounded border border-[var(--border)]"/>
                      </label>
                    </div>
                    <input ref={(node) => { fileRefs.current[item.id] = node; }} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadPhoto(item,event.target.files?.[0])} className="sr-only"/>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => fileRefs.current[item.id]?.click()} disabled={busy} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-50"><ImagePlus size={15}/> {busy ? 'Uploading…' : 'Upload photo'}</button>
                      <button type="button" onClick={() => saveVisuals(item)} disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--on-primary)] disabled:opacity-50"><Save size={14}/> Save colours</button>
                    </div>
                  </article>
                );
              })}
              {!items.length && <div className="col-span-full rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--text-muted)]">No active POS products were found.</div>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
