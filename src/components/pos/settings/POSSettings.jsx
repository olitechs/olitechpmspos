import React, { useEffect, useMemo, useState } from 'react';
import { X, Printer, Table2, ReceiptText, Utensils, ChartNoAxesCombined, ShieldAlert } from 'lucide-react';
import { canUseModule, getSessionStaff, normalizeStaffRole } from '@/services/authService';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import PrintersTab from './tabs/PrintersTab';
import TablesTab from './tabs/TablesTab';
import ReceiptsTab from './tabs/ReceiptsTab';
import MenuTab from './tabs/MenuTab';
import SalesSummaryTab from './tabs/SalesSummaryTab';

// The current authorization contract is module access plus normalized staff roles.
// Keep this UI gate aligned with that contract; service/RLS authorization remains authoritative.
const TABS = [
  { id: 'printers', label: 'Printers', description: 'Printer setup and routing', icon: Printer, roles: ['hotel_admin', 'super_admin', 'fb_manager'] },
  { id: 'tables', label: 'Tables', description: 'Floor zones and table design', icon: Table2, roles: ['hotel_admin', 'super_admin', 'fb_manager'] },
  { id: 'receipts', label: 'Receipts', description: 'Receipt header, footer and branding', icon: ReceiptText, roles: ['hotel_admin', 'super_admin', 'fb_manager', 'cashier'] },
  { id: 'menu', label: 'Menu', description: 'POS menu and product catalogue', icon: Utensils, roles: ['hotel_admin', 'super_admin', 'fb_manager'] },
  { id: 'sales', label: 'Sales summary', description: 'Sales and stock-control reporting', icon: ChartNoAxesCombined, roles: ['hotel_admin', 'super_admin', 'fb_manager', 'accountant', 'auditor'] },
];

export default function POSSettings({ user, onClose }) {
  const staff = useMemo(() => getSessionStaff(), []);
  const role = normalizeStaffRole(staff?.role || user?.staff?.role || user?.propertyRole || user?.role);
  const hasPosAccess = Boolean(user?.isPlatformOwner || canUseModule(user, 'pos'));
  const tabs = hasPosAccess ? TABS.filter(tab => user?.isPlatformOwner || tab.roles.includes(role)) : [];
  const [activeTab, setActiveTab] = useState(tabs[0]?.id || '');
  const selectedTab = tabs.find(tab => tab.id === activeTab) || tabs[0];

  useEffect(() => {
    if (!tabs.some(tab => tab.id === activeTab)) setActiveTab(tabs[0]?.id || '');
  }, [activeTab, tabs]);

  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <div className="fixed inset-0 z-[500] flex flex-col bg-[var(--canvas)] text-[var(--text)]" role="dialog" aria-modal="true" aria-label="POS settings">
    <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:px-6">
      <div className="min-w-0"><h1 className="text-lg font-bold">POS Settings</h1><p className="text-sm text-[var(--text-muted)]">Configure restaurant operations for this property.</p></div>
      <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] hover:bg-[var(--sidebar)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]" aria-label="Close POS settings"><X size={18}/></button>
    </header>
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] p-3 md:w-60 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r" aria-label="POS settings sections">
        {tabs.map(tab => { const Icon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-current={active ? 'page' : undefined} className={'inline-flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ' + (active ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--text)] hover:bg-[var(--sidebar)]')}><Icon size={18}/><span className="whitespace-nowrap">{tab.label}</span></button>; })}
      </nav>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {!hasPosAccess ? <div className="m-5 flex max-w-xl gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><ShieldAlert className="shrink-0 text-[var(--text-muted)]"/><div><h2 className="font-bold">POS access required</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Your account does not have POS module access for this property.</p></div></div> : !selectedTab ? <div className="m-5 flex max-w-xl gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><ShieldAlert className="shrink-0 text-[var(--text-muted)]"/><div><h2 className="font-bold">No settings permissions</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Your assigned role does not have access to these POS settings. Contact your property administrator if you need access.</p></div></div> : <>
          <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="text-base font-bold">{selectedTab.label}</h2><p className="mt-1 text-sm text-[var(--text-muted)]">{selectedTab.description}</p></div>
          <div className="min-h-0 p-3 md:p-5">
            <ErrorBoundary label={selectedTab.label + ' settings'}>
              {activeTab === 'printers' && <PrintersTab />}
              {activeTab === 'tables' && <TablesTab />}
              {activeTab === 'receipts' && <ReceiptsTab />}
              {activeTab === 'menu' && <MenuTab />}
              {activeTab === 'sales' && <SalesSummaryTab />}
            </ErrorBoundary>
          </div>
        </>}
      </main>
    </div>
  </div>;
}
