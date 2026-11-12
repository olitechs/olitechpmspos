import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Layers3, BedDouble, RefreshCw, Plus, Save } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

const inputClass = 'h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--action-text)] disabled:cursor-not-allowed disabled:opacity-50';

export default function FrontOfficeStructure() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [tab, setTab] = useState('rooms');
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [buildingForm, setBuildingForm] = useState({ code: '', name: '', description: '' });
  const [floorForm, setFloorForm] = useState({ building_id: '', floor_number: '0', name: '', description: '' });
  const [roomEdits, setRoomEdits] = useState({});
  const [editingRoomType, setEditingRoomType] = useState(null);
  const [roomTypeForm, setRoomTypeForm] = useState({ code: '', name: '', description: '', view_type: '', bed_configuration: '', max_occupancy: '2', base_rate: '0', active: true });

  const load = useCallback(async () => {
    if (!propertyId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [b, f, r, t] = await Promise.all([
        supabase.from('property_buildings').select('*').eq('property_id', propertyId).order('name'),
        supabase.from('property_floors').select('*').eq('property_id', propertyId).order('floor_number'),
        supabase.from('rooms').select('id,number,name,floor,floor_id,building_id,room_type,room_type_id,status,active').eq('property_id', propertyId).order('number'),
        supabase.from('room_types').select('id,code,name,max_occupancy,bed_configuration,base_rate,active').eq('property_id', propertyId).order('name'),
      ]);
      for (const result of [b, f, r, t]) if (result.error) throw result.error;
      setBuildings(b.data || []);
      setFloors(f.data || []);
      setRooms(r.data || []);
      setRoomTypes(t.data || []);
      setRoomEdits(Object.fromEntries((r.data || []).map(room => [room.id, {
        building_id: room.building_id || '',
        floor_id: room.floor_id || '',
        room_type_id: room.room_type_id || '',
      }])));
      if (b.data?.length) setFloorForm(current => current.building_id ? current : ({ ...current, building_id: b.data[0].id }));
    } catch (error) {
      toast.error(error.message || 'Unable to load property structure.');
    } finally { setLoading(false); }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const floorsFor = useCallback(buildingId => floors.filter(floor => floor.building_id === buildingId), [floors]);
  const counts = useMemo(() => ({
    buildings: buildings.length,
    floors: floors.length,
    rooms: rooms.length,
    typed: rooms.filter(room => room.room_type_id).length,
  }), [buildings, floors, rooms]);

  const createBuilding = async event => {
    event.preventDefault();
    if (!propertyId) return;
    const payload = { property_id: propertyId, code: buildingForm.code.trim().toUpperCase(), name: buildingForm.name.trim(), description: buildingForm.description.trim() || null };
    if (!payload.code || !payload.name) { toast.error('Building code and name are required.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('property_buildings').insert(payload);
      if (error) throw error;
      toast.success('Building created.');
      setBuildingForm({ code: '', name: '', description: '' });
      await load();
    } catch (error) { toast.error(error.message || 'Unable to create building.'); }
    finally { setBusy(false); }
  };

  const createFloor = async event => {
    event.preventDefault();
    if (!propertyId || !floorForm.building_id) return;
    const payload = { property_id: propertyId, building_id: floorForm.building_id, floor_number: Number(floorForm.floor_number), name: floorForm.name.trim() || (Number(floorForm.floor_number) === 0 ? 'Ground Floor' : 'Floor ' + floorForm.floor_number), description: floorForm.description.trim() || null };
    if (!Number.isInteger(payload.floor_number)) { toast.error('Enter a whole-number floor level.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('property_floors').insert(payload);
      if (error) throw error;
      toast.success('Floor created.');
      setFloorForm(current => ({ ...current, name: '', description: '' }));
      await load();
    } catch (error) { toast.error(error.message || 'Unable to create floor.'); }
    finally { setBusy(false); }
  };

  const saveRoomType = async event => {
    event.preventDefault();
    if (!propertyId) return;
    const payload = {
      property_id: propertyId,
      code: roomTypeForm.code.trim().toUpperCase(),
      name: roomTypeForm.name.trim(),
      description: roomTypeForm.description.trim() || null,
      view_type: roomTypeForm.view_type.trim() || null,
      bed_configuration: roomTypeForm.bed_configuration.trim() || null,
      max_occupancy: Number(roomTypeForm.max_occupancy),
      base_rate: Number(roomTypeForm.base_rate),
      active: Boolean(roomTypeForm.active),
    };
    if (!payload.code || !payload.name || !Number.isInteger(payload.max_occupancy) || payload.max_occupancy < 1 || !Number.isFinite(payload.base_rate) || payload.base_rate < 0) {
      toast.error('Enter a code, name, valid guest capacity and non-negative base rate.');
      return;
    }
    setBusy(true);
    try {
      const query = editingRoomType
        ? supabase.from('room_types').update(payload).eq('id', editingRoomType).eq('property_id', propertyId)
        : supabase.from('room_types').insert(payload);
      const { error } = await query;
      if (error) throw error;
      toast.success(editingRoomType ? 'Room type updated.' : 'Room type created.');
      setEditingRoomType(null);
      setRoomTypeForm({ code: '', name: '', description: '', view_type: '', bed_configuration: '', max_occupancy: '2', base_rate: '0', active: true });
      await load();
    } catch (error) { toast.error(error.message || 'Unable to save room type.'); }
    finally { setBusy(false); }
  };

  const editRoomType = type => {
    setEditingRoomType(type.id);
    setRoomTypeForm({
      code: type.code || '',
      name: type.name || '',
      description: type.description || '',
      view_type: type.view_type || '',
      bed_configuration: type.bed_configuration || '',
      max_occupancy: String(type.max_occupancy || 2),
      base_rate: String(type.base_rate || 0),
      active: type.active !== false,
    });
  };

  const saveRoom = async room => {
    const edit = roomEdits[room.id] || {};
    const floor = floors.find(item => item.id === edit.floor_id);
    if (edit.floor_id && (!floor || floor.building_id !== edit.building_id)) {
      toast.error('Choose a floor belonging to the selected building.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from('rooms').update({
        building_id: edit.building_id || null,
        floor_id: edit.floor_id || null,
        floor: floor ? floor.floor_number : null,
        room_type_id: edit.room_type_id || null,
        room_type: roomTypes.find(type => type.id === edit.room_type_id)?.name || null,
      }).eq('id', room.id).eq('property_id', propertyId);
      if (error) throw error;
      toast.success('Room organisation saved.');
      await load();
    } catch (error) { toast.error(error.message || 'Unable to update room.'); }
    finally { setBusy(false); }
  };

  const tabs = [
    { id: 'rooms', label: 'Room organisation', icon: BedDouble },
    { id: 'buildings', label: 'Buildings', icon: Building2 },
    { id: 'floors', label: 'Floors', icon: Layers3 },
    { id: 'types', label: 'Room types', icon: BedDouble },
  ];

  return <div className="h-full overflow-y-auto bg-[var(--canvas)] p-4 md:p-6">
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Front Office / Inventory foundation</p><h1 className="mt-1 text-2xl font-black text-[var(--text)]">Property Structure</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Organise buildings, floors, room types and the rooms used by Reservations and the Room Planner.</p></div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold"><RefreshCw size={15}/> Refresh</button>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Buildings', counts.buildings], ['Floors', counts.floors], ['Rooms', counts.rooms], ['Rooms with a type', counts.typed]].map(([label, value]) => <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--text-muted)]">{label}</div><div className="mt-1 text-2xl font-black tabular-nums text-[var(--text)]">{loading ? '—' : value}</div></div>)}
      </div>
      <div className="mb-4 flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        {tabs.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={['inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold', tab === item.id ? 'bg-[var(--brand-primary)] text-[var(--action-text)]' : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'].join(' ')}><Icon size={15}/>{item.label}</button>; })}
      </div>
      {loading ? <PageDataSkeleton variant="cards" rows={6}/> : <>
        {tab === 'buildings' && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] p-4 font-bold">Buildings</div><div className="divide-y divide-[var(--border)]">{buildings.map(building => <div key={building.id} className="flex items-center justify-between gap-3 p-4"><div><div className="font-semibold text-[var(--text)]">{building.name}</div><div className="text-xs text-[var(--text-muted)]">{building.code} · {floorsFor(building.id).length} floors · {rooms.filter(room => room.building_id === building.id).length} rooms</div>{building.description && <p className="mt-1 text-xs text-[var(--text-muted)]">{building.description}</p>}</div><span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-xs">{building.active ? 'Active' : 'Inactive'}</span></div>)}{!buildings.length && <p className="p-8 text-center text-sm text-[var(--text-muted)]">No buildings configured yet.</p>}</div></section>
          <form onSubmit={createBuilding} className="h-fit rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><h2 className="mb-3 font-bold">Add building</h2><label className="mb-1 block text-xs font-semibold">Building code</label><input className={inputClass} value={buildingForm.code} onChange={e => setBuildingForm(v => ({...v,code:e.target.value}))} placeholder="MAIN" maxLength={20}/><label className="mb-1 mt-3 block text-xs font-semibold">Building name</label><input className={inputClass} value={buildingForm.name} onChange={e => setBuildingForm(v => ({...v,name:e.target.value}))} placeholder="Main Building"/><label className="mb-1 mt-3 block text-xs font-semibold">Description</label><textarea className="min-h-20 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm" value={buildingForm.description} onChange={e => setBuildingForm(v => ({...v,description:e.target.value}))}/><button className={buttonClass+' mt-4 w-full'} disabled={busy}><Plus size={15}/> Create building</button></form>
        </div>}
        {tab === 'floors' && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] p-4 font-bold">Floors by building</div>{buildings.map(building => <div key={building.id} className="border-b border-[var(--border)] last:border-0"><div className="bg-[var(--surface-2)] px-4 py-2 text-sm font-bold">{building.name}</div>{floorsFor(building.id).map(floor => <div key={floor.id} className="flex justify-between gap-3 px-4 py-3 text-sm"><span>{floor.name}</span><span className="text-xs text-[var(--text-muted)]">Level {floor.floor_number} · {rooms.filter(room => room.floor_id === floor.id).length} rooms</span></div>)}{!floorsFor(building.id).length && <p className="px-4 py-3 text-xs text-[var(--text-muted)]">No floors added.</p>}</div>)}</section>
          <form onSubmit={createFloor} className="h-fit rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><h2 className="mb-3 font-bold">Add floor</h2><label className="mb-1 block text-xs font-semibold">Building</label><select className={inputClass} value={floorForm.building_id} onChange={e => setFloorForm(v => ({...v,building_id:e.target.value}))}><option value="">Select building</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><label className="mb-1 mt-3 block text-xs font-semibold">Floor number</label><input type="number" step="1" className={inputClass} value={floorForm.floor_number} onChange={e => setFloorForm(v => ({...v,floor_number:e.target.value}))}/><label className="mb-1 mt-3 block text-xs font-semibold">Display name</label><input className={inputClass} value={floorForm.name} onChange={e => setFloorForm(v => ({...v,name:e.target.value}))} placeholder="Ground Floor / First Floor"/><label className="mb-1 mt-3 block text-xs font-semibold">Description</label><textarea className="min-h-20 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm" value={floorForm.description} onChange={e => setFloorForm(v => ({...v,description:e.target.value}))}/><button className={buttonClass+' mt-4 w-full'} disabled={busy || !buildings.length}><Plus size={15}/> Create floor</button></form>
        </div>}
        {tab === 'types' && <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <form onSubmit={saveRoomType} className="h-fit rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="font-bold">{editingRoomType ? 'Edit room type' : 'Add room type'}</h2>
            <p className="mb-3 mt-1 text-xs text-[var(--text-muted)]">Room types are shared with reservations and the Room Planner.</p>
            <label className="mb-1 block text-xs font-semibold">Code</label><input required className={inputClass} value={roomTypeForm.code} onChange={e => setRoomTypeForm(v => ({...v,code:e.target.value}))} placeholder="STD-GV"/>
            <label className="mb-1 mt-3 block text-xs font-semibold">Name</label><input required className={inputClass} value={roomTypeForm.name} onChange={e => setRoomTypeForm(v => ({...v,name:e.target.value}))} placeholder="Standard Garden View"/>
            <label className="mb-1 mt-3 block text-xs font-semibold">Description</label><textarea className="min-h-16 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm" value={roomTypeForm.description} onChange={e => setRoomTypeForm(v => ({...v,description:e.target.value}))}/>
            <label className="mb-1 mt-3 block text-xs font-semibold">View type</label><input className={inputClass} value={roomTypeForm.view_type} onChange={e => setRoomTypeForm(v => ({...v,view_type:e.target.value}))} placeholder="Garden View"/>
            <label className="mb-1 mt-3 block text-xs font-semibold">Bed configuration</label><input className={inputClass} value={roomTypeForm.bed_configuration} onChange={e => setRoomTypeForm(v => ({...v,bed_configuration:e.target.value}))} placeholder="1 King Bed"/>
            <div className="mt-3 grid grid-cols-2 gap-3"><div><label className="mb-1 block text-xs font-semibold">Max guests</label><input required type="number" min="1" step="1" className={inputClass} value={roomTypeForm.max_occupancy} onChange={e => setRoomTypeForm(v => ({...v,max_occupancy:e.target.value}))}/></div><div><label className="mb-1 block text-xs font-semibold">Base rate</label><input required type="number" min="0" step="0.01" className={inputClass} value={roomTypeForm.base_rate} onChange={e => setRoomTypeForm(v => ({...v,base_rate:e.target.value}))}/></div></div>
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={roomTypeForm.active} onChange={e => setRoomTypeForm(v => ({...v,active:e.target.checked}))}/> Active room type</label>
            <div className="mt-4 flex gap-2"><button className={buttonClass+' flex-1'} disabled={busy}><Plus size={15}/>{editingRoomType ? 'Save changes' : 'Create room type'}</button>{editingRoomType && <button type="button" onClick={() => {setEditingRoomType(null);setRoomTypeForm({code:'',name:'',description:'',view_type:'',bed_configuration:'',max_occupancy:'2',base_rate:'0',active:true});}} className="rounded-lg border border-[var(--border)] px-3 text-sm">Cancel</button>}</div>
          </form>
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] p-4"><h2 className="font-bold">Room types</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Changes affect the room type catalogue used by the Front Office.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-[var(--brand-dark)] text-[var(--on-dark)]"><tr><th className="p-3 text-left">Code</th><th className="p-3 text-left">Room type</th><th className="p-3 text-left">Beds</th><th className="p-3 text-right">Max guests</th><th className="p-3 text-right">Base rate</th><th className="p-3 text-right">Status</th><th className="p-3 text-right">Action</th></tr></thead><tbody>{roomTypes.map(type => <tr key={type.id} className="border-b border-[var(--border)]"><td className="p-3 font-mono text-xs">{type.code}</td><td className="p-3 font-semibold">{type.name}</td><td className="p-3">{type.bed_configuration || '—'}</td><td className="p-3 text-right">{type.max_occupancy}</td><td className="p-3 text-right tabular-nums">{Number(type.base_rate || 0).toLocaleString()}</td><td className="p-3 text-right">{type.active ? 'Active' : 'Inactive'}</td><td className="p-3 text-right"><button type="button" onClick={() => editRoomType(type)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-bold">Edit</button></td></tr>)}{!roomTypes.length && <tr><td colSpan="7" className="p-8 text-center text-[var(--text-muted)]">No room types configured yet. Create the first room type using the form.</td></tr>}</tbody></table></div></section>
        </div>}
        {tab === 'rooms' && <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] p-4"><h2 className="font-bold">Room organisation</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Assign each room to a building, floor and room type. Existing room numbers, reservations and statuses are preserved.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-[var(--brand-dark)] text-[var(--on-dark)]"><tr><th className="p-3 text-left">Room</th><th className="p-3 text-left">Building</th><th className="p-3 text-left">Floor</th><th className="p-3 text-left">Room type</th><th className="p-3 text-left">Status</th><th className="p-3 text-right">Action</th></tr></thead><tbody>{rooms.map(room => { const edit = roomEdits[room.id] || {}; const availableFloors = floorsFor(edit.building_id); return <tr key={room.id} className="border-b border-[var(--border)]"><td className="p-3 font-bold">{room.name || 'Room '+room.number}<div className="text-xs font-normal text-[var(--text-muted)]">#{room.number}</div></td><td className="p-3"><select className={inputClass} value={edit.building_id || ''} onChange={e => setRoomEdits(v => ({...v,[room.id]:{...v[room.id],building_id:e.target.value,floor_id:''}}))}><option value="">Unassigned</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td><td className="p-3"><select className={inputClass} value={edit.floor_id || ''} onChange={e => setRoomEdits(v => ({...v,[room.id]:{...v[room.id],floor_id:e.target.value}}))} disabled={!edit.building_id}><option value="">Unassigned</option>{availableFloors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></td><td className="p-3"><select className={inputClass} value={edit.room_type_id || ''} onChange={e => setRoomEdits(v => ({...v,[room.id]:{...v[room.id],room_type_id:e.target.value}}))}><option value="">No type</option>{roomTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></td><td className="p-3 capitalize">{room.status || '—'}</td><td className="p-3 text-right"><button type="button" disabled={busy} onClick={() => saveRoom(room)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-bold"><Save size={14}/> Save</button></td></tr>; })}{!rooms.length && <tr><td colSpan="6" className="p-8 text-center text-[var(--text-muted)]">No rooms in this property yet. Add rooms through the existing Rooms / Apartments workflow.</td></tr>}</tbody></table></div></section>}
      </>}
    </div>
  </div>;
}
