import React, { useEffect, useState } from 'react';
import { Building2, Trash2, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
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
    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .eq('property_id', propertyId)
      .order('is_default', { ascending: false })
      .order('name');
    if (error) {
      toast.error('Could not load stores: ' + error.message);
    } else {
      usePrinterStore.setState({ stores: data || [], propertyId });
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
      const payload = { name: cleanName, address: address.trim() || null };
      let query;
      if (editing) {
        query = supabase.from('stores').update(payload)
          .eq('id', editing).eq('property_id', propertyId);
      } else {
        payload.property_id = propertyId;
        payload.is_default = stores.length === 0;
        query = supabase.from('stores').insert(payload);
      }
      const { data, error } = await query.select().single();
      if (error) throw error;
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
      const { error } = await supabase.from('stores').delete()
        .eq('id', store.id).eq('property_id', propertyId);
      if (error) throw error;
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
    <div className="min-h-full bg-[#F5F5F5] p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-normal text-[#212121]">Stores</h2>
            <p className="text-sm text-[#757575]">Manage properties/outlets and their printer configuration.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={loadStores} disabled={loading} className="flex items-center gap-2 border border-[#D6D6D6] bg-white px-4 py-3 text-sm text-[#424242] disabled:opacity-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" onClick={() => { resetForm(); }} className="flex items-center gap-2 bg-[#4CAF50] px-5 py-3 text-sm font-medium uppercase text-white">
              <Plus size={16} /> Add store
            </button>
          </div>
        </div>

        {!propertyId && !loading && (
          <div role="alert" className="mb-4 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            Your account is not linked to a property. Select or assign a property before creating a store.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          <div className="bg-white shadow-sm">
            {loading ? (
              <p className="p-8 text-sm text-[#757575]">Loading stores…</p>
            ) : stores.length ? stores.map(store => (
              <div key={store.id} className="flex items-center gap-4 border-b p-5 last:border-0">
                <Building2 className="shrink-0 text-[#78909C]" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[#212121]">
                    {store.name}{store.is_default && <span className="ml-2 text-xs text-[#2E7D32]">Default</span>}
                  </div>
                  <div className="break-words text-xs text-[#757575]">{store.address || 'No address'}</div>
                </div>
                <button type="button" onClick={() => { setEditing(store.id); setName(store.name); setAddress(store.address || ''); }} className="text-sm text-[#2E7D32]">Edit</button>
                <button type="button" disabled={deletingId === store.id} onClick={() => remove(store)} aria-label={`Delete ${store.name}`} className="text-[#D32F2F] disabled:opacity-50">
                  <Trash2 size={17} />
                </button>
              </div>
            )) : (
              <p className="p-8 text-sm text-[#757575]">No stores configured. Create your first store using the form.</p>
            )}
          </div>

          <form onSubmit={event => { event.preventDefault(); save(); }} className="bg-white p-5 shadow-sm">
            <h3 className="font-medium text-[#212121]">{editing ? 'Edit store' : 'New store'}</h3>
            <label className="mt-4 block text-xs text-[#757575]">
              Store name
              <input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Main Restaurant" className="mt-1 w-full border-b border-[#BDBDBD] px-0 py-2 text-sm outline-none focus:border-[#4CAF50]" />
            </label>
            <label className="mt-4 block text-xs text-[#757575]">
              Address
              <input maxLength={300} value={address} onChange={event => setAddress(event.target.value)} placeholder="Street, town (optional)" className="mt-1 w-full border-b border-[#BDBDBD] px-0 py-2 text-sm outline-none focus:border-[#4CAF50]" />
            </label>
            <button type="submit" disabled={saving || !propertyId} className="mt-6 w-full bg-[#4CAF50] py-3 text-sm font-medium uppercase text-white disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create store'}
            </button>
            {editing && <button type="button" onClick={resetForm} className="mt-2 w-full border border-[#D6D6D6] py-2 text-sm text-[#424242]">Cancel edit</button>}
          </form>
        </div>
      </div>
    </div>
  );
}
