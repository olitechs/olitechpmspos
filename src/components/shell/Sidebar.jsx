import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  UtensilsCrossed,
  Grid3X3,
  CalendarDays,
  ClipboardList,
  Sparkles,
  Users,
  Boxes,
  Package,
  ShoppingCart,
  ChefHat,
  Shirt,
  ArrowRightLeft,
  Globe2,
  PlugZap,
  RefreshCw,
  BarChart3,
  Banknote,
  ClipboardCheck,
  ShieldCheck,
  Settings,
  LockKeyhole,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  getDefaultModulesForRole,
  getSessionStaff,
  normalizeStaffRole,
} from '@/services/authService';

const COLORS = {
  black: '#090C11',
  panel: '#1A1D23',
  yellow: '#FFD300',
  muted: '#9CA3AF',
  border: '#1A1D23',
};

const MASTER_ROLES = new Set(['hotel_admin', 'super_admin']);

const SECTIONS = [
  {
    key: 'front-office',
    title: 'FRONT OFFICE',
    module: 'pos',
    items: [
      {
        id: 'pos',
        label: 'POS',
        sub: 'Floor Plan & Orders',
        icon: UtensilsCrossed,
        roles: ['hotel_admin', 'super_admin', 'pos_staff', 'waiter', 'cashier', 'fb_manager'],
        path: '/pos',
        active: ['pos'],
      },
      {
        id: 'night-audit',
        label: 'Night Audit',
        sub: 'Business Day Close',
        icon: ClipboardCheck,
        roles: ['hotel_admin', 'super_admin', 'fb_manager'],
        path: '/backoffice?module=night-audit',
        active: ['night-audit'],
      },
      {
        id: 'cashier',
        label: 'Cashier Control',
        sub: 'Shift & Reconciliation',
        icon: Banknote,
        roles: ['hotel_admin', 'super_admin', 'cashier', 'fb_manager'],
        path: '/backoffice?module=cashier',
        active: ['cashier'],
      },
      {
        id: 'dining-tables',
        label: 'Dining Tables',
        icon: Grid3X3,
        roles: ['hotel_admin', 'super_admin', 'pos_staff', 'waiter', 'cashier', 'fb_manager'],
        path: '/pos',
        active: ['pos', 'dining-tables'],
      },
    ],
  },
  {
    key: 'back-office',
    title: 'BACK OFFICE - PMS',
    module: 'backoffice',
    items: [
      {
        id: 'rooms',
        label: 'Room Planner',
        sub: 'Calendar',
        icon: CalendarDays,
        roles: ['hotel_admin', 'super_admin', 'front_office_manager', 'receptionist', 'front_desk', 'housekeeping_supervisor'],
        path: '/backoffice?module=rooms',
        active: ['rooms', 'dashboard'],
      },
      {
        id: 'reservations',
        label: 'Reservations',
        icon: ClipboardList,
        roles: ['hotel_admin', 'super_admin', 'front_office_manager', 'receptionist', 'front_desk'],
        path: '/backoffice?module=reservations',
        active: ['reservations'],
      },
      {
        id: 'housekeeping',
        label: 'Housekeeping',
        icon: Sparkles,
        roles: ['hotel_admin', 'super_admin', 'front_office_manager', 'housekeeping_supervisor'],
        path: '/backoffice?module=housekeeping',
        active: ['housekeeping'],
      },
      {
        id: 'guests',
        label: 'Guests & Folio',
        icon: Users,
        roles: ['hotel_admin', 'super_admin', 'front_office_manager', 'receptionist', 'front_desk'],
        path: '/backoffice?module=guests',
        active: ['guests'],
      },
    ],
  },
  {
    key: 'store',
    title: 'STORE / CONTROLS',
    module: 'store',
    items: [
      {
        id: 'store',
        label: 'Inventory & Stock',
        sub: 'Store Controls',
        icon: Boxes,
        roles: ['hotel_admin', 'super_admin', 'front_office_manager', 'store_manager', 'fb_manager', 'housekeeping_supervisor'],
        path: '/store',
        active: ['store', 'inventory'],
      },
      {
        id: 'recipes', label: 'Recipes / BOM', sub: 'F&B Costing', icon: ChefHat,
        roles: ['hotel_admin','super_admin','store_manager','fb_manager'], path: '/store?module=recipes', active: ['recipes'],
      },
      {
        id: 'laundry', label: 'Laundry', sub: 'Guest Services', icon: Shirt,
        roles: ['hotel_admin','super_admin','front_office_manager','housekeeping_supervisor'], path: '/backoffice?module=laundry', active: ['laundry'],
      },
      {
        id: 'transfers', label: 'Stock Transfers', sub: 'Department Movement', icon: ArrowRightLeft,
        roles: ['hotel_admin','super_admin','store_manager','fb_manager','housekeeping_supervisor'], path: '/store?module=transfers', active: ['transfers'],
      },
      {
        id: 'booking-engine', label: 'Booking Engine', sub: 'Direct Reservations', icon: Globe2,
        roles: ['hotel_admin','super_admin','front_office_manager'], path: '/backoffice?module=booking-engine', active: ['booking-engine'],
      },
      {
        id: 'channels', label: 'Channel Manager', sub: 'OTA Connectivity', icon: PlugZap,
        roles: ['hotel_admin','super_admin'], path: '/backoffice?module=channels', active: ['channels'],
      },
      {
        id: 'distribution-ops', label: 'Distribution Ops', sub: 'Sync & Confirmations', icon: RefreshCw,
        roles: ['hotel_admin','super_admin','front_office_manager'], path: '/backoffice?module=distribution-ops', active: ['distribution-ops'],
      },
      {
        id: 'purchasing',
        label: 'Purchasing',
        sub: 'Suppliers & Receiving',
        icon: ShoppingCart,
        roles: ['hotel_admin', 'super_admin', 'front_office_manager', 'store_manager', 'fb_manager'],
        path: '/store?module=purchasing',
        active: ['purchasing'],
      },
      {
        id: 'products',
        label: 'Products',
        icon: Package,
        roles: ['hotel_admin', 'super_admin', 'front_office_manager', 'store_manager', 'fb_manager'],
        path: '/store',
        active: ['store', 'inventory', 'products'],
      },
      {
        id: 'reports',
        label: 'Reports',
        icon: BarChart3,
        roles: ['hotel_admin', 'super_admin', 'front_office_manager', 'store_manager', 'fb_manager'],
        path: '/store',
        active: ['reports'],
      },
    ],
  },
  {
    key: 'admin',
    title: 'ADMIN',
    module: 'admin',
    items: [
      {
        id: 'roles',
        label: 'Roles & Staff',
        sub: 'PIN Access',
        icon: ShieldCheck,
        roles: ['hotel_admin', 'super_admin'],
        path: '/admin/roles',
        active: ['roles'],
      },
      {
        id: 'settings',
        label: 'Hotel Settings',
        icon: Settings,
        roles: ['hotel_admin', 'super_admin'],
        path: '/admin',
        active: ['settings'],
      },
    ],
  },
];

function getRole(user) {
  const sessionStaff = getSessionStaff();
  return normalizeStaffRole(
    sessionStaff?.role || user?.staff?.role || user?.propertyRole || user?.role || '',
  );
}

function getAssignedModules(user, role) {
  const sessionStaff = getSessionStaff();
  const assigned = sessionStaff?.assigned_modules ?? user?.staff?.assigned_modules;
  if (Array.isArray(assigned) && assigned.length) return assigned;
  return getDefaultModulesForRole(role);
}

export default function Sidebar({
  activeModule,
  onModuleChange,
  collapsed: collapsedProp,
  setCollapsed: setCollapsedProp,
  staffRole,
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = typeof collapsedProp === 'boolean' ? collapsedProp : internalCollapsed;
  const setCollapsed = setCollapsedProp || setInternalCollapsed;

  const role = normalizeStaffRole(staffRole || getRole(user));
  const assignedModules = useMemo(() => getAssignedModules(user, role), [user, role]);
  const master = user?.isPlatformOwner || MASTER_ROLES.has(role);

  const canAccess = (item) => {
    if (master) return true;
    if (!item.roles.includes(role)) return false;
    const module = SECTIONS.find((section) => section.items.includes(item))?.module;
    return module === 'admin' ? false : assignedModules.includes(module);
  };

  const go = (item, section) => {
    if (onModuleChange) {
      // POS has one routed screen containing its floor/order/payment tabs.
      // Dining Tables therefore intentionally opens the same POS workspace.
      onModuleChange(item.id === 'dining-tables' ? 'pos' : item.id);
    }
    navigate(item.path);
  };

  const isItemActive = (item) => {
    if (item.id === 'roles') return location.pathname === '/admin/roles' || activeModule === 'roles';
    if (item.id === 'settings') return location.pathname === '/admin' || activeModule === 'settings';
    return item.active?.includes(activeModule);
  };

  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(canAccess),
  })).filter((section) => master || section.items.length > 0);

  const initials = (user?.name || getSessionStaff()?.full_name || 'OT')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  const roleLabel = {
    hotel_admin: 'General Manager',
    super_admin: 'Super Admin',
    front_office_manager: 'Front Office Manager',
    receptionist: 'Receptionist',
    front_desk: 'Front Desk',
    pos_staff: 'POS Staff',
    waiter: 'Waiter',
    cashier: 'Cashier',
    store_manager: 'Store Manager',
    fb_manager: 'F&B Manager',
    housekeeping_supervisor: 'Housekeeping Supervisor',
  }[role] || user?.staff?.role || user?.propertyRole || 'Staff';

  return (
    <>
      <style>{`
        .olitechs-sidebar-scroll::-webkit-scrollbar { width: 4px; }
        .olitechs-sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
        .olitechs-sidebar-scroll::-webkit-scrollbar-thumb { background: ${COLORS.panel}; border-radius: 999px; }
        .olitechs-sidebar-scroll { scrollbar-width: thin; scrollbar-color: ${COLORS.panel} transparent; }
      `}</style>

      {/* Fixed navigation + matching flex spacer keeps the application content from being covered. */}
      <aside
        className={`fixed left-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden bg-[#090C11] text-white border-r-2 border-[#1A1D23] transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-60'}`}
        aria-label="OliTechs navigation"
      >
        <div className={`shrink-0 border-b border-[#1A1D23] px-2 py-3 ${collapsed ? 'flex justify-center' : ''}`}>
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2 px-1'}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFD300] text-xs font-black text-[#090C11]">
              OT
            </div>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-sm font-black text-white">OliTechs PMS</div>
                <div className="truncate text-[9px] font-black uppercase tracking-widest text-[#FFD300]">Visiwa Beach Resort</div>
              </div>
            )}
          </div>
        </div>

        <nav className="olitechs-sidebar-scroll flex-1 overflow-y-auto px-2 py-3" aria-label="Workspaces">
          <div className="space-y-5">
            {visibleSections.map((section) => (
              <section key={section.key}>
                {!collapsed && (
                  <div className="mb-2 px-2 text-[10px] font-black tracking-[0.16em] text-[#FFD300]/70">
                    {section.title}
                  </div>
                )}

                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = isItemActive(item);
                    const moduleLocked = !master && section.module !== 'admin' && !hasAssignedModule(assignedModules, section.module);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => go(item, section)}
                        title={collapsed ? `${item.label}${moduleLocked ? ' · PIN required' : ''}` : undefined}
                        aria-label={item.label}
                        className={`group flex w-full items-center rounded-xl border border-transparent text-left transition-colors ${
                          collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-2.5'
                        } ${
                          active
                            ? 'bg-[#FFD300] font-bold text-[#090C11]'
                            : 'text-gray-400 hover:bg-[#1A1D23] hover:text-white'
                        }`}
                      >
                        <Icon size={18} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />
                        {!collapsed && (
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-black leading-tight">{item.label}</span>
                            {item.sub && (
                              <span className={`mt-0.5 block truncate text-[9px] font-semibold ${active ? 'text-[#090C11]/70' : 'text-gray-500'}`}>
                                {item.sub}
                              </span>
                            )}
                          </span>
                        )}
                        {!collapsed && moduleLocked && section.module !== 'admin' && (
                          <LockKeyhole size={13} className={active ? 'text-[#090C11]' : 'text-gray-600'} aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </nav>

        <div className="shrink-0 border-t border-[#1A1D23] p-2">
          <div className={`mb-2 flex items-center rounded-xl ${collapsed ? 'justify-center p-1' : 'gap-2 px-2 py-2'}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFD300] text-[10px] font-black text-[#090C11]">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-xs font-black text-white">{user?.name || getSessionStaff()?.full_name || 'Staff'}</div>
                <div className="truncate text-[9px] font-bold text-gray-500">{roleLabel}</div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className={`flex w-full items-center rounded-xl border border-[#1A1D23] text-[10px] font-black text-gray-400 transition hover:bg-[#1A1D23] hover:text-white ${collapsed ? 'justify-center px-2 py-2.5' : 'justify-center gap-2 px-3 py-2'}`}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={15} aria-hidden="true" /> : <><ChevronLeft size={15} aria-hidden="true" /><span>Collapse</span></>}
          </button>
        </div>
      </aside>

      <div aria-hidden="true" className={`shrink-0 transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-60'}`} />
    </>
  );
}

function hasAssignedModule(assignedModules, module) {
  return Array.isArray(assignedModules) && assignedModules.includes(module);
}
=======
import React,{useEffect,useMemo,useState}from"react";
import{useLocation,useNavigate}from"react-router-dom";
import{ChevronLeft,ChevronRight,ChevronDown,Menu,X,Building2,Search,LogOut}from"lucide-react";
import{useAuth}from"@/lib/AuthContext";
import{getDefaultModulesForRole,getSessionStaff,normalizeStaffRole,canUseModule}from"@/services/authService";
import{MASTER_ROLES,SIDEBAR_SECTIONS}from"@/data/modules/sidebarNavigation";


function getRole(user){const s=getSessionStaff();return normalizeStaffRole(s?.role||user?.staff?.role||user?.propertyRole||user?.role||"")}
function itemModule(item){if(["roles","settings"].includes(item.id))return"admin";if(["room-planner","reservations","folio","housekeeping","night-audit"].includes(item.id))return"frontoffice";if(["pos","cashier","dining-tables"].includes(item.id))return"pos";if(["store","products","recipes","purchasing","laundry","transfers","booking-engine","channels","reports","inventory"].includes(item.id))return"store";return"backoffice"}
function getAssigned(user,role){const s=getSessionStaff();const a=s?.assigned_modules??user?.staff?.assigned_modules;return Array.isArray(a)&&a.length?a:getDefaultModulesForRole(role)}

export default function Sidebar({activeModule,onModuleChange,staffRole}){
 const{user,logout}=useAuth();const navigate=useNavigate();const location=useLocation();
 const[collapsed,setCollapsedState]=useState(()=>{try{return localStorage.getItem("olitech_sidebar_collapsed")==="true"}catch{return false}});
 const[mobileOpen,setMobileOpen]=useState(false);const[query,setQuery]=useState("");const[ownerOpen,setOwnerOpen]=useState(false);
 useEffect(()=>{if(!mobileOpen)return;const onKeyDown=event=>{if(event.key==="Escape")setMobileOpen(false)};window.addEventListener("keydown",onKeyDown);return()=>window.removeEventListener("keydown",onKeyDown)},[mobileOpen]);
 const setCollapsed=v=>{setCollapsedState(v);try{localStorage.setItem("olitech_sidebar_collapsed",String(v))}catch{}};
 const role=normalizeStaffRole(staffRole||getRole(user));const assigned=useMemo(()=>getAssigned(user,role),[user,role]);const master=!!user?.isPlatformOwner||MASTER_ROLES.has(role);
 const canAccess=item=>master||(item.roles.includes(role)&&(itemModule(item)==="admin"||canUseModule(user,itemModule(item))));
 const sections=SIDEBAR_SECTIONS.map(s=>({...s,items:s.items.filter(canAccess).filter(i=>!query||i.label.toLowerCase().includes(query.toLowerCase()))})).filter(s=>s.items.length);
 const hotelName=user?.property?.name||user?.property?.business_name||"OliTechs Hotel";
 const staff=getSessionStaff();const displayName=user?.name||staff?.full_name||"Staff";
 const initials=displayName.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"OT";
 const roleLabel={hotel_admin:"General Manager",super_admin:"Super Admin",front_office_manager:"Front Office Manager",receptionist:"Receptionist",front_desk:"Front Desk",pos_staff:"POS Staff",waiter:"Waiter",cashier:"Cashier",store_manager:"Store Manager",fb_manager:"F&B Manager",housekeeping_supervisor:"Housekeeping Supervisor"}[role]||"Staff";
 const go=item=>{onModuleChange?.(item.id==="dining-tables"?"pos":item.id);navigate(item.path);setMobileOpen(false)};
 const active=item=>item.id==="roles"?location.pathname.startsWith("/backoffice/employees/")||location.pathname==="/admin/roles"||activeModule==="roles":item.id==="settings"?location.pathname.startsWith("/backoffice/settings/")||location.pathname.startsWith("/settings/")||activeModule==="settings":item.active?.includes(activeModule);

 const sidebar=<aside className={`z-50 flex h-[calc(100vh-16px)] flex-none flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] transition-all duration-300 ease-in-out m-2 md:relative md:translate-x-0 fixed top-0 left-0 ${collapsed?"w-[88px]":"w-[280px]"} ${mobileOpen?"translate-x-0":"-translate-x-[calc(100%+16px)] md:translate-x-0"}`} aria-label="OliTechs dashboard navigation">
  <div className={`flex h-[72px] shrink-0 items-center border-b border-[var(--border)] ${collapsed?"justify-center px-3":"gap-3 px-4"}`}>
   <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-dark)] text-sm font-black text-[var(--brand-primary)]">OT</div>
   {!collapsed&&<div className="min-w-0"><div className="text-[14px] font-black tracking-tight text-[var(--text)]">OliTechs</div><div className="text-[9px] font-bold uppercase tracking-[.2em] text-[var(--muted)]">PMS & POS</div></div>}
   <button type="button" onClick={()=>setCollapsed(!collapsed)} className={`rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--text)] ${collapsed?"absolute right-2 top-4":"ml-auto"}`} title={collapsed?"Expand sidebar":"Collapse sidebar"}>{collapsed?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</button>
  </div>
  <div className="shrink-0 px-3 pt-4">
   {!collapsed&&<div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[.13em] text-[var(--muted)]">Property</div>}
   <button type="button" className={`flex w-full items-center rounded-xl bg-[var(--bg)] text-left hover:bg-[var(--brand-soft)] ${collapsed?"justify-center p-2.5":"gap-3 px-3 py-2.5"}`} title={collapsed?hotelName:undefined}>
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--text)]"><Building2 size={17}/></span>
    {!collapsed&&<><span className="min-w-0 flex-1 truncate text-[12px] font-bold text-[var(--text)]">{hotelName}</span><ChevronDown size={15} className="shrink-0 text-[var(--muted)]"/></>}
   </button>
  </div>
  {!collapsed&&<div className="shrink-0 px-3 pt-3"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search" aria-label="Search navigation" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs outline-none focus:border-[var(--brand-primary)]"/></div></div>}
  <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-4">
   {sections.map(section=><section key={section.key} className="mb-5 last:mb-0"><div className={`mb-2 px-2 text-[11px] font-bold uppercase tracking-[.13em] text-[var(--muted)] ${collapsed?"text-center":""}`}>{collapsed?"•":section.title}</div><div className="space-y-1">{section.items.map(item=>{const Icon=item.icon;const isActive=active(item);return <button key={item.id} type="button" onClick={()=>go(item)} title={collapsed?item.label:undefined} className={`group relative flex h-10 w-full items-center rounded-[10px] ${item.sub&&!collapsed?'pl-8':''} transition-all duration-300 ease-in-out ${collapsed?"justify-center px-2":"gap-3 px-3"} ${isActive?"bg-[var(--bg)] text-[var(--text)]":"text-[var(--muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--text)]"}`}><Icon size={19} strokeWidth={isActive?2.5:1.9}/>{!collapsed&&<span className={`min-w-0 flex-1 truncate text-left text-[13px] ${isActive?"font-bold":"font-medium"}`}>{item.label}</span>}{!collapsed&&item.id==="reservations"&&<span className="rounded-md border border-[var(--border)] bg-white px-1.5 py-0.5 text-[10px] font-bold text-[var(--text)]">2</span>}{!collapsed&&isActive&&<span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-primary)]"/>}{collapsed&&<span className="pointer-events-none absolute left-[76px] z-[100] hidden whitespace-nowrap rounded-lg bg-[var(--brand-dark)] px-2.5 py-2 text-[11px] font-semibold text-white shadow-lg group-hover:block">{item.label}</span>}</button>})}</div></section>)}
  </nav>
  <div className="shrink-0 border-t border-[var(--border)] px-3 py-2">
   <button type="button" onClick={logout} title={collapsed?"Log out":undefined} className={`flex h-10 w-full items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--text)] ${collapsed?"justify-center":"gap-3 px-3"}`}><LogOut size={19}/>{!collapsed&&<span className="text-[13px] font-medium">Log out</span>}</button>
  </div>
  <div className={`shrink-0 border-t border-[var(--border)] ${collapsed?"p-2":"p-3"}`}>
   <button type="button" onClick={()=>setOwnerOpen(v=>!v)} className={`flex w-full items-center rounded-xl bg-[var(--brand-surface)] ${collapsed?"justify-center p-2":"gap-3 p-2"}`}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary)] text-[11px] font-black text-[var(--text)]">{initials}</div>{!collapsed&&<div className="min-w-0 flex-1 text-left"><div className="truncate text-[12px] font-bold text-[var(--text)]">{displayName}</div><div className="truncate text-[10px] text-[var(--muted)]">{roleLabel}</div></div>}{!collapsed&&<ChevronDown size={15} className="text-[var(--muted)]"/>}</button>{ownerOpen&&!collapsed&&<div className="mt-2 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg"><button onClick={()=>navigate("/admin")} className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--brand-soft)]">Account</button><button onClick={logout} className="block w-full px-3 py-2 text-left text-xs text-[var(--danger)] hover:bg-[var(--brand-soft)]">Sign out</button></div>}
  </div>
  <button type="button" onClick={()=>setMobileOpen(false)} className="absolute right-2 top-3 rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--bg)] md:hidden" aria-label="Close navigation" aria-expanded={mobileOpen}><X size={18}/></button>
 </aside>;

 return <>{mobileOpen&&<button type="button" onClick={()=>setMobileOpen(false)} aria-label="Close navigation" className="fixed inset-0 z-40 bg-[var(--brand-dark)]/30 backdrop-blur-sm md:hidden"/>}{sidebar}<button type="button" onClick={()=>setMobileOpen(true)} className="fixed left-3 top-3 z-30 rounded-xl border border-[var(--border)] bg-white p-2.5 text-[var(--text)] shadow-sm md:hidden" aria-label="Open navigation" aria-expanded={mobileOpen}><Menu size={20}/></button></>;
}