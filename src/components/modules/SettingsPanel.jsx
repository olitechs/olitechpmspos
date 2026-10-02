import React from 'react';
import { Building2, Utensils, Users, CreditCard, Printer, Globe, ChevronLeft } from 'lucide-react';
import { NAVY, TEAL, TEAL_DARK, SAND, SURFACE, BORDER, MUTED } from '@/data/themePalette';
import Printers from '@/components/admin/Printers';
import StaffAdmin from '@/components/admin/StaffAdmin';
import TableSetup from '@/components/admin/TableSetup';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import SubscriptionPanel from '@/components/admin/SubscriptionPanel';
import { useAuth } from '@/lib/AuthContext';

const SECTIONS = [
  { id: 'business', icon: Building2, label: 'Business & Branches', desc: 'Name, logo, address, currency, timezone, tax configuration' },
  { id: 'dining', icon: Utensils, label: 'Dining Areas & Tables', desc: 'Create and manage service areas, tables and seating capacity' },
  { id: 'users', icon: Users, label: 'Users & Roles', desc: 'Manage staff accounts, roles and granular permissions' },
  { id: 'payments', icon: CreditCard, label: 'Payment Methods', desc: 'Configure accepted payment types per branch' },
  { id: 'printers', icon: Printer, label: 'Printers & KDS', desc: 'Receipt / kitchen printers, connection types and defaults' },
  { id: 'integrations', icon: Globe, label: 'Integrations', desc: 'Payment gateways, accounting exports, online ordering' },
  { id: 'subscription', icon: CreditCard, label: 'Subscription & Paywall', desc: 'Plan, access status, billing period and grace period' },
];

// Sections that link to a working screen. Others are shown as
// not-yet-implemented (no fake data behind them).
const ROUTED = { printers: true, users: true, dining: true };

function Breadcrumb({ label, onBack }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
      <button onClick={onBack} className="flex items-center gap-1 text-xs font-semibold" style={{ color: TEAL_DARK }}>
        <ChevronLeft size={14} /> Settings
      </button>
      <span style={{ color: MUTED }}>/</span>
      <span className="text-xs font-bold uppercase tracking-widest" style={{ color: NAVY }}>{label}</span>
    </div>
  );
}

export default function SettingsPanel() {
  const [view, setView] = React.useState('list');
  const { user } = useAuth();
  const canViewSubscription = Boolean(user?.property?.id || user?.propertyRole || user?.staff?.role);

  if (view === 'printers') {
    return (
      <div className="flex-1 overflow-y-auto" style={{ background: SAND }}>
        <Breadcrumb label="Printers" onBack={() => setView('list')} />
        <ErrorBoundary label="Printer settings">
          <Printers />
        </ErrorBoundary>
      </div>
    );
  }

  if (view === 'users') {
    return (
      <div className="flex-1 overflow-y-auto" style={{ background: SAND }}>
        <Breadcrumb label="Users & Roles" onBack={() => setView('list')} />
        <StaffAdmin />
      </div>
    );
  }

  if (view === 'subscription') return <div className="flex-1 overflow-y-auto" style={{ background: SAND }}><Breadcrumb label="Subscription & Paywall" onBack={() => setView('list')} /><SubscriptionPanel /></div>;

  if (view === 'dining') {
    return (
      <div className="flex-1 overflow-hidden flex flex-col" style={{ background: SAND }}>
        <Breadcrumb label="Dining Areas & Tables" onBack={() => setView('list')} />
        <TableSetup />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: SAND }}>
      <div className="max-w-2xl">
        <p className="text-sm mb-4" style={{ color: MUTED }}>Platform configuration — changes apply to the selected business and branch.</p>
        <div className="flex flex-col gap-3">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => ROUTED[s.id] && setView(s.id)}
              disabled={!ROUTED[s.id] && !(s.id === 'subscription' && canViewSubscription)}
              className="flex items-center gap-4 p-4 rounded-2xl text-left transition-all"
              style={{ background: SURFACE, border: `1px solid ${BORDER}`, opacity: (ROUTED[s.id] || (s.id === 'subscription' && canViewSubscription)) ? 1 : 0.55, cursor: (ROUTED[s.id] || (s.id === 'subscription' && canViewSubscription)) ? 'pointer' : 'default' }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${TEAL}14` }}>
                <s.icon size={18} style={{ color: TEAL_DARK }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm" style={{ color: NAVY }}>{s.label}</div>
                <div className="text-xs mt-0.5" style={{ color: MUTED }}>{s.desc}</div>
              </div>
              <div className="text-xs px-2 py-1 rounded-lg" style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: MUTED }}>
                {ROUTED[s.id] || (s.id === 'subscription' && canViewSubscription) ? 'Configure →' : 'Coming soon'}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
