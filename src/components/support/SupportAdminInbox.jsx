import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';

const STATUS_OPTIONS = [
  ['open', 'Open'], ['in_progress', 'In progress'],
  ['waiting_for_user', 'Waiting for user'], ['resolved', 'Resolved'], ['closed', 'Closed'],
];
const CATEGORY_LABELS = {
  account_access: 'Account & access', front_office: 'Front Office', pos: 'POS',
  inventory: 'Inventory', payments: 'Payments', reports: 'Reports',
  devices_printing: 'Devices & printing', bug: 'Bug / technical issue', other: 'Other',
};

export default function SupportAdminInbox() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user?.isPlatformOwner) { setLoading(false); return; }
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('support_tickets')
      .select('id, property_id, subject, category, priority, status, created_at, last_message_at')
      .order('last_message_at', { ascending: false });
    if (queryError) setError(queryError.message || 'Unable to load support inbox.');
    else {
      setTickets(data || []);
      if (selectedId && !(data || []).some(ticket => ticket.id === selectedId)) setSelectedId('');
    }
    setLoading(false);
  }, [user?.isPlatformOwner, selectedId]);

  const loadMessages = useCallback(async (id) => {
    const { data, error: queryError } = await supabase
      .from('support_ticket_messages')
      .select('id, sender_id, body, is_internal, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });
    if (queryError) setError(queryError.message || 'Unable to load conversation.');
    else setMessages(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ticket = tickets.find(item => item.id === selectedId);
    if (ticket) {
      setStatus(ticket.status);
      loadMessages(selectedId);
    } else setMessages([]);
  }, [selectedId, tickets, loadMessages]);

  if (!user?.isPlatformOwner) return null;

  const selected = tickets.find(ticket => ticket.id === selectedId);
  const updateStatus = async (nextStatus) => {
    if (!selected || sending) return;
    setSending(true);
    setError('');
    const { error: updateError } = await supabase.from('support_tickets').update({ status: nextStatus }).eq('id', selected.id);
    if (updateError) setError(updateError.message || 'Unable to update ticket status.');
    else { setStatus(nextStatus); await load(); }
    setSending(false);
  };
  const sendReply = async (event) => {
    event.preventDefault();
    if (!selected || !reply.trim() || sending) return;
    setSending(true);
    setError('');
    const { error: insertError } = await supabase.from('support_ticket_messages').insert({
      ticket_id: selected.id, sender_id: user.id, body: reply.trim(), is_internal: false,
    });
    if (insertError) setError(insertError.message || 'Unable to send reply.');
    else { setReply(''); await Promise.all([loadMessages(selected.id), load()]); }
    setSending(false);
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-2.5 text-primary"><ShieldCheck className="h-5 w-5"/></span><div><h2 className="text-lg font-semibold">OliTechs Support Inbox</h2><p className="text-xs text-muted-foreground">Platform-wide customer tickets and replies</p></div></div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium disabled:opacity-50"><RefreshCw className={'h-4 w-4 '+(loading?'animate-spin':'')}/> Refresh</button>
      </div>
      {error && <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle size={16}/>{error}</div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.4fr)]">
        <div className="max-h-[520px] overflow-y-auto rounded-xl border border-border">
          {loading ? <p className="p-5 text-sm text-muted-foreground">Loading support tickets…</p>
            : tickets.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No support tickets have been submitted.</p>
            : tickets.map(ticket => <button key={ticket.id} type="button" onClick={() => setSelectedId(ticket.id)} className={'w-full border-b border-border p-3 text-left last:border-0 '+(selectedId===ticket.id?'bg-primary/10':'hover:bg-muted/40')}>
              <div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold">{ticket.subject}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{ticket.status.replaceAll('_',' ')}</span></div>
              <div className="mt-1 text-xs text-muted-foreground">{CATEGORY_LABELS[ticket.category] || ticket.category} · {ticket.priority} priority</div>
              <div className="mt-1 truncate text-[10px] text-muted-foreground">Property {ticket.property_id} · {new Date(ticket.last_message_at).toLocaleString()}</div>
            </button>)}
        </div>
        <div className="min-w-0">
          {!selected ? <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Select a ticket to review its conversation and respond.</div>
            : <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{selected.subject}</h3><p className="mt-1 text-xs text-muted-foreground">Property ID: {selected.property_id} · Submitted {new Date(selected.created_at).toLocaleString()}</p></div><label className="text-xs font-medium">Status<select value={status} onChange={e => updateStatus(e.target.value)} disabled={sending} className="mt-1 block rounded-lg border border-border bg-background px-2 py-2 text-xs">{STATUS_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
              <div className="max-h-[350px] space-y-3 overflow-y-auto rounded-xl bg-muted/30 p-3">
                {messages.map(message => <div key={message.id} className={'max-w-[92%] rounded-xl border border-border p-3 '+(message.is_internal?'bg-amber-50':'bg-card')}><p className="whitespace-pre-wrap text-sm">{message.body}</p><p className="mt-2 text-[10px] text-muted-foreground">{message.sender_id===user.id?'You':'Property user'} · {new Date(message.created_at).toLocaleString()}</p></div>)}
                {messages.length===0 && <p className="py-5 text-center text-xs text-muted-foreground">No messages found.</p>}
              </div>
              {selected.status !== 'closed' && <form onSubmit={sendReply} className="mt-3 flex items-end gap-2"><label className="min-w-0 flex-1 text-xs font-medium">Reply to customer<textarea rows={2} required maxLength={10000} value={reply} onChange={e=>setReply(e.target.value)} className="mt-1 w-full resize-y rounded-lg border border-border bg-background p-2.5 text-sm" placeholder="Write a response…"/></label><button disabled={sending||!reply.trim()} aria-label="Send reply" className="rounded-lg bg-primary p-3 text-primary-foreground disabled:opacity-50"><Send size={16}/></button></form>}
              {selected.status==='closed' && <p className="mt-3 text-xs text-muted-foreground">This ticket is closed.</p>}
            </div>}
        </div>
      </div>
    </section>
  );
}
