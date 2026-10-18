import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Mail, ArrowUpDown, Inbox } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';

const BORDER = '#E5E5E5';
const SURFACE = '#FFFFFF';
const MUTED = '#757B81';

export default function DistributionOps() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [queue, setQueue] = useState([]);
  const [events, setEvents] = useState([]);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      setError('');
      const [nextQueue, nextEvents, nextMessages] = await Promise.all([
        pmsService.listChannelSyncQueue(propertyId),
        pmsService.listChannelReservationEvents(propertyId),
        pmsService.listConfirmationMessages(propertyId),
      ]);
      setQueue(nextQueue);
      setEvents(nextEvents);
      setMessages(nextMessages);
    } catch (loadError) {
      setError(loadError?.message || 'Unable to load distribution operations.');
    }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const card = (title, icon, data, renderFields) => (
    <section className="overflow-hidden rounded-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2 border-b p-4" style={{ borderColor: BORDER }}>
        {icon}
        <div>
          <h2 className="text-sm font-black uppercase">{title}</h2>
          <p className="text-xs" style={{ color: MUTED }}>{data.length} records</p>
        </div>
      </div>
      {data.slice(0, 8).map((item) => (
        <div key={item.id} className="border-b p-3 text-xs" style={{ borderColor: BORDER }}>
          {renderFields(item)}
        </div>
      ))}
      {!data.length && <div className="p-5 text-xs" style={{ color: MUTED }}>No records.</div>}
    </section>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: '#F8F8F7' }}>
      <div className="mb-4 flex justify-between">
        <div>
          <h1 className="text-lg font-black">Distribution Operations</h1>
          <p className="text-xs" style={{ color: MUTED }}>Monitor channel synchronization, inbound reservations and guest confirmations.</p>
        </div>
        <button type="button" onClick={load} className="rounded-lg p-2" style={{ background: SURFACE, border: `1px solid ${BORDER}` }} aria-label="Refresh distribution operations">
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <p role="alert" className="mb-3 text-xs text-red-600">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        {card('Outbound Sync', <ArrowUpDown size={17} />, queue, (item) => (
          <><b>{item.event_type}</b> · {item.status}<div style={{ color: MUTED }}>{item.idempotency_key}</div></>
        ))}
        {card('Reservation Inbox', <Inbox size={17} />, events, (item) => (
          <><b>{item.external_reservation_id}</b> · {item.event_type}<div style={{ color: MUTED }}>{item.status}</div></>
        ))}
        {card('Confirmations', <Mail size={17} />, messages, (item) => (
          <><b>{item.channel}</b> · {item.status}<div style={{ color: MUTED }}>{item.recipient || 'No recipient'}</div></>
        ))}
      </div>
    </div>
  );
}
