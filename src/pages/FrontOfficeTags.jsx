import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Trash2, X, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';

const TYPES = [
  { value: 'guest', label: 'Guests' },
  { value: 'room', label: 'Rooms' },
  { value: 'reservation', label: 'Reservations' },
];
const COLORS = ['#2563EB', '#0F766E', '#7C3AED', '#C2410C', '#BE123C', '#475569'];
const field = 'h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]';

export default function FrontOfficeTags() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [tags, setTags] = useState([]);
  const [entities, setEntities] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [type, setType] = useState('guest');
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [selectedTag, setSelectedTag] = useState('');
  const [entityId, setEntityId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [tagRows, guestRows, roomRows, reservationRows, assignmentRows] = await Promise.all([
        supabase.from('property_tags').select('*').eq('property_id', propertyId).order('name'),
        supabase.from('guests').select('id,name,email').eq('property_id', propertyId).order('name').limit(500),
        supabase.from('rooms').select('id,number,name').eq('property_id', propertyId).order('number').limit(500),
        supabase.from('reservations').select('id,guest_name,confirmation_code,arrival').eq('property_id', propertyId).order('arrival', { ascending: false }).limit(500),
        supabase.from('property_tag_assignments').select('id,tag_id,entity_type,entity_id,created_at').eq('property_id', propertyId).order('created_at', { ascending: false }).limit(1000),
      ]);
      for (const result of [tagRows, guestRows, roomRows, reservationRows, assignmentRows]) if (result.error) throw result.error;
      setTags(tagRows.data || []);
      setAssignments(assignmentRows.data || []);
      setEntities([
        ...(guestRows.data || []).map(row => ({ id: row.id, type: 'guest', label: row.name + (row.email ? ' · ' + row.email : '') })),
        ...(roomRows.data || []).map(row => ({ id: row.id, type: 'room', label: row.name || 'Room ' + row.number })),
        ...(reservationRows.data || []).map(row => ({ id: row.id, type: 'reservation', label: (row.guest_name || 'Guest') + ' · ' + (row.confirmation_code || row.id.slice(0, 8)) })),
      ]);
    } catch (error) {
      toast.error(error.message || 'Unable to load property tags.');
    } finally { setLoading(false); }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const visibleTags = useMemo(() => tags.filter(tag => tag.applies_to === type), [tags, type]);
  const visibleEntities = useMemo(() => entities.filter(entity => entity.type === type), [entities, type]);
  const activeTag = visibleTags.find(tag => tag.id === selectedTag);

  const createTag = async event => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || !propertyId) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('property_tags').insert({ property_id: propertyId, name: cleanName, color, applies_to: type });
      if (error) throw error;
      setName('');
      toast.success('Tag created.');
      await load();
    } catch (error) { toast.error(error.message || 'Could not create tag.'); }
    finally { setBusy(false); }
  };

  const assignTag = async event => {
    event.preventDefault();
    if (!propertyId || !selectedTag || !entityId) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('property_tag_assignments').insert({
        property_id: propertyId, tag_id: selectedTag, entity_type: type, entity_id: entityId, created_by: user?.id || null,
      });
      if (error) throw error;
      setEntityId('');
      toast.success('Tag assigned.');
      await load();
    } catch (error) { toast.error(error.message || 'Could not assign tag.'); }
    finally { setBusy(false); }
  };

  const removeAssignment = async id => {
    try {
      const { error } = await supabase.from('property_tag_assignments').delete().eq('id', id).eq('property_id', propertyId);
      if (error) throw error;
      setAssignments(rows => rows.filter(row => row.id !== id));
      toast.success('Tag removed from record.');
    } catch (error) { toast.error(error.message || 'Could not remove tag.'); }
  };

  const deleteTag = async id => {
    if (!window.confirm('Delete this tag and all its assignments?')) return;
    try {
      const { error } = await supabase.from('property_tags').delete().eq('id', id).eq('property_id', propertyId);
      if (error) throw error;
      setTags(rows => rows.filter(row => row.id !== id));
      setAssignments(rows => rows.filter(row => row.tag_id !== id));
      if (selectedTag === id) setSelectedTag('');
      toast.success('Tag deleted.');
    } catch (error) { toast.error(error.message || 'Could not delete tag.'); }
  };

  const entityLabel = (entityType, id) => entities.find(row => row.type === entityType && row.id === id)?.label || 'Record ' + id.slice(0, 8);
  const tagLabel = id => tags.find(row => row.id === id);

  return <div className="min-h-full bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Front Office · Guest experience</div><h1 className="mt-1 text-2xl font-bold">Property Tags</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Create property-specific labels and attach them to guests, rooms and reservations.</p></div>
        <button type="button" onClick={load} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><RefreshCw size={15}/> Refresh</button>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tag categories">
        {TYPES.map(item => <button key={item.value} type="button" role="tab" aria-selected={type === item.value} onClick={() => { setType(item.value); setSelectedTag(''); setEntityId(''); }} className={['rounded-lg px-4 py-2 text-sm font-semibold', type === item.value ? 'bg-[var(--brand-primary)] text-white' : 'border border-[var(--border)] bg-[var(--surface)]'].join(' ')}>{item.label}</button>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-semibold">Create a {type} tag</h2>
          <form onSubmit={createTag} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[180px] flex-1 text-xs font-semibold">Tag name<input required maxLength={40} value={name} onChange={event => setName(event.target.value)} className={field + ' mt-1'} placeholder="e.g. VIP, Late checkout"/></label>
            <label className="text-xs font-semibold">Colour<select value={color} onChange={event => setColor(event.target.value)} className={field + ' mt-1 min-w-[130px]'}>{COLORS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <button disabled={busy || !name.trim()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16}/> Create</button>
          </form>
          <div className="mt-4 space-y-2">
            {loading ? <div className="h-20 animate-pulse rounded-lg bg-[var(--surface-2)]"/> : visibleTags.length ? visibleTags.map(tag => <div key={tag.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
              <div className="flex min-w-0 items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }}/><span className="truncate text-sm font-semibold">{tag.name}</span><span className="text-xs text-[var(--text-muted)]">{assignments.filter(row => row.tag_id === tag.id).length} assigned</span></div>
              <button type="button" onClick={() => deleteTag(tag.id)} aria-label={'Delete ' + tag.name} className="rounded-md p-2 text-[var(--danger-text)] hover:bg-[var(--danger-soft)]"><Trash2 size={15}/></button>
            </div>) : <p className="rounded-lg bg-[var(--canvas)] p-5 text-center text-sm text-[var(--text-muted)]">No {type} tags yet. Create the first one above.</p>}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-semibold">Assign a tag</h2>
          <form onSubmit={assignTag} className="mt-3 space-y-3">
            <label className="block text-xs font-semibold">Tag<select required value={selectedTag} onChange={event => setSelectedTag(event.target.value)} className={field + ' mt-1'}><option value="">Choose a tag</option>{visibleTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
            <label className="block text-xs font-semibold">{type === 'guest' ? 'Guest' : type === 'room' ? 'Room' : 'Reservation'}<select required value={entityId} onChange={event => setEntityId(event.target.value)} className={field + ' mt-1'}><option value="">Choose a record</option>{visibleEntities.map(entity => <option key={entity.id} value={entity.id}>{entity.label}</option>)}</select></label>
            <button disabled={busy || !selectedTag || !entityId || !activeTag} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50"><Link2 size={15}/> Assign tag</button>
          </form>
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] p-4"><h2 className="font-semibold">Current assignments</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Showing assignments for {type} records in this property.</p></div>
        {loading ? <div className="space-y-2 p-4"><div className="h-10 animate-pulse rounded bg-[var(--surface-2)]"/><div className="h-10 animate-pulse rounded bg-[var(--surface-2)]"/></div> : <div className="divide-y divide-[var(--border)]">
          {assignments.filter(row => row.entity_type === type).map(row => { const tag = tagLabel(row.tag_id); return <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-center gap-3"><span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: tag?.color || '#64748B', color: '#fff' }}>{tag?.name || 'Tag'}</span><span className="truncate text-sm">{entityLabel(row.entity_type, row.entity_id)}</span></div>
            <button type="button" onClick={() => removeAssignment(row.id)} aria-label="Remove assignment" className="rounded-md p-2 text-[var(--text-muted)] hover:bg-[var(--canvas)]"><X size={15}/></button>
          </div>; })}
          {!assignments.some(row => row.entity_type === type) && <p className="p-8 text-center text-sm text-[var(--text-muted)]">No tag assignments for this category.</p>}
        </div>}
      </section>
      <p className="text-xs text-[var(--text-muted)]">All tag definitions and assignments are scoped to the signed-in property. Database row-level security enforces property membership and manager permissions.</p>
    </div>
  </div>;
}
