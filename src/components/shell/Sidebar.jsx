import React,{useEffect,useMemo,useState}from"react";
import{useLocation,useNavigate}from"react-router-dom";
import{UtensilsCrossed,Grid3X3,CalendarDays,ClipboardList,Sparkles,Users,Boxes,Package,ShoppingCart,ChefHat,Shirt,ArrowRightLeft,Globe2,PlugZap,BarChart3,Banknote,ClipboardCheck,ShieldCheck,Settings,LockKeyhole,ChevronLeft,ChevronRight,ChevronDown,Menu,X,LayoutDashboard,Building2,Receipt,UserCircle}from"lucide-react";
import{useAuth}from"@/lib/AuthContext";
import{getDefaultModulesForRole,getSessionStaff,normalizeStaffRole}from"@/services/authService";

const COLORS={dark:"#121418",yellow:"#FFC400",muted:"#6B7280"};
const MASTER_ROLES=new Set(["hotel_admin","super_admin"]);
const SECTIONS=[
 {key:"general",title:"General",module:"backoffice",items:[
  {id:"dashboard",label:"Dashboard",icon:LayoutDashboard,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice",active:["dashboard"]},
  {id:"pos",label:"Point of Sale",icon:UtensilsCrossed,roles:["hotel_admin","super_admin","pos_staff","waiter","cashier","fb_manager"],path:"/pos",active:["pos"]},
  {id:"rooms",label:"Room Planner",icon:CalendarDays,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk","housekeeping_supervisor"],path:"/backoffice?module=rooms",active:["rooms"]},
  {id:"reservations",label:"Reservations",icon:ClipboardList,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice?module=reservations",active:["reservations"]},
  {id:"guests",label:"Guests & Folio",icon:Users,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice?module=guests",active:["guests"]},
  {id:"receipts",label:"Receipts",icon:Receipt,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice?module=receipts",active:["receipts"]},
  {id:"housekeeping",label:"Housekeeping",icon:Sparkles,roles:["hotel_admin","super_admin","front_office_manager","housekeeping_supervisor"],path:"/backoffice?module=housekeeping",active:["housekeeping"]},
 ]},
 {key:"tools",title:"Tools",module:"store",items:[
  {id:"cashier",label:"Cashier Control",icon:Banknote,roles:["hotel_admin","super_admin","cashier","fb_manager"],path:"/backoffice?module=cashier",active:["cashier"]},
  {id:"store",label:"Inventory & Stock",icon:Boxes,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager","housekeeping_supervisor"],path:"/store",active:["store","inventory"]},
  {id:"products",label:"Products",icon:Package,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager"],path:"/store",active:["products"]},
  {id:"recipes",label:"Recipes / BOM",icon:ChefHat,roles:["hotel_admin","super_admin","store_manager","fb_manager"],path:"/store?module=recipes",active:["recipes"]},
  {id:"purchasing",label:"Purchasing",icon:ShoppingCart,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager"],path:"/store?module=purchasing",active:["purchasing"]},
  {id:"laundry",label:"Laundry",icon:Shirt,roles:["hotel_admin","super_admin","front_office_manager","housekeeping_supervisor"],path:"/backoffice?module=laundry",active:["laundry"]},
  {id:"transfers",label:"Stock Transfers",icon:ArrowRightLeft,roles:["hotel_admin","super_admin","store_manager","fb_manager","housekeeping_supervisor"],path:"/store?module=transfers",active:["transfers"]},
  {id:"booking-engine",label:"Booking Engine",icon:Globe2,roles:["hotel_admin","super_admin","front_office_manager"],path:"/backoffice?module=booking-engine",active:["booking-engine"]},
  {id:"channels",label:"Channel Manager",icon:PlugZap,roles:["hotel_admin","super_admin"],path:"/backoffice?module=channels",active:["channels"]},
  {id:"reports",label:"Reports",icon:BarChart3,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager"],path:"/store",active:["reports"]},
  {id:"kitchen",label:"Kitchen Display",icon:ChefHat,roles:["hotel_admin","super_admin","pos_staff","waiter","fb_manager"],path:"/backoffice?module=kitchen",active:["kitchen"]},
 ]},
 {key:"profile",title:"Profile",module:"admin",items:[
  {id:"roles",label:"Roles & Staff",icon:ShieldCheck,roles:["hotel_admin","super_admin"],path:"/admin/roles",active:["roles"]},
  {id:"settings",label:"Hotel Settings",icon:Settings,roles:["hotel_admin","super_admin"],path:"/admin",active:["settings"]},
 ]}
];

function getRole(user){const s=getSessionStaff();return normalizeStaffRole(s?.role||user?.staff?.role||user?.propertyRole||user?.role||"")}
function getAssigned(user,role){const s=getSessionStaff();const a=s?.assigned_modules??user?.staff?.assigned_modules;return Array.isArray(a)&&a.length?a:getDefaultModulesForRole(role)}

export default function Sidebar({activeModule,onModuleChange,collapsed:collapsedProp,setCollapsed:setCollapsedProp,staffRole}){
 const{user}=useAuth();const navigate=useNavigate();const location=useLocation();
 const[stored,setStored]=useState(()=>{try{return localStorage.getItem("olitech_sidebar_collapsed")==="true"}catch{return false}});
 const[mobileOpen,setMobileOpen]=useState(false);
 const collapsed=typeof collapsedProp==="boolean"?collapsedProp:stored;
 const setCollapsed=v=>{if(setCollapsedProp)setCollapsedProp(v);else{setStored(v);try{localStorage.setItem("olitech_sidebar_collapsed",String(v))}catch{}}};
 const role=normalizeStaffRole(staffRole||getRole(user));const assigned=useMemo(()=>getAssigned(user,role),[user,role]);const master=user?.isPlatformOwner||MASTER_ROLES.has(role);
 const canAccess=item=>master||item.roles.includes(role)&&((SECTIONS.find(s=>s.items.includes(item))?.module==="admin")||assigned.includes(SECTIONS.find(s=>s.items.includes(item))?.module));
 const sections=SECTIONS.map(s=>({...s,items:s.items.filter(canAccess)})).filter(s=>s.items.length);
 const hotelName=user?.property?.name||user?.property?.business_name||"OliTechs Hotel";
 const initials=(user?.name||getSessionStaff()?.full_name||"OT").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
 const go=item=>{onModuleChange?.(item.id==="dining-tables"?"pos":item.id);navigate(item.path);setMobileOpen(false)};
 const active=item=>item.id==="roles"?location.pathname==="/admin/roles"||activeModule==="roles":item.id==="settings"?location.pathname==="/admin"||activeModule==="settings":item.active?.includes(activeModule);
 const roleLabel={hotel_admin:"General Manager",super_admin:"Super Admin",front_office_manager:"Front Office Manager",receptionist:"Receptionist",front_desk:"Front Desk",pos_staff:"POS Staff",waiter:"Waiter",cashier:"Cashier",store_manager:"Store Manager",fb_manager:"F&B Manager",housekeeping_supervisor:"Housekeeping Supervisor"}[role]||"Staff";

 const panel=<aside className={`fixed left-0 top-0 z-[70] flex h-screen flex-col border-r border-[#E5E7EB] bg-white transition-[width,transform] duration-300 ease-out ${collapsed?"w-20":"w-[260px]"} ${mobileOpen?"translate-x-0":"-translate-x-full md:translate-x-0"}`} aria-label="OliTechs navigation">
  <div className={`flex h-[76px] shrink-0 items-center border-b border-[#F0F1F2] ${collapsed?"justify-center px-3":"gap-3 px-4"}`}>
   <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#121418] text-sm font-black text-[#FFC400]">OT</div>
   {!collapsed&&<div className="min-w-0"><div className="truncate text-[14px] font-black text-[#121418]">OliTechs</div><div className="text-[9px] font-bold uppercase tracking-[.18em] text-[#9CA3AF]">PMS & POS</div></div>}
   <button type="button" onClick={()=>setCollapsed(!collapsed)} className={`rounded-lg p-2 text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#121418] ${collapsed?"absolute right-1 top-4":"ml-auto"}`} title={collapsed?"Expand sidebar":"Collapse sidebar"}>{collapsed?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</button>
  </div>
  {!collapsed&&<div className="px-4 pt-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#9CA3AF]">Property</div><button type="button" className="flex w-full items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-left hover:bg-[#F3F4F6]"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFF9E6] text-[#121418]"><Building2 size={16}/></span><span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[#121418]">{hotelName}</span><ChevronDown size={15} className="text-[#9CA3AF]"/></button></div>}
  <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Dashboard"><div className="space-y-6">{sections.map(section=><section key={section.key}><div className={`mb-2 px-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#9CA3AF] ${collapsed?"text-center":""}`}>{collapsed?"•":section.title}</div><div className="space-y-1">{section.items.map(item=>{const Icon=item.icon;const isActive=active(item);return <button key={item.id} type="button" onClick={()=>go(item)} title={collapsed?item.label:undefined} className={`group relative flex w-full items-center rounded-lg transition-all duration-300 ${collapsed?"justify-center px-2 py-3":"gap-3 px-3 py-2.5"} ${isActive?"bg-[#FFF9E6] text-[#121418]":"text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#121418]"}`}><Icon size={18} strokeWidth={isActive?2.5:2}/>{!collapsed&&<span className={`min-w-0 flex-1 truncate text-left text-[12px] ${isActive?"font-black":"font-semibold"}`}>{item.label}</span>}{isActive&&!collapsed&&<span className="h-1.5 w-1.5 rounded-full bg-[#FFC400]"/>}{collapsed&&<span className="pointer-events-none absolute left-[68px] z-[90] hidden whitespace-nowrap rounded-lg bg-[#121418] px-2.5 py-2 text-[10px] font-bold text-white shadow-lg group-hover:block">{item.label}</span>}</button>})}</div></section>)}</div></nav>
  <div className="shrink-0 border-t border-[#F0F1F2] p-3"><div className={`flex items-center rounded-xl bg-[#FAFAF8] ${collapsed?"justify-center p-2":"gap-3 p-2"}`}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#121418] text-[10px] font-black text-[#FFC400]">{initials}</div>{!collapsed&&<div className="min-w-0 flex-1"><div className="truncate text-[11px] font-black text-[#121418]">{user?.name||getSessionStaff()?.full_name||"Staff"}</div><div className="truncate text-[9px] font-medium text-[#9CA3AF]">{roleLabel}</div></div>}{!collapsed&&<ChevronDown size={15} className="text-[#9CA3AF]"/>}</div></div>
  <button type="button" onClick={()=>setMobileOpen(false)} className="absolute right-3 top-5 md:hidden rounded-lg p-2 text-[#6B7280] hover:bg-[#F3F4F6]"><X size={18}/></button>
 </aside>;

 return <><button type="button" onClick={()=>setMobileOpen(true)} className="fixed left-3 top-3 z-[60] rounded-xl border border-[#E5E7EB] bg-white p-2.5 text-[#121418] shadow-sm md:hidden" aria-label="Open navigation"><Menu size={20}/></button>{mobileOpen&&<button type="button" aria-label="Close navigation" onClick={()=>setMobileOpen(false)} className="fixed inset-0 z-[65] bg-[#121418]/30 backdrop-blur-[2px] md:hidden"/>}{panel}<div aria-hidden="true" className={`hidden shrink-0 md:block transition-[width] duration-300 ${collapsed?"w-20":"w-[260px]"}`}/></>;
}
