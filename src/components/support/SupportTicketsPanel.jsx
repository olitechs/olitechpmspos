import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, MessageSquare, Plus, RefreshCw, Send, Ticket } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';

const CATEGORIES = [
  ['account_access', 'Account & access'], ['front_office', 'Front Office'],
  ['pos', 'POS'], ['inventory', 'Inventory'], ['payments', 'Payments'],
  ['reports', 'Reports'], ['devices_printing', 'Devices & printing'],
  ['bug', 'Bug / technical issue'], ['other', 'Other'],
];
const STATUS_LABELS = {
  open: 'Open', in_progress: 'In progress', waiting_for_user: 'Waiting for you',
  resolved: 'Resolved', closed: 'Closed',
};
const inputClass = 'mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--focus)]';
const cardClass = 'rounded-xl border border-[var(--border)] bg-[var(--surface)]';

function friendlyError(error) {
  const message = String(error?.message || '');
  if (/support_tickets|create_support_ticket|schema cache|does not exist/i.test(message)) {
    return 'The support-ticket service is not available yet. Please try again after the support update has been installed.';
  }
  if (/row-level security|permission denied|not authorized|42501/i.test(message)) {
    return 'Your account could not access support tickets for this property. Ask your property administrator to check your access.';
  }
  return message || 'Something went wrong. Please try again.';
}

export default function SupportTicketsPanel() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [view, setView] = useState('list');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('other');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const [reply, setReply] = useState('');

  const loadTickets = useCallback(async () => {
    if (!propertyId) {
      setLoading(false);
      setError('No active property is linked to this account. Please contact your property administrator.');
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('support_tickets')
      .select('id, subject, category, priority, status, created_at, updated_at, last_message_at')
      .eq('property_id', propertyId)
      .order('last_message_at', { ascending: false });
    if (queryError) setError(friendlyError(queryError));
    else {
      setTickets(data || []);
      if (selectedId && !(data || []).some(ticket => ticket.id === selectedId)) {
        setSelectedId(null);
        setView('list');
      }
    }
    setLoading(false);
  }, [propertyId, selectedId]);

  const loadMessages = useCallback(async (ticketId) => {
    const { data, error: queryError } = await supabase
      .from('support_ticket_messages')
      .select('id, sender_id, body, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    if (queryError) setError(friendlyError(queryError));
    else setMessages(data || []);
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
    else setMessages([]);
  }, [selectedId, loadMessages]);

  const selectedTicket = tickets.find(ticket => ticket.id === selectedId);

  const submitTicket = async (event) => {
    event.preventDefault();
    if (!propertyId || sending) return;
    setSending(true);
    setError('');
    setNotice('');
    const { data, error: rpcError } = await supabase.rpc('create_support_ticket', {
      p_property_id: propertyId,
      p_subject: subject.trim(),
      p_category: category,
      p_priority: priority,
      p_message: description.trim(),
    });
    if (rpcError) {
      setError(friendlyError(rpcError));
      setSending(false);
      return;
    }
    setSubject('');
    setDescription('');
    setPriority('normal');
    setNotice('Your support ticket has been submitted.');
    await loadTickets();
    if (data) {
      setSelectedId(data);
      setView('detail');
    } else setView('list');
    setSending(false);
  };

  const submitReply = async (event) => {
    event.preventDefault();
    if (!selectedId || !user?.id || !reply.trim() || sending || selectedTicket?.status === 'closed') return;
    setSending(true);
    setError('');
    const { error: insertError } = await supabase.from('support_ticket_messages').insert({
      ticket_id: selectedId,
      sender_id: user.id,
      body: reply.trim(),
      is_internal: false,
    });
    if (insertError) setError(friendlyError(insertError));
    else {
      setReply('');
      await Promise.all([loadMessages(selectedId), loadTickets()]);
    }
    setSending(false);
  };

  const openTicket = (id) => {
    setError('');
    setNotice('');
    setSelectedId(id);
    setView('detail');
  };

  return (
    <section className={cardClass + ' overflow-hidden'}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-primary)]"><Ticket size={19}/></span>
          <div><h2 className="text-base font-semibold text-[var(--text)]">Support tickets</h2><p className="text-xs text-[var(--text-muted)]">Contact OliTechs support and follow replies here.</p></div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setView('new'); setError(''); setNotice(''); }} className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white"><Plus size={15}/> New ticket</button>
          <button type="button" onClick={loadTickets} disabled={loading} aria-label="Refresh tickets" className="rounded-lg border border-[var(--border)] p-2 text-[var(--text-muted)] disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/></button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {error && <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-300/50 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={17} className="mt-0.5 shrink-0"/>{error}</div>}
        {notice && <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-300/50 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={17}/>{notice}</div>}

        {view === 'new' && <form onSubmit={submitTicket} className="mx-auto max-w-2xl space-y-4">
          <div className="flex items-center justify-between"><h3 className="font-semibold text-[var(--text)]">Create a support ticket</h3><button type="button" onClick={() => setView('list')} className="text-xs text-[var(--brand-primary)]">Back to tickets</button></div>
          <label className="block text-xs font-medium text-[var(--text)]">Subject<input required minLength={5} maxLength={180} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Briefly describe the issue" className={inputClass}/></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium text-[var(--text)]">Category<select value={category} onChange={e => setCategory(e.target.value)} className={inputClass}>{CATEGORIES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block text-xs font-medium text-[var(--text)]">Priority<select value={priority} onChange={e => setPriority(e.target.value)} className={inputClass}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
          </div>
          <label className="block text-xs font-medium text-[var(--text)]">Describe what happened<textarea required minLength={1} maxLength={10000} rows={5} value={description} onChange={e => setDescription(e.target.value)} placeholder="Include the steps you took, what you expected and what happened instead. Do not include guest passwords, full payment details or other sensitive information." className={inputClass + ' resize-y'}/></label>
          <div className="flex justify-end"><button disabled={sending} className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{sending ? 'Submitting…' : 'Submit ticket'}<Send size={15}/></button></div>
        </form>}

        {view === 'list' && <div>
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-[var(--text)]">Your property’s support history</h3><span className="text-xs text-[var(--text-muted)]">{tickets.length} tickets</span></div>
          {loading ? <p className="py-8 text-center text-sm text-[var(--text-muted)]">Loading tickets…</p>
            : tickets.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] px-5 py-9 text-center"><MessageSquare size={23} className="mx-auto mb-2 text-[var(--text-muted)]"/><p className="text-sm font-medium text-[var(--text)]">No support tickets yet</p><p className="mt-1 text-xs text-[var(--text-muted)]">Create a ticket and the support conversation will appear here.</p></div>
            : <div className="divide-y divide-[var(--border)]">{tickets.map(ticket => <button key={ticket.id} type="button" onClick={() => openTicket(ticket.id)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-[var(--surface-2)]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--brand-primary)]"><MessageSquare size={16}/></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[var(--text)]">{ticket.subject}</span><span className="mt-1 block text-xs text-[var(--text-muted)]">{CATEGORIES.find(([value]) => value === ticket.category)?.[1] || ticket.category} · {new Date(ticket.last_message_at).toLocaleString()}</span></span>
              <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-muted)]">{STATUS_LABELS[ticket.status] || ticket.status}</span>
            </button>)}</div>}
        </div>}

        {view === 'detail' && selectedTicket && <div>
          <button type="button" onClick={() => { setView('list'); setError(''); }} className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-primary)]"><ArrowLeft size={14}/> All tickets</button>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-[var(--text)]">{selectedTicket.subject}</h3><p className="mt-1 text-xs text-[var(--text-muted)]">{CATEGORIES.find(([value]) => value === selectedTicket.category)?.[1] || selectedTicket.category} · Opened {new Date(selectedTicket.created_at).toLocaleString()}</p></div><span className="rounded-full bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)]">{STATUS_LABELS[selectedTicket.status] || selectedTicket.status}</span></div>
          <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-xl bg-[var(--canvas)] p-3">
            {messages.map(message => <div key={message.id} className={'max-w-[90%] rounded-xl border border-[var(--border)] p-3 ' + (message.sender_id === user?.id ? 'ml-auto bg-[var(--brand-soft)]' : 'bg-[var(--surface)]')}><p className="whitespace-pre-wrap text-sm text-[var(--text)]">{message.body}</p><p className="mt-2 text-[10px] text-[var(--text-muted)]">{message.sender_id === user?.id ? 'You' : 'OliTechs support'} · {new Date(message.created_at).toLocaleString()}</p></div>)}
            {messages.length === 0 && <p className="py-6 text-center text-xs text-[var(--text-muted)]">Loading conversation…</p>}
          </div>
          {selectedTicket.status === 'closed' ? <p className="mt-4 rounded-lg bg-[var(--surface-2)] p-3 text-xs text-[var(--text-muted)]">This ticket is closed. Create a new ticket if you need further assistance.</p>
            : <form onSubmit={submitReply} className="mt-4 flex items-end gap-2"><label className="min-w-0 flex-1 text-xs font-medium text-[var(--text)]">Reply<textarea required rows={2} maxLength={10000} value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a message to support…" className={inputClass + ' resize-y'}/></label><button disabled={sending || !reply.trim()} aria-label="Send reply" className="mb-0.5 rounded-lg bg-[var(--brand-primary)] p-3 text-white disabled:opacity-50"><Send size={17}/></button></form>}
        </div>}
        {view === 'detail' && !selectedTicket && <div className="py-8 text-center text-sm text-[var(--text-muted)]"><Clock3 size={20} className="mx-auto mb-2"/>Loading ticket…</div>}
      </div>
    </section>
  );
}
