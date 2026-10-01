import React,{useMemo,useState}from"react";
import{useLocation,useNavigate}from"react-router-dom";
import{UtensilsCrossed,Grid3X3,CalendarDays,ClipboardList,Sparkles,Users,Boxes,Package,ShoppingCart,ChefHat,Shirt,ArrowRightLeft,Globe2,PlugZap,BarChart3,Banknote,ClipboardCheck,ShieldCheck,Settings,ChevronLeft,ChevronRight,ChevronDown,Menu,X,LayoutDashboard,Building2,Receipt,Search,MessageCircle,Bell,LogOut}from"lucide-react";
import{useAuth}from"@/lib/AuthContext";
import{getDefaultModulesForRole,getSessionStaff,normalizeStaffRole}from"@/services/authService";

const MASTER_ROLES=new Set(["hotel_admin","super_admin"]);
const SECTIONS=[
 {key:"general",title:"General",items:[
  {id:"dashboard",label:"Dashboard",icon:LayoutDashboard,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice",active:["dashboard"]},
  {id:"pos",label:"Point of Sale",icon:UtensilsCrossed,roles:["hotel_admin","super_admin","pos_staff","waiter","cashier","fb_manager"],path:"/pos",active:["pos"]},
  {id:"night-audit",label:"Night Audit",icon:ClipboardCheck,roles:["hotel_admin","super_admin","fb_manager"],path:"/backoffice?module=night-audit",active:["night-audit"]},
  {id:"rooms",label:"Room Planner",icon:CalendarDays,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk","housekeeping_supervisor"],path:"/backoffice?module=rooms",active:["rooms"]},
  {id:"reservations",label:"Reservations",icon:ClipboardList,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice?module=reservations",active:["reservations"]},
  {id:"guests",label:"Guests & Folio",icon:Users,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice?module=guests",active:["guests"]},
  {id:"receipts",label:"Receipts",icon:Receipt,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice?module=receipts",active:["receipts"]},
  {id:"maintenance",label:"Maintenance",icon:Settings,roles:["hotel_admin","super_admin","front_office_manager","housekeeping_supervisor"],path:"/backoffice?module=maintenance",active:["maintenance"]},
  {id:"housekeeping",label:"Housekeeping",icon:Sparkles,roles:["hotel_admin","super_admin","front_office_manager","housekeeping_supervisor"],path:"/backoffice?module=housekeeping",active:["housekeeping"]}
 ]},
 {key:"tools",title:"Tools",items:[
  {id:"dining-tables",label:"Dining Tables",icon:Grid3X3,roles:["hotel_admin","super_admin","pos_staff","waiter","cashier","fb_manager"],path:"/pos",active:["pos","dining-tables"]},
  {id:"cashier",label:"Cashier Control",icon:Banknote,roles:["hotel_admin","super_admin","cashier","fb_manager"],path:"/backoffice?module=cashier",active:["cashier"]},
  {id:"store",label:"Inventory & Stock",icon:Boxes,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager","housekeeping_supervisor"],path:"/store",active:["store","inventory"]},
  {id:"inventory",label:"Inventory",icon:Package,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager"],path:"/store",active:["inventory"]},
  {id:"products",label:"Products",icon:Package,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager"],path:"/store",active:["products"]},
  {id:"recipes",label:"Recipes / BOM",icon:ChefHat,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/store?module=recipes",active:["recipes"]},
  {id:"purchasing",label:"Purchasing",icon:ShoppingCart,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager"],path:"/store?module=purchasing",active:["purchasing"]},
  {id:"laundry",label:"Laundry",icon:Shirt,roles:["hotel_admin","super_admin","front_office_manager","housekeeping_supervisor"],path:"/backoffice?module=laundry",active:["laundry"]},
  {id:"transfers",label:"Stock Transfers",icon:ArrowRightLeft,roles:["hotel_admin","super_admin","store_manager","fb_manager","housekeeping_supervisor"],path:"/store?module=transfers",active:["transfers"]},
  {id:"booking-engine",label:"Booking Engine",icon:Globe2,roles:["hotel_admin","super_admin","front_office_manager"],path:"/backoffice?module=booking-engine",active:["booking-engine"]},
  {id:"channels",label:"Channel Manager",icon:PlugZap,roles:["hotel_admin","super_admin"],path:"/backoffice?module=channels",active:["channels"]},
  {id:"reports",label:"Reports",icon:BarChart3,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager"],path:"/store",active:["reports"]},
  {id:"kitchen",label:"Kitchen Display",icon:ChefHat,roles:["hotel_admin","super_admin","pos_staff","waiter","fb_manager"],path:"/backoffice?module=kitchen",active:["kitchen"]}
 ]},
 {key:"profile",title:"Profile",items:[
  {id:"roles",label:"Roles & Staff",icon:ShieldCheck,roles:["hotel_admin","super_admin"],path:"/admin/roles",active:["roles"]},
  {id:"settings",label:"Hotel Settings",icon:Settings,roles:["hotel_admin","super_admin"],path:"/admin",active:["settings"]}
 ]}
];

function getRole(user){const s=getSessionStaff();return normalizeStaffRole(s?.role||user?.staff?.role||user?.propertyRole||user?.role||"")}
function itemModule(item){if(["roles","settings"].includes(item.id))return"admin";if(["pos","cashier","dining-tables"].includes(item.id))return"pos";if(["store","products","recipes","purchasing","laundry","transfers","booking-engine","channels","reports","inventory"].includes(item.id))return"store";return"backoffice"}
function getAssigned(user,role){const s=getSessionStaff();const a=s?.assigned_modules??user?.staff?.assigned_modules;return Array.isArray(a)&&a.length?a:getDefaultModulesForRole(role)}

export default function Sidebar({activeModule,onModuleChange,staffRole}){
 const{user,logout}=useAuth();const navigate=useNavigate();const location=useLocation();
 const[collapsed,setCollapsedState]=useState(()=>{try{return localStorage.getItem("olitech_sidebar_collapsed")==="true"}catch{return false}});
 const[mobileOpen,setMobileOpen]=useState(false);const[query,setQuery]=useState("");
 const setCollapsed=v=>{setCollapsedState(v);try{localStorage.setItem("olitech_sidebar_collapsed",String(v))}catch{}};
 const role=normalizeStaffRole(staffRole||getRole(user));const assigned=useMemo(()=>getAssigned(user,role),[user,role]);const master=!!user?.isPlatformOwner||MASTER_ROLES.has(role);
 const canAccess=item=>master||(item.roles.includes(role)&&(itemModule(item)==="admin"||assigned.includes(itemModule(item))));
 const sections=SECTIONS.map(s=>({...s,items:s.items.filter(canAccess).filter(i=>!query||i.label.toLowerCase().includes(query.toLowerCase()))})).filter(s=>s.items.length);
 const hotelName=user?.property?.name||user?.property?.business_name||"OliTechs Hotel";
 const staff=getSessionStaff();const displayName=user?.name||staff?.full_name||"Staff";
 const initials=displayName.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"OT";
 const roleLabel={hotel_admin:"General Manager",super_admin:"Super Admin",front_office_manager:"Front Office Manager",receptionist:"Receptionist",front_desk:"Front Desk",pos_staff:"POS Staff",waiter:"Waiter",cashier:"Cashier",store_manager:"Store Manager",fb_manager:"F&B Manager",housekeeping_supervisor:"Housekeeping Supervisor"}[role]||"Staff";
 const go=item=>{onModuleChange?.(item.id==="dining-tables"?"pos":item.id);navigate(item.path);setMobileOpen(false)};
 const active=item=>item.id==="roles"?location.pathname==="/admin/roles"||activeModule==="roles":item.id==="settings"?location.pathname==="/admin"||activeModule==="settings":item.active?.includes(activeModule);

 const sidebar=<aside className={`z-50 flex h-[calc(100vh-16px)] flex-none flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm transition-all duration-300 ease-in-out m-2 md:relative md:translate-x-0 fixed top-0 left-0 ${collapsed?"w-[88px]":"w-[280px]"} ${mobileOpen?"translate-x-0":"-translate-x-[calc(100%+16px)] md:translate-x-0"}`} aria-label="OliTechs dashboard navigation">
  <div className={`flex h-[72px] shrink-0 items-center border-b border-[#F0F1F2] ${collapsed?"justify-center px-3":"gap-3 px-4"}`}>
   <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#121418] text-sm font-black text-[#FFC400]">OT</div>
   {!collapsed&&<div className="min-w-0"><div className="text-[14px] font-black tracking-tight text-[#121418]">OliTechs</div><div className="text-[9px] font-bold uppercase tracking-[.2em] text-[#9CA3AF]">PMS & POS</div></div>}
   <button type="button" onClick={()=>setCollapsed(!collapsed)} className={`rounded-lg border border-[#E5E7EB] bg-[#F3F4F6] p-2 text-[#6B7280] hover:bg-[#E5E7EB] hover:text-[#121418] ${collapsed?"absolute right-2 top-4":"ml-auto"}`} title={collapsed?"Expand sidebar":"Collapse sidebar"}>{collapsed?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</button>
  </div>
  <div className="shrink-0 px-3 pt-4">
   {!collapsed&&<div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[.13em] text-[#9CA3AF]">Property</div>}
   <button type="button" className={`flex w-full items-center rounded-xl bg-[#F3F4F6] text-left hover:bg-[#EDEFF1] ${collapsed?"justify-center p-2.5":"gap-3 px-3 py-2.5"}`} title={collapsed?hotelName:undefined}>
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#121418]"><Building2 size={17}/></span>
    {!collapsed&&<><span className="min-w-0 flex-1 truncate text-[12px] font-bold text-[#121418]">{hotelName}</span><ChevronDown size={15} className="shrink-0 text-[#9CA3AF]"/></>}
   </button>
  </div>
  {!collapsed&&<div className="shrink-0 px-3 pt-3"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search" aria-label="Search navigation" className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white pl-9 pr-3 text-xs outline-none focus:border-[#FFC400]"/></div></div>}
  <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-4">
   {sections.map(section=><section key={section.key} className="mb-5 last:mb-0"><div className={`mb-2 px-2 text-[11px] font-bold uppercase tracking-[.13em] text-[#9CA3AF] ${collapsed?"text-center":""}`}>{collapsed?"•":section.title}</div><div className="space-y-1">{section.items.map(item=>{const Icon=item.icon;const isActive=active(item);return <button key={item.id} type="button" onClick={()=>go(item)} title={collapsed?item.label:undefined} className={`group relative flex h-10 w-full items-center rounded-[10px] transition-all duration-300 ease-in-out ${collapsed?"justify-center px-2":"gap-3 px-3"} ${isActive?"bg-[#F3F4F6] text-[#111827]":"text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827]"}`}><Icon size={19} strokeWidth={isActive?2.5:1.9}/>{!collapsed&&<span className={`min-w-0 flex-1 truncate text-left text-[13px] ${isActive?"font-bold":"font-medium"}`}>{item.label}</span>}{!collapsed&&item.id==="reservations"&&<span className="rounded-md border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#111827]">2</span>}{!collapsed&&isActive&&<span className="h-1.5 w-1.5 rounded-full bg-[#FFC400]"/>}{collapsed&&<span className="pointer-events-none absolute left-[76px] z-[100] hidden whitespace-nowrap rounded-lg bg-[#121418] px-2.5 py-2 text-[11px] font-semibold text-white shadow-lg group-hover:block">{item.label}</span>}</button>})}</div></section>)}
  </nav>
  <div className="shrink-0 border-t border-[#E5E7EB] px-3 py-2">
   {[["Messages",MessageCircle,"2"],["Notifications",Bell,null]].map(([label,Icon,badge])=><button key={label} type="button" title={collapsed?label:undefined} className={`group relative flex h-10 w-full items-center rounded-[10px] text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827] ${collapsed?"justify-center":"gap-3 px-3"}`}><Icon size={19}/>{!collapsed&&<span className="flex-1 text-left text-[13px] font-medium">{label}</span>}{!collapsed&&badge&&<span className="rounded-md border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#111827]">{badge}</span>}{collapsed&&<span className="pointer-events-none absolute left-[76px] z-[100] hidden whitespace-nowrap rounded-lg bg-[#121418] px-2.5 py-2 text-[11px] font-semibold text-white shadow-lg group-hover:block">{label}</span>}</button>)}
   <button type="button" onClick={()=>{onModuleChange?.("settings");navigate("/admin")}} title={collapsed?"Settings":undefined} className={`flex h-10 w-full items-center rounded-[10px] text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827] ${collapsed?"justify-center":"gap-3 px-3"}`}><Settings size={19}/>{!collapsed&&<span className="text-[13px] font-medium">Settings</span>}</button>
   <button type="button" onClick={logout} title={collapsed?"Log out":undefined} className={`flex h-10 w-full items-center rounded-[10px] text-[#6B7280] hover:bg-[#FFF7ED] hover:text-[#111827] ${collapsed?"justify-center":"gap-3 px-3"}`}><LogOut size={19}/>{!collapsed&&<span className="text-[13px] font-medium">Log out</span>}</button>
  </div>
  <div className={`shrink-0 border-t border-[#E5E7EB] ${collapsed?"p-2":"p-3"}`}>
   <div className={`flex items-center rounded-xl bg-[#FAFAF8] ${collapsed?"justify-center p-2":"gap-3 p-2"}`}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFC400] text-[11px] font-black text-[#121418]">{initials}</div>{!collapsed&&<div className="min-w-0 flex-1"><div className="truncate text-[12px] font-bold text-[#121418]">{displayName}</div><div className="truncate text-[10px] text-[#6B7280]">{roleLabel}</div></div>}{!collapsed&&<ChevronDown size={15} className="text-[#9CA3AF]"/>}</div>
  </div>
  <button type="button" onClick={()=>setMobileOpen(false)} className="absolute right-2 top-3 rounded-lg p-2 text-[#6B7280] hover:bg-[#F3F4F6] md:hidden" aria-label="Close navigation"><X size={18}/></button>
 </aside>;

 return <>{mobileOpen&&<button type="button" onClick={()=>setMobileOpen(false)} aria-label="Close navigation" className="fixed inset-0 z-40 bg-[#121418]/30 backdrop-blur-sm md:hidden"/>}{sidebar}<button type="button" onClick={()=>setMobileOpen(true)} className="fixed left-3 top-3 z-30 rounded-xl border border-[#E5E7EB] bg-white p-2.5 text-[#121418] shadow-sm md:hidden" aria-label="Open navigation"><Menu size={20}/></button></>;
}