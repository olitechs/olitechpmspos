import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, BedDouble, Layers3 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import { useQueryClient } from '@tanstack/react-query';
import { pmsQueryKeys, usePmsRoomsQuery, usePmsRoomTypesQuery, usePmsRatePlansQuery } from '@/hooks/usePmsQuery';
import { NAVY, TEAL, TEAL_DARK, SAND, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE } from '@/data/themePalette';

const blankType = { code: '', name: '', description: '', view_type: '', bed_configuration: '', max_occupancy: 2, size_sqm: '', base_rate: 0, amenities: '' };
const blankRoom = { number: '', floor: 1, room_type_id: '', capacity: 2, beds: '', base_rate: 0, status: 'available', name: '', description: '' };
const blankRate = { code: '', name: '', description: '', meal_plan: 'room_only', cancellation_policy: '', default_rate: 0 };

function Field({ label, children }) { return <label className="block text-xs font-semibold" style={{ color: NAVY }}>{label}<div className="mt-1">{children}</div></label>; }
function Input(props) { return <input {...props} className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }} />; }
function Select(props) { return <select {...props} className="w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }} />; }

export default function RoomManagement({ onChanged }) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const queryClient = useQueryClient();
  const typesQuery = usePmsRoomTypesQuery(propertyId);
  const roomsQuery = usePmsRoomsQuery(propertyId);
  const ratePlansQuery = usePmsRatePlansQuery(propertyId);
  const types = typesQuery.data || [];
  const rooms = roomsQuery.data || [];
  const ratePlans = ratePlansQuery.data || [];
  const [typeForm, setTypeForm] = useState(blankType);
  const [roomForm, setRoomForm] = useState(blankRoom);
  const [ratePlans, setRatePlans] = useState([]);
  const [rateForm, setRateForm] = useState(blankRate);
  const [editingRate, setEditingRate] = useState(null);
  const [editingType, setEditingType] = useState(null);
  const [editingRoom, setEditingRoom] = useState(null);
  const [view, setView] = useState('types');
  const [error, setError] = useState('');

  useEffect(() => {
    const firstError = typesQuery.error || roomsQuery.error || ratePlansQuery.error;
    setError(firstError?.message || '');
  }, [typesQuery.error, roomsQuery.error, ratePlansQuery.error]);

  const submitType = async (e) => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...typeForm, property_id: propertyId, max_occupancy: Number(typeForm.max_occupancy), size_sqm: typeForm.size_sqm === '' ? null : Number(typeForm.size_sqm), base_rate: Number(typeForm.base_rate || 0), amenities: typeForm.amenities.split(',').map(s => s.trim()).filter(Boolean) };
      if (editingType) await pmsService.updateRoomType(editingType, payload); else await pmsService.createRoomType(payload);
      setTypeForm(blankType); setEditingType(null); await queryClient.invalidateQueries({ queryKey: pmsQueryKeys.roomTypes(propertyId) }); onChanged?.();
    } catch (e2) { setError(e2.message); }
  };

  const submitRoom = async (e) => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...roomForm, property_id: propertyId, number: Number(roomForm.number), floor: Number(roomForm.floor), capacity: Number(roomForm.capacity), base_rate: Number(roomForm.base_rate || 0), room_type_id: roomForm.room_type_id || null };
      if (editingRoom) await pmsService.updateRoom(editingRoom, payload); else await pmsService.createRoom(payload);
      setRoomForm(blankRoom); setEditingRoom(null); await queryClient.invalidateQueries({ queryKey: pmsQueryKeys.rooms(propertyId) }); onChanged?.();
    } catch (e2) { setError(e2.message); }
  };

  const submitRate = async (e) => {
    e.preventDefault(); setError('');
    try {
      const payload = { ...rateForm, property_id: propertyId, default_rate: Number(rateForm.default_rate || 0) };
      if (editingRate) await pmsService.updateRatePlan(editingRate, payload); else await pmsService.createRatePlan(payload);
      setRateForm(blankRate); setEditingRate(null); await queryClient.invalidateQueries({ queryKey: pmsQueryKeys.ratePlans(propertyId) });
    } catch (e2) { setError(e2.message); }
  };

  const startRateEdit = (r) => setEditingRate(r.id) || setRateForm({ ...r });
  const removeRate = async (id) => { if (!confirm('Delete this rate plan?')) return; try { await pmsService.deleteRatePlan(id); await queryClient.invalidateQueries({ queryKey: pmsQueryKeys.ratePlans(propertyId) }); } catch(e){ setError(e.message); } };

  const startTypeEdit = (t) => { setEditingType(t.id); setTypeForm({ ...t, amenities: Array.isArray(t.amenities) ? t.amenities.join(', ') : '' }); };
  const startRoomEdit = (r) => { setEditingRoom(r.id); setRoomForm({ ...blankRoom, ...r }); };
  const removeType = async (id) => { if (!confirm('Delete this room type? Rooms using it will keep their room but lose the type.')) return; try { await pmsService.deleteRoomType(id); await queryClient.invalidateQueries({ queryKey: pmsQueryKeys.roomTypes(propertyId) }); } catch(e){ setError(e.message); } };
  const removeRoom = async (id) => { if (!confirm('Delete this room?')) return; try { await pmsService.deleteRoom(id); await queryClient.invalidateQueries({ queryKey: pmsQueryKeys.rooms(propertyId) }); onChanged?.(); } catch(e){ setError(e.message); } };
  const typeMap = useMemo(() => new Map(types.map(t => [t.id, t])), [types]);

  return <div className="flex-1 overflow-y-auto p-4" style={{ background: SAND }}>
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {['types','rooms','rates'].map(v => <button key={v} onClick={() => setView(v)} className="px-4 py-2 rounded-full text-sm font-semibold" style={{ background: view === v ? NAVY : SURFACE, color: view === v ? SAND : MUTED, border: `1px solid ${BORDER}` }}>{v === 'types' ? 'Room Types' : v === 'rooms' ? 'Rooms' : 'Rate Plans'}</button>)}
      <div className="ml-auto text-xs" style={{ color: MUTED }}>{types.length} types · {rooms.length} rooms</div>
    </div>
    {error && <div className="mb-3 p-3 rounded-xl text-sm" style={{ background: '#FDECEC', color: DESTRUCTIVE }}>{error}</div>}

    {view === 'types' && <div className="grid lg:grid-cols-3 gap-4">
      <form onSubmit={submitType} className="rounded-2xl p-4 h-fit" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2 mb-4"><Layers3 size={17} style={{ color: TEAL_DARK }}/><h3 className="font-bold text-sm" style={{ color: NAVY }}>{editingType ? 'Edit Room Type' : 'Add Room Type'}</h3></div>
        <div className="space-y-3">
          <Field label="Code *"><Input required value={typeForm.code} onChange={e=>setTypeForm({...typeForm,code:e.target.value.toUpperCase()})} placeholder="STD-GV" /></Field>
          <Field label="Room type name *"><Input required value={typeForm.name} onChange={e=>setTypeForm({...typeForm,name:e.target.value})} placeholder="Standard Garden View" /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="View"><Input value={typeForm.view_type} onChange={e=>setTypeForm({...typeForm,view_type:e.target.value})} placeholder="Garden View" /></Field><Field label="Bed configuration"><Input value={typeForm.bed_configuration} onChange={e=>setTypeForm({...typeForm,bed_configuration:e.target.value})} placeholder="1 King Bed" /></Field></div>
          <div className="grid grid-cols-3 gap-3"><Field label="Max guests"><Input type="number" min="1" value={typeForm.max_occupancy} onChange={e=>setTypeForm({...typeForm,max_occupancy:e.target.value})}/></Field><Field label="Size m²"><Input type="number" min="0" value={typeForm.size_sqm} onChange={e=>setTypeForm({...typeForm,size_sqm:e.target.value})}/></Field><Field label="Base rate"><Input type="number" min="0" value={typeForm.base_rate} onChange={e=>setTypeForm({...typeForm,base_rate:e.target.value})}/></Field></div>
          <Field label="Description"><textarea value={typeForm.description} onChange={e=>setTypeForm({...typeForm,description:e.target.value})} className="w-full px-3 py-2.5 rounded-lg text-sm outline-none min-h-20" style={{background:SURFACE2,border:`1px solid ${BORDER}`,color:NAVY}}/></Field>
          <Field label="Amenities (comma separated)"><Input value={typeForm.amenities} onChange={e=>setTypeForm({...typeForm,amenities:e.target.value})} placeholder="Wi-Fi, TV, Air Conditioning, Terrace"/></Field>
          <div className="flex gap-2"><button className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{background:TEAL,color:'#090C11'}}>{editingType?'Save Changes':'Add Room Type'}</button>{editingType&&<button type="button" onClick={()=>{setEditingType(null);setTypeForm(blankType)}} className="px-4 rounded-xl text-sm" style={{border:`1px solid ${BORDER}`,color:MUTED}}>Cancel</button>}</div>
        </div>
      </form>
      <div className="lg:col-span-2 grid md:grid-cols-2 gap-3 h-fit">
        {types.map(t=><div key={t.id} className="rounded-2xl p-4" style={{background:SURFACE,border:`1px solid ${BORDER}`}}><div className="flex items-start justify-between gap-2"><div><div className="text-xs font-mono font-bold" style={{color:TEAL_DARK}}>{t.code}</div><div className="font-bold mt-1" style={{color:NAVY}}>{t.name}</div></div><div className="flex gap-1"><button onClick={()=>startTypeEdit(t)} className="p-2 rounded-lg" style={{border:`1px solid ${BORDER}`,color:MUTED}}><Pencil size={14}/></button><button onClick={()=>removeType(t.id)} className="p-2 rounded-lg" style={{border:`1px solid ${BORDER}`,color:DESTRUCTIVE}}><Trash2 size={14}/></button></div></div><div className="text-xs mt-3 space-y-1" style={{color:MUTED}}><div>{t.view_type || 'No view'} · {t.bed_configuration || 'Beds not specified'}</div><div>Up to {t.max_occupancy} guests · KES {Number(t.base_rate||0).toLocaleString()}/night</div><div>{Array.isArray(t.amenities)?t.amenities.join(' · '):'No amenities listed'}</div></div></div>)}
        {types.length===0&&<div className="md:col-span-2 p-8 text-center text-sm" style={{color:MUTED}}>No room types yet. Add your first type.</div>}
      </div>
    </div>}

    {view === 'rates' && <div className="grid lg:grid-cols-3 gap-4">
      <form onSubmit={submitRate} className="rounded-2xl p-4 h-fit" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        <div className="flex items-center gap-2 mb-4"><Layers3 size={17} style={{color:TEAL_DARK}}/><h3 className="font-bold text-sm" style={{color:NAVY}}>{editingRate?'Edit Rate Plan':'Add Rate Plan'}</h3></div>
        <div className="space-y-3"><Field label="Code *"><Input required value={rateForm.code} onChange={e=>setRateForm({...rateForm,code:e.target.value.toUpperCase()})} placeholder="BAR"/></Field><Field label="Name *"><Input required value={rateForm.name} onChange={e=>setRateForm({...rateForm,name:e.target.value})} placeholder="Best Available Rate"/></Field><Field label="Meal plan"><Select value={rateForm.meal_plan} onChange={e=>setRateForm({...rateForm,meal_plan:e.target.value})}><option value="room_only">Room Only</option><option value="breakfast">Bed & Breakfast</option><option value="half_board">Half Board</option><option value="full_board">Full Board</option><option value="all_inclusive">All Inclusive</option></Select></Field><Field label="Default rate"><Input type="number" min="0" value={rateForm.default_rate} onChange={e=>setRateForm({...rateForm,default_rate:e.target.value})}/></Field><Field label="Cancellation policy"><Input value={rateForm.cancellation_policy} onChange={e=>setRateForm({...rateForm,cancellation_policy:e.target.value})} placeholder="Free cancellation 48h before arrival"/></Field><Field label="Description"><textarea value={rateForm.description||''} onChange={e=>setRateForm({...rateForm,description:e.target.value})} className="w-full px-3 py-2.5 rounded-lg text-sm outline-none min-h-20" style={{background:SURFACE2,border:`1px solid ${BORDER}`,color:NAVY}}/></Field><div className="flex gap-2"><button className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{background:TEAL,color:'#090C11'}}>{editingRate?'Save Changes':'Add Rate Plan'}</button>{editingRate&&<button type="button" onClick={()=>{setEditingRate(null);setRateForm(blankRate)}} className="px-4 rounded-xl text-sm" style={{border:`1px solid ${BORDER}`,color:MUTED}}>Cancel</button>}</div></div>
      </form>
      <div className="lg:col-span-2 rounded-2xl overflow-hidden h-fit" style={{background:SURFACE,border:`1px solid ${BORDER}`}}><table className="w-full text-sm"><thead><tr style={{background:SURFACE2,borderBottom:`1px solid ${BORDER}`}}>{['Code','Rate plan','Meal plan','Default rate','Cancellation',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-wide" style={{color:MUTED}}>{h}</th>)}</tr></thead><tbody>{ratePlans.map((r,i)=><tr key={r.id} style={{borderBottom:`1px solid ${BORDER}`,background:i%2?SURFACE2:SURFACE}}><td className="px-4 py-3 font-mono font-bold" style={{color:TEAL_DARK}}>{r.code}</td><td className="px-4 py-3 font-semibold" style={{color:NAVY}}>{r.name}</td><td className="px-4 py-3 text-xs capitalize" style={{color:MUTED}}>{String(r.meal_plan).replaceAll('_',' ')}</td><td className="px-4 py-3 text-xs font-mono" style={{color:NAVY}}>KES {Number(r.default_rate||0).toLocaleString()}</td><td className="px-4 py-3 text-xs" style={{color:MUTED}}>{r.cancellation_policy||'—'}</td><td className="px-4 py-3"><div className="flex gap-1"><button onClick={()=>startRateEdit(r)} className="p-2 rounded-lg" style={{border:`1px solid ${BORDER}`,color:MUTED}}><Pencil size={14}/></button><button onClick={()=>removeRate(r.id)} className="p-2 rounded-lg" style={{border:`1px solid ${BORDER}`,color:DESTRUCTIVE}}><Trash2 size={14}/></button></div></td></tr>)}{ratePlans.length===0&&<tr><td colSpan={6} className="p-8 text-center" style={{color:MUTED}}>No rate plans configured.</td></tr>}</tbody></table></div>
    </div>}

    {view === 'rooms' && <div className="grid lg:grid-cols-3 gap-4">
      <form onSubmit={submitRoom} className="rounded-2xl p-4 h-fit" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        <div className="flex items-center gap-2 mb-4"><BedDouble size={17} style={{color:TEAL_DARK}}/><h3 className="font-bold text-sm" style={{color:NAVY}}>{editingRoom?'Edit Room':'Add Room'}</h3></div>
        <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="Room number *"><Input required type="number" min="1" value={roomForm.number} onChange={e=>setRoomForm({...roomForm,number:e.target.value})}/></Field><Field label="Floor"><Input type="number" value={roomForm.floor} onChange={e=>setRoomForm({...roomForm,floor:e.target.value})}/></Field></div><Field label="Room type"><Select value={roomForm.room_type_id} onChange={e=>setRoomForm({...roomForm,room_type_id:e.target.value})}><option value="">Unassigned</option>{types.filter(t=>t.active).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field><div className="grid grid-cols-2 gap-3"><Field label="Capacity"><Input type="number" min="1" value={roomForm.capacity} onChange={e=>setRoomForm({...roomForm,capacity:e.target.value})}/></Field><Field label="Base rate"><Input type="number" min="0" value={roomForm.base_rate} onChange={e=>setRoomForm({...roomForm,base_rate:e.target.value})}/></Field></div><Field label="Bed details"><Input value={roomForm.beds} onChange={e=>setRoomForm({...roomForm,beds:e.target.value})} placeholder="1 King Bed"/></Field><Field label="Room name"><Input value={roomForm.name||''} onChange={e=>setRoomForm({...roomForm,name:e.target.value})} placeholder="Garden Wing 101"/></Field><Field label="Description"><textarea value={roomForm.description||''} onChange={e=>setRoomForm({...roomForm,description:e.target.value})} className="w-full px-3 py-2.5 rounded-lg text-sm outline-none min-h-20" style={{background:SURFACE2,border:`1px solid ${BORDER}`,color:NAVY}}/></Field><div className="flex gap-2"><button className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{background:TEAL,color:'#090C11'}}>{editingRoom?'Save Changes':'Add Room'}</button>{editingRoom&&<button type="button" onClick={()=>{setEditingRoom(null);setRoomForm(blankRoom)}} className="px-4 rounded-xl text-sm" style={{border:`1px solid ${BORDER}`,color:MUTED}}>Cancel</button>}</div></div>
      </form>
      <div className="lg:col-span-2 rounded-2xl overflow-hidden h-fit" style={{background:SURFACE,border:`1px solid ${BORDER}`}}><table className="w-full text-sm"><thead><tr style={{background:SURFACE2,borderBottom:`1px solid ${BORDER}`}}>{['Room','Type','Floor','Capacity','Rate','Status',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-wide" style={{color:MUTED}}>{h}</th>)}</tr></thead><tbody>{rooms.map((r,i)=><tr key={r.id} style={{borderBottom:`1px solid ${BORDER}`,background:i%2?SURFACE2:SURFACE}}><td className="px-4 py-3 font-bold" style={{color:NAVY}}>Room {r.number}{r.name&&<div className="text-xs font-normal" style={{color:MUTED}}>{r.name}</div>}</td><td className="px-4 py-3 text-xs" style={{color:MUTED}}>{typeMap.get(r.room_type_id)?.name||r.room_type||'Unassigned'}</td><td className="px-4 py-3 text-xs" style={{color:MUTED}}>{r.floor??'—'}</td><td className="px-4 py-3 text-xs" style={{color:MUTED}}>{r.capacity}</td><td className="px-4 py-3 text-xs font-mono" style={{color:NAVY}}>KES {Number(r.base_rate||0).toLocaleString()}</td><td className="px-4 py-3 text-xs capitalize" style={{color:TEAL_DARK}}>{String(r.status).replaceAll('_',' ')}</td><td className="px-4 py-3"><div className="flex gap-1"><button onClick={()=>startRoomEdit(r)} className="p-2 rounded-lg" style={{border:`1px solid ${BORDER}`,color:MUTED}}><Pencil size={14}/></button><button onClick={()=>removeRoom(r.id)} className="p-2 rounded-lg" style={{border:`1px solid ${BORDER}`,color:DESTRUCTIVE}}><Trash2 size={14}/></button></div></td></tr>)}{rooms.length===0&&<tr><td colSpan={7} className="p-8 text-center" style={{color:MUTED}}>No rooms configured.</td></tr>}</tbody></table></div>
    </div>}
  </div>;
}
