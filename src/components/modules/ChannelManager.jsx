import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Link2, Plus, RefreshCw, Trash2, Unplug, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { usePms } from '@/data/PmsStore';
import { pmsService } from '@/services/pmsService';

const panel = 'rounded-xl border border-[var(--border)] bg-[var(--surface)]';
const field = 'min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--sidebar)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]';
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]';
const timeLabel = (value) => value ? new Date(value).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }) : 'Not recorded';

function Status({ value }) {
  const status = String(value || 'unknown').toLowerCase();
  const styles = status === 'connected' || status === 'sent' || status === 'processed' || status === 'received'
    ? 'bg-[var(--success-soft)] text-[var(--success-text)]'
    : status === 'error' || status === 'failed'
      ? 'bg-[var(--danger-soft)] text-[var(--danger-text)]'
      : 'bg-[var(--warning-soft)] text-[var(--warning-text)]';
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${styles}`}>{status.replaceAll('_', ' ')}</span>;
}

export default function ChannelManager() {
  const { user } = useAuth();
  const { roomTypes = [] } = usePms();
  const propertyId = user?.property?.id;
  const [connections, setConnections] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [mappings, setMappings] = useState([]);
  const [queue, setQueue] = useState([]);
  const [inbound, setInbound] = useState([]);
  const [messages, setMessages] = useState([]);
  const [channel, setChannel] = useState('Booking.com');
  const [externalPropertyId, setExternalPropertyId] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [externalRoomTypeId, setExternalRoomTypeId] = useState('');
  const [externalRatePlanId, setExternalRatePlanId] = useState('');
  const [tab, setTab] = useState('mappings');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selected = useMemo(() => connections.find((row) => row.id === selectedId) || null, [connections, selectedId]);

  const load = useCallback(async () => {
    if (!propertyId) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const [connectionRows, queueRows, eventRows, messageRows] = await Promise.all([
        pmsService.listChannelConnections(propertyId),
        pmsService.listChannelSyncQueue(propertyId),
        pmsService.listChannelReservationEvents(propertyId),
        pmsService.listConfirmationMessages(propertyId),
      ]);
      setConnections(connectionRows);
      setQueue(queueRows);
      setInbound(eventRows);
      setMessages(messageRows);
      setSelectedId((current) => connectionRows.some((row) => row.id === current) ? current : (connectionRows[0]?.id || ''));
    } catch (cause) {
      setError(cause.message || 'Channel configuration could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const loadMappings = useCallback(async () => {
    if (!selectedId) { setMappings([]); return; }
    try { setMappings(await pmsService.listChannelRoomMappings(selectedId)); }
    catch (cause) { setError(cause.message || 'Room mappings could not be loaded.'); }
  }, [selectedId]);

  useEffect(() => { loadMappings(); }, [loadMappings]);

  const run = async (fn, success) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (success) setNotice(success); }
    catch (cause) { setError(cause.message || 'The channel operation failed.'); }
    finally { setBusy(false); }
  };

  const saveConnection = () => run(async () => {
    if (!propertyId) throw new Error('Select an active property before configuring channels.');
    const externalId = externalPropertyId.trim();
    if (!channel.trim()) throw new Error('Choose a channel.');
    const saved = await pmsService.upsertChannelConnection({ propertyId, channel: channel.trim(), externalPropertyId: externalId });
    await load();
    setSelectedId(saved.id);
    setExternalPropertyId('');
  }, 'Channel profile saved. It remains pending until an external connector is authenticated and activated.');

  const addMapping = () => run(async () => {
    if (!selected) throw new Error('Select a channel profile first.');
    if (!roomTypeId || !externalRoomTypeId.trim()) throw new Error('Select a local room type and enter its external room-type ID.');
    await pmsService.createChannelRoomMapping({
      connection_id: selected.id,
      room_type_id: roomTypeId,
      external_room_type_id: externalRoomTypeId.trim(),
      external_rate_plan_id: externalRatePlanId.trim() || null,
      active: true,
    });
    setExternalRoomTypeId(''); setExternalRatePlanId('');
    await loadMappings();
  }, 'Room-type mapping saved.');

  const removeMapping = (id) => run(async () => {
    await pmsService.deleteChannelRoomMapping(id);
    await loadMappings();
  }, 'Room-type mapping removed.');

  const toggleMapping = (row) => run(async () => {
    await pmsService.updateChannelRoomMapping(row.id, { active: !row.active });
    await loadMappings();
  }, row.active ? 'Mapping paused.' : 'Mapping activated.');

  const tabs = [
    ['mappings', 'Room mappings', mappings.length],
    ['outbound', 'Outbound queue', queue.length],
    ['inbound', 'Inbound events', inbound.length],
    ['messages', 'Confirmations', messages.length],
  ];

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--canvas)] p-3 sm:p-5">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-xl font-bold text-[var(--text)]">Channels</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Configure OTA property profiles, map room types and review channel activity.</p></div>
          <button type="button" className={button} onClick={load} disabled={loading || busy}><RefreshCw size={15}/> Refresh</button>
        </div>
        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]"><AlertCircle size={16} className="mt-0.5 shrink-0"/><span>{error}</span><button className="ml-auto" onClick={() => setError('')} aria-label="Dismiss error"><X size={15}/></button></div>}
        {notice && <div role="status" className="rounded-lg border border-[var(--success)] bg-[var(--success-soft)] p-3 text-sm text-[var(--success-text)]">{notice}</div>}

        <section className={`${panel} p-4`}>
          <div className="mb-3 flex items-center gap-2"><Link2 size={17} className="text-[var(--primary)]"/><h2 className="text-sm font-bold text-[var(--text)]">Channel property profiles</h2></div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <label><span className={label}>Channel</span><select className={field} value={channel} onChange={(event) => setChannel(event.target.value)}><option>Booking.com</option><option>Expedia</option><option>Airbnb</option><option>SiteMinder</option><option>Other Channel Manager</option></select></label>
            <label><span className={label}>External property ID</span><input className={field} value={externalPropertyId} onChange={(event) => setExternalPropertyId(event.target.value)} placeholder="Property ID from channel"/></label>
            <div className="flex items-end"><button type="button" className={`${button} w-full bg-[var(--brand-primary)] text-[var(--white)]`} disabled={busy || !propertyId} onClick={saveConnection}><Plus size={15}/> Save profile</button></div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {connections.map((row) => <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`rounded-lg border p-3 text-left transition-colors ${selectedId === row.id ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--sidebar)]'}`} aria-pressed={selectedId === row.id}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold text-sm text-[var(--text)]">{row.channel}</span><Status value={row.status}/></div>
              <div className="mt-1 truncate text-xs text-[var(--text-muted)]">External ID: {row.external_property_id || 'Not set'}</div>
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">Last sync: {timeLabel(row.last_sync_at)}</div>
              {row.last_error && <div className="mt-2 text-xs text-[var(--danger-text)]">{row.last_error}</div>}
            </button>)}
            {!loading && !connections.length && <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)] sm:col-span-2 xl:col-span-3">No channel profiles configured for this property yet.</div>}
          </div>
        </section>

        <section className={panel}>
          <div className="flex flex-wrap gap-2 border-b border-[var(--border)] p-3">
            {tabs.map(([id, title, count]) => <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${tab === id ? 'bg-[var(--brand-primary)] text-[var(--white)]' : 'bg-[var(--sidebar)] text-[var(--text-muted)]'}`}>{title}<span className="ml-2 opacity-75">{count}</span></button>)}
          </div>

          {tab === 'mappings' && <div className="space-y-3 p-4">
            {!selected ? <p className="text-sm text-[var(--text-muted)]">Create or select a channel profile to manage room mappings.</p> : <>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <label><span className={label}>Local room type</span><select className={field} value={roomTypeId} onChange={(event) => setRoomTypeId(event.target.value)}><option value="">Select room type</option>{roomTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
                <label><span className={label}>External room-type ID</span><input className={field} value={externalRoomTypeId} onChange={(event) => setExternalRoomTypeId(event.target.value)} placeholder="Channel room ID"/></label>
                <label><span className={label}>External rate-plan ID (optional)</span><input className={field} value={externalRatePlanId} onChange={(event) => setExternalRatePlanId(event.target.value)} placeholder="Rate plan ID"/></label>
                <div className="flex items-end"><button type="button" className={`${button} w-full bg-[var(--brand-primary)] text-[var(--white)]`} disabled={busy || !roomTypes.length} onClick={addMapping}><Plus size={15}/> Add mapping</button></div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                <table className="w-full min-w-[650px] text-sm"><thead className="bg-[var(--sidebar)] text-left text-[11px] uppercase text-[var(--text-muted)]"><tr>{['Local room type','External room type','External rate plan','Status','Actions'].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead>
                  <tbody>{mappings.map((row) => <tr key={row.id} className="border-t border-[var(--border)]"><td className="px-3 py-3 font-semibold text-[var(--text)]">{row.room_type?.name || 'Room type'}</td><td className="px-3 py-3 text-[var(--text-muted)]">{row.external_room_type_id}</td><td className="px-3 py-3 text-[var(--text-muted)]">{row.external_rate_plan_id || '—'}</td><td className="px-3 py-3"><Status value={row.active ? 'active' : 'paused'}/></td><td className="px-3 py-3"><div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => toggleMapping(row)}>{row.active ? <Unplug size={14}/> : <CheckCircle2 size={14}/>}{row.active ? 'Pause' : 'Activate'}</button><button type="button" aria-label="Delete mapping" title="Delete mapping" className={button} disabled={busy} onClick={() => removeMapping(row.id)}><Trash2 size={14}/></button></div></td></tr>)}
                  {!mappings.length && <tr><td colSpan={5} className="p-6 text-center text-sm text-[var(--text-muted)]">No mappings configured for this channel.</td></tr>}</tbody>
                </table>
              </div>
            </>}
          </div>}

          {tab === 'outbound' && <EventTable rows={queue} kind="outbound" empty="No outbound sync jobs have been queued."/>}
          {tab === 'inbound' && <EventTable rows={inbound} kind="inbound" empty="No inbound reservation events have been received."/>}
          {tab === 'messages' && <EventTable rows={messages} kind="messages" empty="No confirmation messages have been queued."/>}
        </section>

        <section className="rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] p-4">
          <div className="flex items-start gap-2"><Clock3 size={17} className="mt-0.5 shrink-0 text-[var(--warning-text)]"/><div><h3 className="text-sm font-bold text-[var(--warning-text)]">Connector activation is still required</h3><p className="mt-1 text-xs leading-5 text-[var(--warning-text)]">This workspace saves channel profiles and room mappings and displays the existing sync queues and inbound events. The current project does not expose OTA credentials, a verified Booking.com / Expedia API connection, or a running sync worker here. A profile marked Pending is not live inventory synchronisation. Do not treat queued events as sent or reservations as imported until a connector is authenticated and its worker is operating.</p></div></div>
        </section>
      </div>
    </div>
  );
}

function EventTable({ rows, kind, empty }) {
  const columns = kind === 'outbound'
    ? ['Event','Status','Attempts','Created','Last error']
    : kind === 'inbound'
      ? ['External reservation','Event','Status','Received','Error']
      : ['Channel','Recipient','Subject','Status','Created','Last error'];
  return <div className="overflow-x-auto p-4"><table className="w-full min-w-[700px] text-sm"><thead className="bg-[var(--sidebar)] text-left text-[11px] uppercase text-[var(--text-muted)]"><tr>{columns.map((column) => <th key={column} className="px-3 py-3">{column}</th>)}</tr></thead><tbody>
    {rows.map((row) => <tr key={row.id} className="border-t border-[var(--border)]">
      {kind === 'outbound' && <><td className="px-3 py-3 font-semibold text-[var(--text)]">{row.event_type}</td><td className="px-3 py-3"><Status value={row.status}/></td><td className="px-3 py-3">{row.attempts ?? 0}</td><td className="px-3 py-3 text-xs text-[var(--text-muted)]">{timeLabel(row.created_at)}</td><td className="px-3 py-3 text-xs text-[var(--danger-text)]">{row.last_error || '—'}</td></>}
      {kind === 'inbound' && <><td className="px-3 py-3 font-mono text-xs">{row.external_reservation_id}</td><td className="px-3 py-3">{row.event_type}</td><td className="px-3 py-3"><Status value={row.status}/></td><td className="px-3 py-3 text-xs text-[var(--text-muted)]">{timeLabel(row.received_at)}</td><td className="px-3 py-3 text-xs text-[var(--danger-text)]">{row.error_message || '—'}</td></>}
      {kind === 'messages' && <><td className="px-3 py-3">{row.channel}</td><td className="px-3 py-3">{row.recipient || '—'}</td><td className="px-3 py-3">{row.subject || '—'}</td><td className="px-3 py-3"><Status value={row.status}/></td><td className="px-3 py-3 text-xs text-[var(--text-muted)]">{timeLabel(row.created_at)}</td><td className="px-3 py-3 text-xs text-[var(--danger-text)]">{row.last_error || '—'}</td></>}
    </tr>)}
    {!rows.length && <tr><td colSpan={columns.length} className="p-8 text-center text-sm text-[var(--text-muted)]">{empty}</td></tr>}
  </tbody></table></div>;
}
