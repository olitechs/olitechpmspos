import { LayoutDashboard,UtensilsCrossed,BarChart3,BedDouble,CalendarDays,Receipt,Sparkles,ClipboardCheck,ClipboardList,Grid3X3,Percent,ShoppingCart,ArrowRightLeft,Boxes,ChefHat,Package,Banknote,Users,ShieldCheck,PlugZap,Settings } from 'lucide-react';

export const MASTER_ROLES = new Set(["hotel_admin", "super_admin"]);
export const SIDEBAR_SECTIONS=[
 {key:"main",title:"Main",items:[
  {id:"dashboard",label:"Dashboard",icon:LayoutDashboard,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/backoffice",active:["dashboard"]},
  {id:"pos",label:"Point of Sale",icon:UtensilsCrossed,roles:["hotel_admin","super_admin","pos_staff","waiter","cashier","fb_manager"],path:"/pos",active:["pos"]},
  {id:"reports",label:"Reports",icon:BarChart3,roles:["hotel_admin","super_admin","front_office_manager","store_manager","fb_manager"],path:"/backoffice/reports/sales",active:["reports"],group:"dropdown"}
 ]},
 {key:"front-office",title:"Front Office",items:[
  {id:"room-planner",label:"Room Planner",icon:BedDouble,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk","housekeeping_supervisor"],path:"/frontoffice/room-planner",active:["rooms","room-planner"]},
  {id:"reservations",label:"Reservations",icon:CalendarDays,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/frontoffice/reservations",active:["reservations"]},
  {id:"folio",label:"Guest Folio",icon:Receipt,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk"],path:"/frontoffice/folio",active:["folio"]},
  {id:"housekeeping",label:"Housekeeping",icon:Sparkles,roles:["hotel_admin","super_admin","front_office_manager","receptionist","front_desk","housekeeping_supervisor"],path:"/frontoffice/housekeeping",active:["housekeeping"]},
  {id:"night-audit",label:"Night Audit",icon:ClipboardCheck,roles:["hotel_admin","super_admin","front_office_manager"],path:"/frontoffice/night-audit",active:["night-audit"]}
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

