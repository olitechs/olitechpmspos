import React, { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BedDouble, Building2, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  ClipboardCheck, ClipboardList, Grid3X3, HelpCircle, LayoutDashboard, LogOut,
  Menu, Package, Printer, Receipt, Search, Settings, ShoppingBag, ShoppingCart,
  Sparkles, Store, Users, X, BarChart3, PlugZap, Boxes,
  ChefHat, ArrowRightLeft, Banknote, Percent, ShieldCheck, MonitorCog, LayoutGrid,
} from 'lucide-react';
import { BACK_OFFICE_NAV, FRONT_OFFICE_NAV, STORES_NAV, normalizeAppRole } from '@/data/modules/navArchitecture';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';
import TopAppNav from './TopAppNav';

const FRONT_ICONS = {
  dashboard: LayoutDashboard, 'room-planner': BedDouble, rooms: BedDouble,
  reservations: CalendarDays, folio: Receipt, housekeeping: Sparkles, 'night-audit': ClipboardList,
};
const STORE_ICONS = { store: Store, settings: Settings, devices: MonitorCog, printers: Printer, kds: LayoutGrid };
const BACK_ICONS = {
  reports: BarChart3, items: ShoppingBag, inventory: ShoppingCart, employees: Users,
  customers: Users, integrations: PlugZap, settings: Settings, help: HelpCircle,
};
const ROLE_ICON = { items: Package, inventory: Boxes, purchasing: ShoppingCart, transfers: ArrowRightLeft,
  adjustments: ClipboardCheck, counts: Boxes, productions: ChefHat, suppliers: Package,
  'inventory-history': Receipt, 'inventory-valuation': Banknote, 'employee-list': Users,
  'access-rights': ShieldCheck, timecards: CalendarDays, 'total-hours': ClipboardList,
  'item-list': ClipboardList, categories: Grid3X3, modifiers: Sparkles, discounts: Percent,
};

function currentRole(user) {
  const staff = getSessionStaff();
  return normalizeAppRole(normalizeStaffRole(staff?.role || user?.staff?.role || user?.propertyRole || user?.role));
}

function backOfficeAllowed(item, role) {
  if (['admin', 'owner', 'store_manager'].includes(role)) return true;
  if (role === 'pos_staff') return ['items', 'inventory'].includes(item.id);
  if (role === 'accountant') return item.id === 'reports';
  return false;
}

export default function AppShell({ workspace = 'backoffice' }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const role = currentRole(user);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const nav = useMemo(() => {
    if (workspace === 'frontoffice') {
      return FRONT_OFFICE_NAV.filter(item => item[3].includes(role)).map(([label, path, id]) => ({
        id, label, path, icon: FRONT_ICONS[id], active: location.pathname === path || location.pathname.startsWith(path + '/'),
      }));
    }
    if (workspace === 'stores') {
      return STORES_NAV.map(([label, path, id]) => ({
        id, label, path, icon: STORE_ICONS[id], active: location.pathname === path || location.pathname.startsWith(path + '/'),
      }));
    }
    return BACK_OFFICE_NAV.filter(item => backOfficeAllowed(item, role)).map(item => ({
      ...item,
      icon: BACK_ICONS[item.id] || LayoutDashboard,
      active: (item.path && (location.pathname === item.path || location.pathname.startsWith(item.path + '/')))
        || item.children?.some(([, path]) => location.pathname === path || location.pathname.startsWith(path + '/')),
    })).filter(item => !query || item.label.toLowerCase().includes(query.toLowerCase())
      || item.children?.some(([label]) => label.toLowerCase().includes(query.toLowerCase())));
  }, [workspace, role, location.pathname, query]);

  const hotelName = user?.property?.name || user?.property?.business_name || 'OliTechs Hotel';
  const email = user?.email || getSessionStaff()?.email || '';

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <TopAppNav />
      <div className="flex min-h-0 flex-1">
        {mobileOpen && <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-black/40 md:hidden" />}
        <aside className={[
          'fixed inset-y-0 left-0 z-50 flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width,transform] duration-150 md:static md:z-auto md:translate-x-0',
          collapsed ? 'w-16' : 'w-60',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}>
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--brand-dark)] text-xs font-bold text-[var(--action)]">OT</span>
            {!collapsed && <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">OliTechs</div><div className="text-[11px] text-[var(--muted)]">PMS &amp; POS</div></div>}
            <button type="button" onClick={() => setCollapsed(value => !value)} className="hidden rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)] md:inline-flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
            <button type="button" onClick={() => setMobileOpen(false)} className="ml-auto rounded-md p-1.5 text-[var(--muted)] md:hidden" aria-label="Close sidebar"><X size={17} /></button>
          </div>
          <div className="border-b border-[var(--border)] px-3 py-3">
            {!collapsed && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Property</div>}
            <div className="flex min-w-0 items-center gap-2 rounded-md bg-[var(--surface-2)] px-2 py-2" title={hotelName}>
              <Building2 size={16} className="shrink-0 text-[var(--muted)]" />
              {!collapsed && <span className="truncate text-xs font-medium">{hotelName}</span>}
            </div>
          </div>
          {workspace === 'backoffice' && !collapsed && <div className="px-3 pt-3"><label className="relative block"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter navigation" aria-label="Filter navigation" className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pl-8 pr-2 text-xs text-[var(--text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" /></label></div>}
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label={`${workspace} navigation`}>
            {nav.map(item => {
              const Icon = item.icon || ROLE_ICON[item.id] || LayoutDashboard;
              const children = item.children || [];
              const active = item.active;
              return <div key={item.id} className="mb-1">
                {item.path || item.id === 'customers' || item.id === 'integrations' || item.id === 'help'
                  ? <NavLink to={item.path || children[0]?.[1] || '#'} end={workspace === 'frontoffice' && item.path === '/frontoffice'} onClick={() => setMobileOpen(false)} title={collapsed ? item.label : undefined} className={({ isActive }) => [
                    'flex min-h-9 items-center gap-2 rounded-md px-2 text-[13px] transition-colors',
                    (isActive || active) ? 'bg-[var(--brand-soft)] font-semibold text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
                    collapsed ? 'justify-center' : '',
                  ].join(' ')}><Icon size={17} className="shrink-0" />{!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}</NavLink>
                  : <div className={['flex min-h-9 items-center gap-2 rounded-md px-2 text-[13px]', active ? 'text-[var(--text)]' : 'text-[var(--muted)]', collapsed ? 'justify-center' : ''].join(' ')} title={collapsed ? item.label : undefined}><Icon size={17} className="shrink-0" />{!collapsed && <span className="truncate font-medium">{item.label}</span>}</div>}
                {!collapsed && children.length > 0 && <div className="ml-7 border-l border-[var(--border)] py-1 pl-2">{children.map(([label, path]) => <NavLink key={path} to={path} onClick={() => setMobileOpen(false)} className={({ isActive }) => ['block rounded px-2 py-1.5 text-xs', isActive ? 'bg-[var(--surface-2)] font-medium text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'].join(' ')}>{label}</NavLink>)}</div>}
              </div>;
            })}
          </nav>
          <div className="shrink-0 border-t border-[var(--border)] p-2">
            <button type="button" onClick={() => setOwnerOpen(value => !value)} className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-[var(--surface-2)]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[10px] font-semibold text-[var(--text)]">{(user?.name || email || 'OT').slice(0, 2).toUpperCase()}</span>
              {!collapsed && <span className="min-w-0 flex-1 truncate text-xs">{user?.name || email || 'Account'}</span>}
              {!collapsed && <ChevronDown size={14} className="text-[var(--muted)]" />}
            </button>
            {ownerOpen && <button type="button" onClick={logout} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-xs text-[var(--danger)] hover:bg-[var(--surface-2)]"><LogOut size={14} />{!collapsed && 'Sign out'}</button>}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-12 shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface)] px-3 md:hidden">
            <button type="button" onClick={() => setMobileOpen(true)} className="rounded-md p-2 text-[var(--text)]" aria-label="Open navigation"><Menu size={18} /></button>
            <span className="ml-2 text-sm font-semibold">{hotelName}</span>
          </div>
          <main className="min-h-0 min-w-0 flex-1 overflow-auto"><div className="mx-auto w-full max-w-[1600px]"><Outlet /></div></main>
        </div>
      </div>
    </div>
  );
}
