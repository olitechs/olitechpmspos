import React, { useMemo, useState } from 'react';
import { BookOpen, Search, MessageCircle, ChevronDown, LifeBuoy, ClipboardList, BedDouble, ShoppingCart, BarChart3, Settings, Printer, CircleHelp } from 'lucide-react';

const ARTICLES = [
  { category: 'Getting started', title: 'Getting started with OliTechs', summary: 'A quick orientation to the main workspaces.', steps: ['Sign in with the account provided by your property administrator.', 'Choose the workspace available to your role: Back Office, Front Office, POS or Stores.', 'Use the left navigation to open a module. Your available modules depend on your role and subscription.', 'Use the Help Centre search whenever you need guidance.'] },
  { category: 'Getting started', title: 'Understanding staff access and roles', summary: 'Why different staff members see different screens.', steps: ['Access is assigned by a property administrator.', 'Your role determines which areas of the application you can open.', 'If a required screen is missing, contact your property administrator to review your access.', 'Never share your login credentials with another staff member.'] },
  { category: 'Front Office', title: 'Finding reservations', summary: 'Open the reservation workflow and locate a guest booking.', steps: ['Open the Front Office workspace.', 'Choose Reservations from the navigation.', 'Use the available search and date filters to narrow the list.', 'Open the relevant reservation to review its details before making changes.'] },
  { category: 'Front Office', title: 'Room planning and room status', summary: 'Understand the room-planning workflow.', steps: ['Open Front Office and select Room Planner.', 'Review room assignments against the displayed dates.', 'Check the current room status before assigning or moving a reservation.', 'Follow your property procedure when confirming room readiness with housekeeping.'] },
  { category: 'Front Office', title: 'Guest folios', summary: 'Review guest charges and payment activity.', steps: ['Open the guest reservation or folio.', 'Review posted charges, payments and outstanding balance.', 'Confirm the guest and folio before posting any financial transaction.', 'If a posted transaction looks incorrect, follow the authorized correction or reversal workflow; do not create an informal balancing entry.'] },
  { category: 'POS', title: 'Processing a POS order', summary: 'A safe overview of the sales workflow.', steps: ['Open the POS workspace.', 'Select the appropriate service area or table if your setup uses them.', 'Add the requested products and review quantities.', 'Confirm the order details before submitting or settling it.', 'Follow your property payment and receipt procedure.'] },
  { category: 'POS', title: 'Kitchen Display System', summary: 'Track kitchen order progress.', steps: ['Open Stores and choose KDS where enabled.', 'Review incoming orders and their displayed status.', 'Update order progress only as the kitchen workflow allows.', 'If an order is missing, confirm its POS status before asking an administrator to investigate.'] },
  { category: 'Inventory', title: 'Reviewing stock levels', summary: 'Find products and inspect available stock.', steps: ['Open Back Office and choose Inventory management.', 'Open the relevant inventory view, item or location.', 'Check the product and location carefully before taking action.', 'Use the approved adjustment, count or transfer workflow rather than editing balances outside the application.'] },
  { category: 'Inventory', title: 'Stock counts and adjustments', summary: 'Prepare for a controlled stock correction.', steps: ['Open Inventory management and choose Counts or Stock adjustments.', 'Select the correct stock location and products.', 'Enter the physically verified count or authorized adjustment reason.', 'Review the proposed changes before submitting.', 'Keep supporting notes or evidence according to your property procedure.'] },
  { category: 'Inventory', title: 'Purchasing and transfers', summary: 'Where to find purchasing and stock transfer workflows.', steps: ['Open Back Office Inventory management.', 'Choose Purchase orders or Transfer orders.', 'Check supplier, source location, destination location and item quantities.', 'Review the document before confirming any stock movement.'] },
  { category: 'Reports', title: 'Finding operational reports', summary: 'Open sales and inventory reporting.', steps: ['Open Back Office and choose Reports.', 'Select the report relevant to your task.', 'Set the date range and other available filters.', 'Check the selected property and reporting period before relying on the figures.'] },
  { category: 'Devices & settings', title: 'Printer and device troubleshooting', summary: 'Basic checks before escalating a printing issue.', steps: ['Confirm the printer is powered on and connected to the expected network or device.', 'Check that the correct printer is selected in the relevant settings.', 'Confirm the device is available to your user and workspace.', 'If the issue continues, record the printer name, device, time and affected workflow for support.'] },
];

const CATEGORIES = ['All topics', ...new Set(ARTICLES.map(article => article.category))];

export default function HelpCentre() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All topics');
  const [expanded, setExpanded] = useState(ARTICLES[0].title);
  const filtered = useMemo(() => ARTICLES.filter(article => {
    const matchesCategory = category === 'All topics' || article.category === category;
    const text = [article.title, article.summary, article.category, ...article.steps].join(' ').toLowerCase();
    return matchesCategory && text.includes(query.trim().toLowerCase());
  }), [category, query]);

  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
    <div className="mb-7 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-primary)]"><LifeBuoy size={23}/></div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand-primary)]">OliTechs support</p>
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">How can we help?</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">Search answers, learn the main workflows and find practical guidance for using OliTechs PMS & POS.</p>
      <label className="relative mt-6 block max-w-2xl">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search questions, modules or tasks..." className="h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] pl-10 pr-4 text-sm text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--focus)]"/>
      </label>
    </div>

    <div className="mb-5 flex flex-wrap gap-2">
      {CATEGORIES.map(item => <button key={item} onClick={() => setCategory(item)} className={['rounded-full border px-3 py-2 text-xs font-medium transition-colors', category === item ? 'border-[var(--brand-primary)] bg-[var(--brand-soft)] text-[var(--text)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]'].join(' ')}>{item}</button>)}
    </div>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="min-w-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text)]">Guides and frequently asked questions</h2>
          <span className="text-xs text-[var(--text-muted)]">{filtered.length} articles</span>
        </div>
        <div className="space-y-3">
          {filtered.map(article => <article key={article.title} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <button onClick={() => setExpanded(expanded === article.title ? '' : article.title)} aria-expanded={expanded === article.title} className="flex w-full items-center gap-3 p-4 text-left">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--brand-primary)]"><BookOpen size={17}/></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[var(--text)]">{article.title}</span><span className="mt-1 block text-xs text-[var(--text-muted)]">{article.summary}</span></span>
              <ChevronDown size={17} className={['shrink-0 text-[var(--text-muted)] transition-transform', expanded === article.title ? 'rotate-180' : ''].join(' ')}/>
            </button>
            {expanded === article.title && <div className="border-t border-[var(--border)] px-5 pb-5 pt-4">
              <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-primary)]">{article.category}</div>
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-[var(--text-muted)]">{article.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
            </div>}
          </article>)}
          {filtered.length === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center"><CircleHelp size={24} className="mx-auto mb-3 text-[var(--text-muted)]"/><p className="text-sm font-semibold text-[var(--text)]">No matching guide found</p><p className="mt-1 text-xs text-[var(--text-muted)]">Try another search term or select a different topic.</p></div>}
        </div>
      </section>

      <aside className="space-y-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand-primary)]"><ClipboardList size={18}/></div>
          <h3 className="text-sm font-semibold text-[var(--text)]">Need more help?</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">If these guides do not solve your issue, contact your property administrator and include the module, what you were trying to do and any error message.</p>
          <p className="mt-3 rounded-lg bg-[var(--surface-2)] p-3 text-xs leading-5 text-[var(--text-muted)]">In-app support tickets and live chat are being prepared. This page does not yet submit a ticket or send chat messages.</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand-primary)]"><MessageCircle size={18}/></div>
          <h3 className="text-sm font-semibold text-[var(--text)]">Report an issue</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">When reporting an issue through your existing support channel, include:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--text-muted)]"><li>Property and affected module</li><li>Steps that led to the issue</li><li>Approximate time and any error shown</li><li>Screenshot with guest/payment details hidden</li></ul>
        </div>
      </aside>
    </div>
  </div>;
}
