import React,{useMemo,useState}from"react";
import{useLocation,useNavigate}from"react-router-dom";
import{UtensilsCrossed,Grid3X3,CalendarDays,ClipboardList,Sparkles,Users,Boxes,Package,ShoppingCart,ChefHat,Shirt,ArrowRightLeft,Globe2,PlugZap,BarChart3,Percent,Banknote,ClipboardCheck,ShieldCheck,Settings,ChevronLeft,ChevronRight,ChevronDown,Menu,X,LayoutDashboard,Building2,Receipt,Search,LogOut}from"lucide-react";
import{useAuth}from"@/lib/AuthContext";
import{getDefaultModulesForRole,getSessionStaff,normalizeStaffRole,canUseModule}from"@/services/authService";

const MASTER_ROLES=new Set(["hotel_admin","super_admin"]);
const SECTIONS=[
 {key:"main",title:"Main",items:[
  {id:"dashboard",label:"Dashboard",icon:LayoutDashboard,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice",active:["dashboard"]},
  {id:"pos",label:"Point of Sale",icon:UtensilsCrossed,roles:["hotel_admin","super_admin","pos_staff","waiter","cashier","fb_manager"],path:"/pos",active:["pos"]},
  {id:"reports",label:"Reports",icon:BarChart3,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager"],path:"/backoffice/reports/sales",active:["reports"],group:"dropdown"}
 ]},
 {key:"items",title:"Items",items:[
  {id:"item-list",label:"Item list",icon:ClipboardList,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/items/list",active:["products"],sub:true},
  {id:"categories",label:"Categories",icon:Grid3X3,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/items/categories",active:["categories"],sub:true},
  {id:"modifiers",label:"Modifiers",icon:Sparkles,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/items/modifiers",active:["modifiers"],sub:true},
  {id:"discounts",label:"Discounts",icon:Percent,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/items/discounts",active:["discounts"],sub:true}
 ]},
 {key:"inventory-management",title:"Inventory management",items:[
  {id:"purchasing",label:"Purchase orders",icon:ShoppingCart,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/inventory/purchase-orders",active:["purchasing"],sub:true},
  {id:"transfers",label:"Transfer orders",icon:ArrowRightLeft,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/inventory/transfer-orders",active:["transfers"],sub:true},
  {id:"adjustments",label:"Stock adjustments",icon:ClipboardCheck,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/inventory/stock-adjustments",active:["inventory"],sub:true},
  {id:"counts",label:"Inventory counts",icon:Boxes,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/inventory/counts",active:["inventory"],sub:true},
  {id:"productions",label:"Productions",icon:ChefHat,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/inventory/productions",active:["recipes"],sub:true},
  {id:"suppliers",label:"Suppliers",icon:Package,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/inventory/suppliers",active:["suppliers"],sub:true},
  {id:"inventory-history",label:"Inventory history",icon:Receipt,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/inventory/history",active:["inventory"],sub:true},
  {id:"inventory-valuation",label:"Inventory valuation",icon:Banknote,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/backoffice/inventory/valuation",active:["inventory"],sub:true}
 ]},
 {key:"employees",title:"Employees",items:[
  {id:"employee-list",label:"Employee list",icon:Users,roles:["hotel_admin","super_admin"],path:"/backoffice/employees/list",active:["roles"],sub:true},
  {id:"access-rights",label:"Access rights",icon:ShieldCheck,roles:["hotel_admin","super_admin"],path:"/backoffice/employees/list",active:["roles"],sub:true},
  {id:"timecards",label:"Timecards",icon:CalendarDays,roles:["hotel_admin","super_admin"],path:"/backoffice/employees/timecards",active:["roles"],sub:true},
  {id:"total-hours",label:"Total hours worked",icon:ClipboardCheck,roles:["hotel_admin","super_admin"],path:"/backoffice/employees/hours",active:["roles"],sub:true}
 ]},
 {key:"operations",title:"Operations",items:[
  {id:"customers",label:"Customers",icon:Users,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice/customers",active:["guests"]},
  {id:"integrations",label:"Integrations",icon:PlugZap,roles:["hotel_admin","super_admin","front_office_manager"],path:"/backoffice/integrations",active:["booking-engine"],group:"dropdown"},
  {id:"settings",label:"Settings",icon:Settings,roles:["hotel_admin","super_admin","front_office_manager"],path:"/backoffice/settings/features",active:["settings"]}
 ]}
];

function getRole(user){const s=getSessionStaff();return normalizeStaffRole(s?.role||user?.staff?.role||user?.propertyRole||user?.role||"")}
function itemModule(item){if(["roles","settings"].includes(item.id))return"admin";if(["pos","cashier","dining-tables"].includes(item.id))return"pos";if(["store","products","recipes","purchasing","laundry","transfers","booking-engine","channels","reports","inventory"].includes(item.id))return"store";return"backoffice"}
function getAssigned(user,role){const s=getSessionStaff();const a=s?.assigned_modules??user?.staff?.assigned_modules;return Array.isArray(a)&&a.length?a:getDefaultModulesForRole(role)}

export default function Sidebar({activeModule,onModuleChange,staffRole}){
 const{user,logout}=useAuth();const navigate=useNavigate();const location=useLocation();
 const[collapsed,setCollapsedState]=useState(()=>{try{return localStorage.getItem("olitech_sidebar_collapsed")==="true"}catch{return false}});
 const[mobileOpen,setMobileOpen]=useState(false);const[query,setQuery]=useState("");const[ownerOpen,setOwnerOpen]=useState(false);
 const setCollapsed=v=>{setCollapsedState(v);try{localStorage.setItem("olitech_sidebar_collapsed",String(v))}catch{}};
 const role=normalizeStaffRole(staffRole||getRole(user));const assigned=useMemo(()=>getAssigned(user,role),[user,role]);const master=!!user?.isPlatformOwner||MASTER_ROLES.has(role);
 const canAccess=item=>master||(item.roles.includes(role)&&(itemModule(item)==="admin"||canUseModule(user,itemModule(item))));
 const sections=SECTIONS.map(s=>({...s,items:s.items.filter(canAccess).filter(i=>!query||i.label.toLowerCase().includes(query.toLowerCase()))})).filter(s=>s.items.length);
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
  <button type="button" onClick={()=>setMobileOpen(false)} className="absolute right-2 top-3 rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--bg)] md:hidden" aria-label="Close navigation"><X size={18}/></button>
 </aside>;

 return <>{mobileOpen&&<button type="button" onClick={()=>setMobileOpen(false)} aria-label="Close navigation" className="fixed inset-0 z-40 bg-[var(--brand-dark)]/30 backdrop-blur-sm md:hidden"/>}{sidebar}<button type="button" onClick={()=>setMobileOpen(true)} className="fixed left-3 top-3 z-30 rounded-xl border border-[var(--border)] bg-white p-2.5 text-[var(--text)] shadow-sm md:hidden" aria-label="Open navigation"><Menu size={20}/></button></>;
}