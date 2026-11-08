import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, BedDouble, Bell, BookOpen, Building2, CalendarDays, ChevronDown, ChevronRight, ClipboardCheck, ClipboardList, Grid3X3, HelpCircle, LayoutDashboard, LockKeyhole, LogOut, Menu, MessageCircle, Package, Receipt, Settings, Sparkles, Tags, Users, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';

const ITEMS = [
  { id:'manuals', label:'Manuals', path:'/frontoffice/manuals', icon:BookOpen },
  { id:'assistance', label:'Assistance', path:'/frontoffice/assistance', icon:HelpCircle },
  { id:'dashboard', label:'Dashboard', path:'/frontoffice/dashboard', icon:LayoutDashboard, roles:['hotel_admin','super_admin','front_office_manager','receptionist','front_desk'] },
  { id:'calendar', label:'Calendar', path:'/frontoffice/room-planner', icon:CalendarDays, roles:['hotel_admin','super_admin','front_office_manager','receptionist','front_desk','housekeeping_supervisor','housekeeping'] },
  { id:'reservations', label:'Reservations', path:'/frontoffice/reservations', icon:ClipboardCheck, roles:['hotel_admin','super_admin','front_office_manager','receptionist','front_desk'] },
  { id:'rooms', label:'Rooms / Apartments', path:'/frontoffice/rooms', icon:BedDouble, roles:['hotel_admin','super_admin','front_office_manager'] },
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
  return normalizeStaffRole(staff?.role || user?.staff?.role || user?.propertyRole || user?.role || '');
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
  const [helpQuery, setHelpQuery] = useState('');

  useEffect(() => { try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch {} }, [collapsed, key]);
  useEffect(() => { setDrawer(false); }, [location.pathname]);
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

  const sidebar = <aside className={['flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[#EAF3F3] text-[var(--text)] transition-[width] duration-150', collapsed ? 'w-[68px]' : 'w-[220px]'].join(' ')}>
    <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3">
      <div className="flex min-w-0 items-center gap-2"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-dark)] text-sm font-black text-white">O</div>{!collapsed && <div className="min-w-0"><div className="truncate text-sm font-bold tracking-wide">OliTechs</div><div className="text-[10px] text-[var(--text-muted)]">Front Office / PMS</div></div>}</div>
      <button type="button" onClick={() => setCollapsed(v => !v)} className="hidden rounded-md p-1.5 hover:bg-[var(--surface)] lg:inline-flex" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><ChevronRight size={16} className={collapsed ? '' : 'rotate-180'}/></button>
    </div>
    <div className="shrink-0 border-b border-[var(--border)] px-3 py-3"><div className="flex min-w-0 items-center gap-2 rounded-lg bg-white/70 px-2 py-2" title={propertyName}><Building2 size={16} className="shrink-0"/>{!collapsed && <span className="truncate text-xs font-semibold">{propertyName}</span>}</div></div>
    <nav aria-label="Front Office navigation" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {ITEMS.map(item => {
        const Icon = item.icon;
        const disabled = item.roles && !item.roles.includes(role);
        const active = (item.path && location.pathname.startsWith(item.path)) || item.children?.some(([,path]) => location.pathname.startsWith(path));
        const open = expanded.includes(item.id) || active;
        return <div key={item.id} className="mb-1">
          {item.path ? (disabled ? <div aria-disabled="true" title="Requires Manager" className={['flex min-h-11 items-center gap-3 rounded-lg px-2 text-[13px] opacity-55',collapsed?'justify-center':''].join(' ')}><Icon size={17}/>{!collapsed && <><span className="min-w-0 flex-1 truncate">{item.label}</span><LockKeyhole size={13}/></>}</div> : <NavLink to={item.path} title={collapsed ? item.label : undefined} className={({isActive}) => ['flex min-h-11 items-center gap-3 rounded-lg px-2 text-[13px] transition-colors',isActive?'bg-[var(--brand-primary)] font-semibold text-white':'text-[var(--text)] hover:bg-white/80',collapsed?'justify-center':''].join(' ')}><Icon size={17}/>{!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}</NavLink>) :
          <button type="button" disabled={disabled} title={collapsed ? item.label : disabled ? 'Requires Manager' : undefined} onClick={() => setExpanded(v => v.includes(item.id) ? v.filter(x => x !== item.id) : [...v,item.id])} className={['flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-[13px]',active?'font-semibold text-[var(--text)]':'text-[var(--text-muted)] hover:bg-white/80',disabled?'opacity-55':'',collapsed?'justify-center':''].join(' ')}><Icon size={17}/>{!collapsed && <><span className="min-w-0 flex-1 truncate">{item.label}</span>{disabled?<LockKeyhole size={13}/>:<ChevronDown size={14} className={open?'rotate-180 transition-transform':'transition-transform'}/>}</>}</button>}
          {!collapsed && item.children && open && <div className="ml-4 border-l border-[var(--brand-primary)]/20 py-1 pl-3">{item.children.map(([label,path]) => <NavLink key={path} to={path} className={({isActive}) => ['block rounded-md px-2 py-2 text-xs',isActive?'bg-white font-semibold text-[var(--brand-dark)]':'text-[var(--text-muted)] hover:bg-white/70'].join(' ')}>{label}</NavLink>)}</div>}
        </div>;
      })}
    </nav>
    <div className="shrink-0 border-t border-[var(--border)] p-2"><button type="button" onClick={logout} className={['flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-xs text-[var(--text-muted)] hover:bg-white/80',collapsed?'justify-center':''].join(' ')}><LogOut size={16}/>{!collapsed && 'Sign out'}</button></div>
  </aside>;

  return <div className="flex h-[100dvh] min-h-0 w-full max-w-full overflow-hidden bg-[var(--canvas)] text-[var(--text)]">
    <div className="hidden shrink-0 lg:block">{sidebar}</div>
    {drawer && <div className="fixed inset-0 z-[90] lg:hidden"><button aria-label="Close navigation" onClick={() => setDrawer(false)} className="absolute inset-0 bg-black/30"/><div className="relative h-full w-[min(86vw,300px)]">{sidebar}</div></div>}
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2 bg-[var(--brand-primary)] px-3 py-2 text-white sm:px-4">
        <button type="button" onClick={() => { if (window.matchMedia('(min-width: 1024px)').matches) setCollapsed(v => !v); else setDrawer(true); }} aria-label="Toggle navigation" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/60 hover:bg-white/10"><Menu size={19}/></button>
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{title}</div><div className="truncate text-[10px] text-white/80">Front Office <span className="px-1">/</span> {title}</div></div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden max-w-[170px] truncate rounded-md border border-white/30 px-2 py-2 text-xs sm:inline-flex" title={propertyName}>{propertyName}</span>
          <button type="button" onClick={() => setNoticeOpen(v=>!v)} aria-label="Notifications" className="relative flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10"><Bell size={18}/></button>
          <button type="button" onClick={() => setHelpOpen(v=>!v)} aria-label="Help" className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-white"><HelpCircle size={18}/></button>
          <button type="button" onClick={() => setUserMenu(v=>!v)} className="flex min-h-10 max-w-[180px] items-center gap-2 rounded-md border border-white/60 px-2 text-xs hover:bg-white/10"><Users size={15}/><span className="hidden truncate sm:inline">{email}</span><ChevronDown size={13}/></button>
        </div>
      </header>
      {noticeOpen && <div className="absolute right-20 top-[66px] z-[80] w-[min(340px,calc(100vw-24px))] rounded-xl border border-[var(--border)] bg-white p-4 text-sm shadow-xl"><div className="font-semibold">Notifications</div><p className="mt-2 text-xs text-[var(--text-muted)]">No new notifications are available in this workspace yet.</p></div>}
      {helpOpen && <div className="absolute right-16 top-[66px] z-[80] w-[min(360px,calc(100vw-24px))] rounded-xl border border-[var(--border)] bg-white p-4 text-sm text-[var(--text)] shadow-xl"><div className="font-semibold">OliTechs Help</div><input value={helpQuery} onChange={e=>setHelpQuery(e.target.value)} placeholder="Search manuals and guides" className="mt-3 h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"/><button onClick={()=>{setHelpOpen(false);navigate('/frontoffice/manuals?q='+encodeURIComponent(helpQuery));}} className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-lg bg-[var(--surface-2)] px-3 text-left text-xs"><BookOpen size={15}/> Open Manuals</button><button onClick={()=>{setHelpOpen(false);navigate('/frontoffice/assistance');}} className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs hover:bg-[var(--surface-2)]"><MessageCircle size={15}/> Contact Assistance</button></div>}
      {userMenu && <div className="absolute right-3 top-[66px] z-[80] w-56 rounded-xl border border-[var(--border)] bg-white p-2 text-sm text-[var(--text)] shadow-xl"><div className="truncate px-3 py-2 text-xs text-[var(--text-muted)]">{email}</div><button onClick={()=>{setUserMenu(false);navigate('/frontoffice/configuration');}} className="block min-h-10 w-full rounded-lg px-3 text-left text-xs hover:bg-[var(--surface-2)]">Profile / Preferences</button><button onClick={logout} className="block min-h-10 w-full rounded-lg px-3 text-left text-xs text-red-700 hover:bg-[var(--surface-2)]">Sign out</button></div>}
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden"><Outlet/></main>
    </div>
  </div>;
}
