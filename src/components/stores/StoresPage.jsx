import React, { useEffect, useState } from 'react';
import { Building2, Trash2, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { storeService } from '@/services/storeService';
import { usePrinterStore } from '@/data/modules/printerStore';
import { useAuth } from '@/lib/AuthContext';

export default function StoresPage() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const stores = usePrinterStore(s => s.stores);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadStores = async () => {
    if (!propertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await storeService.listStores(propertyId);
      usePrinterStore.setState({ stores: data, propertyId });
    } catch (error) {
      toast.error('Could not load stores: ' + error.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadStores(); }, [propertyId]);

  const resetForm = () => {
    setEditing(null);
    setName('');
    setAddress('');
  };

  const save = async () => {
    const cleanName = name.trim();
    if (!propertyId) {
      toast.error('Your account is not linked to a property. Contact your administrator.');
      return;
    }
    if (!cleanName) {
      toast.error('Enter a store name.');
      return;
    }
    if (cleanName.length > 100 || address.trim().length > 300) {
      toast.error('Store name must be 100 characters or fewer and address 300 characters or fewer.');
      return;
    }

    setSaving(true);
    try {
      const data = editing
        ? await storeService.updateStore(editing, propertyId, { name: cleanName, address: address.trim() || null })
        : await storeService.createStore({ propertyId, name: cleanName, address: address.trim() || null, isDefault: stores.length === 0 });
      usePrinterStore.setState(state => ({
        stores: editing
          ? state.stores.map(store => store.id === editing ? data : store)
          : [...state.stores, data].sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default) || a.name.localeCompare(b.name)),
        propertyId
      }));
      toast.success(editing ? 'Store updated.' : 'Store created.');
      resetForm();
    } catch (error) {
      const message = error?.code === '23505'
        ? 'A store with this name already exists for this property.'
        : error?.message || 'Unable to save store.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (store) => {
    if (!propertyId || !window.confirm(`Delete "${store.name}"? Printer groups or devices linked to this store may be affected.`)) return;
    setDeletingId(store.id);
    try {
      await storeService.deleteStore(store.id, propertyId);
      usePrinterStore.setState(state => ({ stores: state.stores.filter(item => item.id !== store.id) }));
      if (editing === store.id) resetForm();
      toast.success('Store deleted.');
    } catch (error) {
      toast.error(error?.message || 'Unable to delete store.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-full bg-canvas p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-normal text-foreground">Stores</h2>
            <p className="text-sm text-muted-foreground">Manage properties/outlets and their printer configuration.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={loadStores} disabled={loading} className="flex items-center gap-2 border border-border bg-surface px-4 py-3 text-sm text-foreground disabled:opacity-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" onClick={() => { resetForm(); }} className="flex items-center gap-2 bg-primary px-5 py-3 text-sm font-medium uppercase text-foreground">
              <Plus size={16} /> Add store
            </button>
          </div>
        </div>

        {!propertyId && !loading && (
          <div role="alert" className="mb-4 border border-[var(--warning)] bg-[var(--warning-soft)] p-4 text-sm text-[var(--warning-text)]">
            Your account is not linked to a property. Select or assign a property before creating a store.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          <div className="bg-surface shadow-sm">
            {loading ? (
              <p className="p-8 text-sm text-muted-foreground">Loading stores…</p>
            ) : stores.length ? stores.map(store => (
              <div key={store.id} className="flex items-center gap-4 border-b p-5 last:border-0">
                <Building2 className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">
                    {store.name}{store.is_default && <span className="ml-2 text-xs text-success">Default</span>}
                  </div>
                  <div className="break-words text-xs text-muted-foreground">{store.address || 'No address'}</div>
                </div>
                <button type="button" onClick={() => { setEditing(store.id); setName(store.name); setAddress(store.address || ''); }} className="text-sm text-success">Edit</button>
                <button type="button" disabled={deletingId === store.id} onClick={() => remove(store)} aria-label={`Delete ${store.name}`} className="text-danger disabled:opacity-50">
                  <Trash2 size={17} />
                </button>
              </div>
            )) : (
              <p className="p-8 text-sm text-muted-foreground">No stores configured. Create your first store using the form.</p>
            )}
          </div>

          <form onSubmit={event => { event.preventDefault(); save(); }} className="bg-surface p-5 shadow-sm">
            <h3 className="font-medium text-foreground">{editing ? 'Edit store' : 'New store'}</h3>
            <label className="mt-4 block text-xs text-muted-foreground">
              Store name
              <input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Main Restaurant" className="mt-1 w-full border-b border-border px-0 py-2 text-sm outline-none focus:border-primary" />
            </label>
            <label className="mt-4 block text-xs text-muted-foreground">
              Address
              <input maxLength={300} value={address} onChange={event => setAddress(event.target.value)} placeholder="Street, town (optional)" className="mt-1 w-full border-b border-border px-0 py-2 text-sm outline-none focus:border-primary" />
            </label>
            <button type="submit" disabled={saving || !propertyId} className="mt-6 w-full bg-primary py-3 text-sm font-medium uppercase text-foreground disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create store'}
            </button>
            {editing && <button type="button" onClick={resetForm} className="mt-2 w-full border border-border py-2 text-sm text-foreground">Cancel edit</button>}
          </form>
        </div>
      </div>
    </div>
  );
}
