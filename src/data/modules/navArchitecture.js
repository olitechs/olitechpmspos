import { BarChart3, ShoppingBag, ShoppingCart, Users, PlugZap, Settings, HelpCircle, Building2, Store, Printer, MonitorCog, LayoutGrid, LayoutDashboard } from 'lucide-react';

export const MAIN_NAV = [
  { id:'backoffice', label:'Back Office', path:'/backoffice', roles:['admin','owner'], color:'#2C3E50', icon:LayoutDashboard },
  { id:'frontoffice', label:'Front Office', path:'/frontoffice', roles:['admin','owner','front_office_manager','front_desk','housekeeping'], color:'#2C3E50', icon:Building2 },
  { id:'pos', label:'POS & F&B', path:'/pos', roles:['admin','owner','pos_staff','front_desk'], color:'#2C3E50', icon:ShoppingCart },
  { id:'stores', label:'Stores', path:'/stores', roles:['admin','owner','store_manager'], color:'#2C3E50', icon:Store },
];

export const BACK_OFFICE_NAV = [
  { id:'reports', label:'Reports', icon:BarChart3, color:'#4CAF50', children:[['Sales report','/backoffice/reports/sales'],['Inventory report','/backoffice/reports/inventory'],['Employee report','/backoffice/reports/employees']] },
  { id:'items', label:'Items', icon:ShoppingBag, color:'#E91E63', expanded:true, children:[['Item list','/backoffice/items/list'],['Categories','/backoffice/items/categories'],['Modifiers','/backoffice/items/modifiers'],['Discounts','/backoffice/items/discounts']] },
  { id:'inventory', label:'Inventory management', icon:ShoppingCart, color:'#2196F3', expanded:true, children:[['Purchase orders','/backoffice/inventory/purchase-orders'],['Transfer orders','/backoffice/inventory/transfer-orders'],['Stock adjustments','/backoffice/inventory/stock-adjustments'],['Inventory counts','/backoffice/inventory/counts'],['Productions','/backoffice/inventory/productions'],['Suppliers','/backoffice/inventory/suppliers'],['Inventory history','/backoffice/inventory/history'],['Inventory valuation','/backoffice/inventory/valuation']] },
  { id:'employees', label:'Employees', icon:Users, color:'#009688', expanded:true, children:[['Employee list','/backoffice/employees/list'],['Access rights','/backoffice/employees/access-rights'],['Timecards','/backoffice/employees/timecards'],['Total hours worked','/backoffice/employees/hours']] },
  { id:'customers', label:'Customers', icon:Users, path:'/backoffice/customers' },
  { id:'integrations', label:'Integrations', icon:PlugZap, path:'/backoffice/integrations' },
  { id:'settings', label:'Settings', icon:Settings, color:'#757575', path:'/backoffice/settings/features', children:[['Features','/backoffice/settings/features'],['Billing & subscriptions','/backoffice/settings/billing'],['Payment types','/backoffice/settings/payment-types'],['Loyalty','/backoffice/settings/loyalty'],['Taxes','/backoffice/settings/taxes'],['Receipt','/backoffice/settings/receipt'],['Open tickets','/backoffice/settings/open-tickets'],['Kitchen printers','/backoffice/settings/kitchen-printers'],['Dining options','/backoffice/settings/dining-options']] },
  { id:'help', label:'Help', icon:HelpCircle, path:'/backoffice/help', notification:true },
];

export const STORES_NAV = [['All Stores','/stores','store'],['Store Settings','/stores/settings','settings'],['POS Devices','/stores/pos-devices','devices'],['Printers','/stores/printers','printers'],['KDS Screens','/stores/kds','kds']];
export const FRONT_OFFICE_NAV = [['Dashboard','/frontoffice','dashboard',['admin','owner','front_office_manager','front_desk','housekeeping']],['Room Rack','/frontoffice/rooms','rooms',['admin','owner','front_office_manager','front_desk','housekeeping']],['Reservations','/frontoffice/reservations','reservations',['admin','owner','front_office_manager','front_desk']],['Folio','/frontoffice/folio','folio',['admin','owner','front_office_manager','front_desk']],['Housekeeping','/frontoffice/housekeeping','housekeeping',['admin','owner','front_office_manager','front_desk','housekeeping']],['Night Audit','/frontoffice/night-audit','night-audit',['admin','owner','front_office_manager']]];

export const ROLE_ALIASES = { hotel_admin:'admin', super_admin:'owner', general_manager:'owner', receptionist:'front_desk', housekeeping_supervisor:'housekeeping', housekeeper:'housekeeping', waiter:'pos_staff', cashier:'pos_staff', fb_manager:'pos_staff' };
export function normalizeAppRole(role){ const v=String(role||'').toLowerCase().trim(); return ROLE_ALIASES[v]||v||'front_desk'; }
export function canAccessApp(role,appId){ const app=MAIN_NAV.find(x=>x.id===appId); return !!app && app.roles.includes(normalizeAppRole(role)); }
export function getDefaultApp(role){ const r=normalizeAppRole(role); return MAIN_NAV.find(x=>x.roles.includes(r))?.id||'backoffice'; }
