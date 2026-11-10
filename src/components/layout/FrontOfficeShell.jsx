import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, BedDouble, Bell, BookOpen, Building2, CalendarDays, ChevronDown, ChevronRight, ClipboardCheck, HelpCircle, LayoutDashboard, LockKeyhole, LogOut, Menu, MessageCircle, Settings, Sparkles, Tags, Users, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';

const ITEMS = [
  { id:'manuals', label:'Manuals', path:'/frontoffice/manuals', icon:BookOpen },
  { id:'assistance', label:'Assistance', path:'/frontoffice/assistance', icon:HelpCircle },
  { id:'dashboard', label:'Dashboard', path:'/frontoffice/dashboard', icon:LayoutDashboard, roles:['hotel_admin','super_admin','front_office_manager','receptionist','front_desk'] },
  { id:'calendar', label:'Calendar', path:'/frontoffice/room-planner', icon:CalendarDays, roles:['hotel_admin','super_admin','front_office_manager','receptionist','front_desk','housekeeping_supervisor','housekeeping'] },
  { id:'reservations', label:'Reservations', path:'/frontoffice/reservations', icon:ClipboardCheck, roles:['hotel_admin','super_admin','front_office_manager','receptionist','front_desk'] },
  { id:'rooms', label:'Room Types & Setup', path:'/frontoffice/rooms', icon:BedDouble, roles:['hotel_admin','super_admin','front_office_manager'] },
  { id:'channels', label:'Channels', path:'/frontoffice/channels', icon:Activity, roles:['hotel_admin','super_admin','front_office_manager'] },
  { id:'check-in', label:'Check-in', icon:LogOut, roles:['hotel_admin','super_admin','front_office_manager','receptionist','front_desk'], children:[['Arrivals','/frontoffice/check-in/arrivals'],['In-House','/frontoffice/check-in/in-house'],['Departures','/frontoffice/check-in/departures'],['Walk-in Check-in','/frontoffice/check-in/walk-in'],['Express Check-out','/frontoffice/check-in/express-checkout'],['Registration Cards','/frontoffice/check-in/registration-cards']] },
  { id:'statistics', label:'Statistics', icon:BarChart3, roles:['hotel_admin','super_admin','front_office_manager'], children:[['Occupancy','/frontoffice/statistics/occupancy'],['ADR and RevPAR','/frontoffice/statistics/adr-revpar'],['Revenue','/frontoffice/statistics/revenue'],['Sources / Channels','/frontoffice/statistics/channels'],['Guest Origin / Nationality','/frontoffice/statistics/guest-origin'],['Cancellations and No-shows','/frontoffice/statistics/cancellations'],['Forecast','/frontoffice/statistics/forecast']] },
  { id:'suite-services', label:'Suite Services', icon:Sparkles, roles:['hotel_admin','super_admin','front_office_manager','receptionist','front_desk','housekeeping_supervisor','housekeeping'], children:[['Housekeeping Board','/frontoffice/services/housekeeping'],['Room Charges','/frontoffice/services/room-charges'],['Minibar and Extras','/frontoffice/services/minibar'],['Laundry','/frontoffice/services/laundry'],['Maintenance / Work Orders','/frontoffice/services/maintenance'],['Guest Requests / Transfers and Tours','/frontoffice/services/guest-requests']] },
  { id:'structure', label:'Structure', path:'/frontoffice/structure', icon:Building2, roles:['hotel_admin','super_admin','front_office_manager'] },
  { id:'configuration', label:'Configuration', path:'/frontoffice/configuration', icon:Settings, roles:['hotel_admin','super_admin','front_office_manager'] },
  { id:'tags', label:'Tags', path:'/frontoffice/tags', icon:Tags, roles:['hotel_admin','super_admin','front_office_manager'] },
];

function roleFor(user) {
  const staff = getSessionStaff();
  return normalizeStaffRole(staff?.role || user?.staff?.role || user?.propertyRole || user?.role || 'front_desk');
}

export default function FrontOfficeShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const role = roleFor(user);
  const key = 'olitech-frontoffice-sidebar-' + String(user?.id || user?.email || 'user');
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [expanded, setExpanded] = useState(() => ['check-in','statistics','suite-services'].filter(id => location.pathname.includes(id)));
  const [userMenu, setUserMenu] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [quickPanel, setQuickPanel] = useState('');
  const isPlanner = location.pathname.includes('/room-planner');
  const [helpQuery, setHelpQuery] = useState('');

  useEffect(() => { try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch {} }, [collapsed, key]);
  useEffect(() => { setDrawer(false); }, [location.pathname]);
  useEffect(() => {
    const currentItem = ITEMS.find(item => item.path === location.pathname || item.children?.some(([,path]) => path === location.pathname));
    if (currentItem?.roles && !currentItem.roles.includes(role)) navigate('/frontoffice/dashboard', { replace: true });
  }, [location.pathname, role, navigate]);

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') { setDrawer(false); setUserMenu(false); setHelpOpen(false); setNoticeOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = useMemo(() => {
    const match = ITEMS.flatMap(item => [item, ...(item.children || []).map(([label,path]) => ({label,path}))]).find(item => item.path === location.pathname);
    return match?.label || 'Front Office';
  }, [location.pathname]);
  const propertyName = user?.property?.name || user?.property?.business_name || 'OliTechs';
  const email = user?.email || getSessionStaff()?.email || user?.name || 'Account';

  const sidebar = <aside className={['flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] text-[var(--text)] transition-[width] duration-150', collapsed ? 'w-[68px]' : 'w-[220px]'].join(' ')}>
    <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3">
      <div className="flex min-w-0 items-center gap-2"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-dark)] text-sm font-black text-[var(--white)]">O</div>{!collapsed && <div className="min-w-0"><div className="truncate text-sm font-bold tracking-wide">OliTechs</div><div className="text-[10px] text-[var(--text-muted)]">Front Office / PMS</div></div>}</div>
      <button type="button" onClick={() => setCollapsed(v => !v)} className="hidden rounded-md p-1.5 hover:bg-[var(--surface)] lg:inline-flex" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><ChevronRight size={16} className={collapsed ? '' : 'rotate-180'}/></button>
    </div>
    <div className="shrink-0 border-b border-[var(--border)] px-3 py-3"><div className="flex min-w-0 items-center gap-2 rounded-lg bg-[var(--surface)]/70 px-2 py-2" title={propertyName}><Building2 size={16} className="shrink-0"/>{!collapsed && <span className="truncate text-xs font-semibold">{propertyName}</span>}</div></div>
    <nav aria-label="Front Office navigation" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {ITEMS.map(item => {
        const Icon = item.icon;
        const disabled = item.roles && !item.roles.includes(role);
        const active = (item.path && location.pathname.startsWith(item.path)) || item.children?.some(([,path]) => location.pathname.startsWith(path));
        const open = expanded.includes(item.id) || active;
        return <div key={item.id} className="mb-1">
          {item.path ? (disabled ? <div aria-disabled="true" title="Requires Manager" className={['flex min-h-11 items-center gap-3 rounded-lg px-2 text-[13px] opacity-55',collapsed?'justify-center':''].join(' ')}><Icon size={17}/>{!collapsed && <><span className="min-w-0 flex-1 truncate">{item.label}</span><LockKeyhole size={13}/></>}</div> : <NavLink to={item.path} title={collapsed ? item.label : undefined} className={({isActive}) => ['flex min-h-11 items-center gap-3 rounded-lg px-2 text-[13px] transition-colors',isActive?'bg-[var(--brand-primary)] font-semibold text-[var(--white)]':'text-[var(--text)] hover:bg-[var(--soft-white)]',collapsed?'justify-center':''].join(' ')}><Icon size={17}/>{!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}</NavLink>) :
          <button type="button" disabled={disabled} title={collapsed ? item.label : disabled ? 'Requires Manager' : undefined} onClick={() => setExpanded(v => v.includes(item.id) ? v.filter(x => x !== item.id) : [...v,item.id])} className={['flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-[13px]',active?'font-semibold text-[var(--text)]':'text-[var(--text-muted)] hover:bg-[var(--surface)]/80',disabled?'opacity-55':'',collapsed?'justify-center':''].join(' ')}><Icon size={17}/>{!collapsed && <><span className="min-w-0 flex-1 truncate">{item.label}</span>{disabled?<LockKeyhole size={13}/>:<ChevronDown size={14} className={open?'rotate-180 transition-transform':'transition-transform'}/>}</>}</button>}
          {!collapsed && item.children && open && <div className="ml-4 border-l border-[var(--brand-primary)]/20 py-1 pl-3">{item.children.map(([label,path]) => disabled ? <span key={path} aria-disabled="true" title="Requires Manager" className="flex items-center justify-between rounded-md px-2 py-2 text-xs text-[var(--text-muted)] opacity-55">{label}<LockKeyhole size={12}/></span> : <NavLink key={path} to={path} className={({isActive}) => ['block rounded-md px-2 py-2 text-xs',isActive?'bg-[var(--surface)] font-semibold text-[var(--brand-dark)]':'text-[var(--text-muted)] hover:bg-[var(--surface)]/70'].join(' ')}>{label}</NavLink>)}</div>}
        </div>;
      })}
    </nav>
    <div className="shrink-0 border-t border-[var(--border)] p-2"><button type="button" onClick={logout} className={['flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface)]/80',collapsed?'justify-center':''].join(' ')}><LogOut size={16}/>{!collapsed && 'Sign out'}</button></div>
  </aside>;

  return <div className="flex h-[100dvh] min-h-0 w-full max-w-full overflow-hidden bg-[var(--canvas)] text-[var(--text)]">
    <div className="hidden shrink-0 min-[1100px]:block">{sidebar}</div>
    {drawer && <div className="fixed inset-0 z-[90] min-[1100px]:hidden"><button aria-label="Close navigation" onClick={() => setDrawer(false)} className="absolute inset-0 bg-[var(--overlay-scrim)]"/><div className="relative h-full w-[min(86vw,300px)]">{sidebar}</div></div>}
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 bg-[var(--brand-primary)] px-3 py-2 text-[var(--white)] sm:px-4">
        <button type="button" onClick={() => { if (window.matchMedia('(min-width: 1100px)').matches) setCollapsed(v => !v); else setDrawer(true); }} aria-label="Toggle navigation" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--white)]/60 hover:bg-[var(--surface)]/10"><Menu size={19}/></button>
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{title}</div><div className="truncate text-[10px] text-[var(--white)]/80">Front Office <span className="px-1">/</span> {title}</div></div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden max-w-[170px] truncate rounded-md border border-[var(--white)]/30 px-2 py-2 text-xs sm:inline-flex" title={propertyName}>{propertyName}</span>
          <button type="button" onClick={() => setNoticeOpen(v=>!v)} aria-label="Notifications" className="relative flex h-10 w-10 items-center justify-center rounded-md hover:bg-[var(--surface)]/10"><Bell size={18}/></button>
          <button type="button" onClick={() => setHelpOpen(v=>!v)} aria-label="Help" className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--white)]"><HelpCircle size={18}/></button>
          <button type="button" onClick={() => setUserMenu(v=>!v)} className="flex min-h-10 max-w-[180px] items-center gap-2 rounded-md border border-[var(--white)]/60 px-2 text-xs hover:bg-[var(--surface)]/10"><Users size={15}/><span className="hidden truncate sm:inline">{email}</span><ChevronDown size={13}/></button>
        </div>
      </header>
      {noticeOpen && <div className="absolute right-20 top-[66px] z-[80] w-[min(340px,calc(100vw-24px))] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm shadow-xl"><div className="font-semibold">Notifications</div><p className="mt-2 text-xs text-[var(--text-muted)]">No new notifications are available in this workspace yet.</p></div>}
      {helpOpen && <div className="absolute right-16 top-[66px] z-[80] w-[min(360px,calc(100vw-24px))] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text)] shadow-xl"><div className="font-semibold">OliTechs Help</div><input value={helpQuery} onChange={e=>setHelpQuery(e.target.value)} placeholder="Search manuals and guides" className="mt-3 h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"/><button onClick={()=>{setHelpOpen(false);navigate('/frontoffice/manuals?q='+encodeURIComponent(helpQuery));}} className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-lg bg-[var(--surface-2)] px-3 text-left text-xs"><BookOpen size={15}/> Open Manuals</button><button onClick={()=>{setHelpOpen(false);navigate('/frontoffice/assistance');}} className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs hover:bg-[var(--surface-2)]"><MessageCircle size={15}/> Contact Assistance</button></div>}
      {userMenu && <div className="absolute right-3 top-[66px] z-[80] w-56 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-sm text-[var(--text)] shadow-xl"><div className="truncate px-3 py-2 text-xs text-[var(--text-muted)]">{email}</div><button onClick={()=>{setUserMenu(false);navigate('/frontoffice/configuration');}} className="block min-h-10 w-full rounded-lg px-3 text-left text-xs hover:bg-[var(--surface-2)]">Profile / Preferences</button><button onClick={logout} className="block min-h-10 w-full rounded-lg px-3 text-left text-xs text-[var(--danger-text)] hover:bg-[var(--surface-2)]">Sign out</button></div>}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden"><Outlet/></main>
        {isPlanner && <aside aria-label="Planner quick panels" className="z-30 flex shrink-0 border-l border-[var(--border)] bg-[var(--surface)]">
          <div className="flex w-11 shrink-0 flex-col items-center gap-2 py-2">
            <button type="button" aria-pressed={quickPanel==='info'} onClick={()=>setQuickPanel(v=>v==='info'?'':'info')} title="Planner information and legend" className="flex min-h-11 w-10 flex-col items-center justify-center gap-0.5 rounded-md border border-[var(--coastal-teal)] bg-[var(--surface)] text-[var(--brand-dark)]"><Activity size={15}/><span className="text-[9px]">Info</span></button>
            <button type="button" aria-pressed={quickPanel==='messages'} onClick={()=>setQuickPanel(v=>v==='messages'?'':'messages')} title="Messages and notifications" className="flex min-h-11 w-10 flex-col items-center justify-center gap-0.5 rounded-md border border-[var(--coastal-teal)] bg-[var(--surface)] text-[var(--brand-dark)]"><Bell size={15}/><span className="text-[9px]">Alerts</span></button>
            <button type="button" aria-pressed={quickPanel==='settings'} onClick={()=>setQuickPanel(v=>v==='settings'?'':'settings')} title="Planner settings" className="flex min-h-11 w-10 flex-col items-center justify-center gap-0.5 rounded-md border border-[var(--coastal-teal)] bg-[var(--surface)] text-[var(--brand-dark)]"><Settings size={15}/><span className="text-[9px]">Settings</span></button>
            <div className="mt-auto pb-2"><button type="button" onClick={()=>setHelpOpen(true)} title="Open floating help" aria-label="Open floating help" className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--white)] shadow-md"><MessageCircle size={19}/></button></div>
          </div>
          {quickPanel && <section className="w-[min(280px,calc(100vw-64px))] overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-3 text-[var(--text)] shadow-lg" aria-label={quickPanel==='info'?'Planner information':quickPanel==='messages'?'Planner notifications':'Planner settings'}>
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold">{quickPanel==='info'?'Planner information':quickPanel==='messages'?'Messages / Notifications':'Planner settings'}</h2><button type="button" onClick={()=>setQuickPanel('')} aria-label="Close quick panel" className="rounded-md p-2 hover:bg-[var(--surface-2)]"><X size={15}/></button></div>
            {quickPanel==='info' && <div className="space-y-3 text-xs"><p className="text-[var(--text-muted)]">Reservation colours follow the payment state shown in the planner legend.</p><div className="space-y-2"><div className="rounded-md bg-[var(--pay-none)] p-2 font-semibold text-[var(--pay-none-fg)]">No Amount Paid</div><div className="rounded-md bg-[var(--pay-part)] p-2 font-semibold text-[var(--pay-part-fg)]">Partially Paid</div><div className="rounded-md bg-[var(--pay-paid)] p-2 font-semibold text-[var(--pay-paid-fg)]">Total Paid</div><div className="rounded-md border border-dashed border-[var(--pay-opt-bd)] bg-[var(--pay-opt)] p-2 font-semibold text-[var(--pay-opt-fg)]">Optioned · 24 hours</div></div><p>Shortcuts: T today · Esc close · Arrow keys scroll · Ctrl/Cmd+Z undo.</p></div>}
            {quickPanel==='messages' && <div className="space-y-3 text-xs"><p className="text-[var(--text-muted)]">Notification feed is ready for PMS event integration.</p><div className="rounded-lg border border-[var(--border)] p-3"><b>Option expiry warnings</b><p className="mt-1 text-[var(--text-muted)]">24-hour options are shown with countdowns in reservation details.</p></div><div className="rounded-lg border border-[var(--border)] p-3"><b>Overbooking alerts</b><p className="mt-1 text-[var(--text-muted)]">Live conflict validation remains active when creating or moving stays.</p></div><div className="rounded-lg border border-[var(--border)] p-3"><b>Guest messages / unpaid arrivals</b><p className="mt-1 text-[var(--text-muted)]">Message and alert feeds are not yet connected.</p></div></div>}
            {quickPanel==='settings' && <div className="space-y-3 text-xs"><p className="text-[var(--text-muted)]">Display preferences are available from the planner toolbar Settings control.</p><div className="rounded-lg border border-[var(--border)] p-3"><b>Density</b><p className="mt-1 text-[var(--text-muted)]">Compact, Comfortable and Large row heights.</p></div><div className="rounded-lg border border-[var(--border)] p-3"><b>Date format</b><p className="mt-1 text-[var(--text-muted)]">DD/MM/YYYY or MM/DD/YYYY.</p></div><p>Use the gear control in the planner toolbar to change these settings.</p></div>}
          </section>}
        </aside>}
      </div>
    </div>
  </div>;
}
