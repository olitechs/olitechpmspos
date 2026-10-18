import { BarChart3, ShoppingBag, ShoppingCart, Users, PlugZap, Settings, HelpCircle, Building2, Store, LayoutDashboard } from 'lucide-react';

export const MAIN_NAV = [
  { id:'backoffice', label:'Back Office', path:'/backoffice', roles:['admin','owner'], color:'var(--brand-dark)', icon:LayoutDashboard },
  { id:'frontoffice', label:'Front Office', path:'/frontoffice', roles:['admin','owner','front_office_manager','front_desk','housekeeping'], color:'var(--brand-dark)', icon:Building2 },
  { id:'pos', label:'POS & F&B', path:'/pos', roles:['admin','owner','pos_staff','front_desk'], color:'var(--brand-dark)', icon:ShoppingCart },
  { id:'stores', label:'Stores', path:'/stores', roles:['admin','owner','store_manager'], color:'var(--brand-dark)', icon:Store },
];
export const BACK_OFFICE_NAV = [
  { id:'reports', label:'Reports', icon:BarChart3, children:[['Sales report','/backoffice/reports/sales'],['Inventory report','/backoffice/reports/inventory'],['Employee report','/backoffice/reports/employees']] },
  { id:'items', label:'Items', icon:ShoppingBag, expanded:true, children:[['Item list','/backoffice/items/list'],['Categories','/backoffice/items/categories'],['Modifiers','/backoffice/items/modifiers'],['Discounts','/backoffice/items/discounts']] },
  { id:'inventory', label:'Inventory management', icon:ShoppingCart, expanded:true, children:[['Purchase orders','/backoffice/inventory/purchase-orders'],['Transfer orders','/backoffice/inventory/transfer-orders'],['Stock adjustments','/backoffice/inventory/stock-adjustments'],['Inventory counts','/backoffice/inventory/counts'],['Productions','/backoffice/inventory/productions'],['Suppliers','/backoffice/inventory/suppliers'],['Inventory history','/backoffice/inventory/history'],['Inventory valuation','/backoffice/inventory/valuation']] },
  { id:'employees', label:'Employees', icon:Users, expanded:true, children:[['Employee list','/backoffice/employees/list'],['Access rights','/backoffice/employees/access-rights'],['Timecards','/backoffice/employees/timecards'],['Total hours worked','/backoffice/employees/hours']] },
  { id:'customers', label:'Customers', icon:Users, path:'/backoffice/customers' },
  { id:'integrations', label:'Integrations', icon:PlugZap, path:'/backoffice/integrations' },
  { id:'settings', label:'Settings', icon:Settings, path:'/backoffice/settings/features', children:[['Features','/backoffice/settings/features'],['Billing & subscriptions','/backoffice/settings/billing'],['Payment types','/backoffice/settings/payment-types'],['Loyalty','/backoffice/settings/loyalty'],['Taxes','/backoffice/settings/taxes'],['Receipt','/backoffice/settings/receipt'],['Open tickets','/backoffice/settings/open-tickets'],['Kitchen printers','/backoffice/settings/kitchen-printers'],['Dining options','/backoffice/settings/dining-options']] },
  { id:'help', label:'Help', icon:HelpCircle, path:'/backoffice/help', notification:true },
];
export const STORES_NAV = [['All Stores','/stores','store'],['POS Devices','/stores/pos-devices','devices'],['Printers','/stores/printers','printers'],['KDS Screens','/stores/kds','kds']];
export const FRONT_OFFICE_NAV = [['Dashboard','/frontoffice','dashboard',['admin','owner','front_office_manager','front_desk','housekeeping']],['Room Planner','/frontoffice/room-planner','room-planner',['admin','owner','front_office_manager','front_desk','housekeeping']],['Reservations','/frontoffice/reservations','reservations',['admin','owner','front_office_manager','front_desk']],['Folio','/frontoffice/folio','folio',['admin','owner','front_office_manager','front_desk']],['Housekeeping','/frontoffice/housekeeping','housekeeping',['admin','owner','front_office_manager','front_desk','housekeeping']],['Night Audit','/frontoffice/night-audit','night-audit',['admin','owner','front_office_manager']]];
export const ROLE_ALIASES = { hotel_admin:'admin', super_admin:'owner', general_manager:'owner', receptionist:'front_desk', housekeeping_supervisor:'housekeeping', housekeeper:'housekeeping', waiter:'pos_staff', cashier:'pos_staff', fb_manager:'pos_staff' };
const PACKAGE_MODULES = { none: [], standard:['frontoffice','pos'], premium:['frontoffice','pos','backoffice','stores'], professional:['frontoffice','pos','backoffice','stores'] };
export function normalizeAppPath(pathname){ let path=String(pathname||'/').split('?')[0].split('#')[0]; if(!path.startsWith('/'))path='/'+path; while(path.length>1&&path.endsWith('/'))path=path.slice(0,-1); return path; }
export function normalizeAppRole(role){ const v=String(role||'').toLowerCase().trim(); return ROLE_ALIASES[v]||v||'front_desk'; }
export function canAccessApp(role,appId,propertyPackage){ const app=MAIN_NAV.find(x=>x.id===appId); if(!app||!app.roles.includes(normalizeAppRole(role)))return false; if(propertyPackage&&propertyPackage!=='none')return PACKAGE_MODULES[propertyPackage]?.includes(appId)??false; return !propertyPackage; }
export function getDefaultApp(role,propertyPackage){ const r=normalizeAppRole(role); return MAIN_NAV.find(x=>x.roles.includes(r)&&(!propertyPackage||PACKAGE_MODULES[propertyPackage]?.includes(x.id)))?.id||null; }
export function getPackageModules(propertyPackage){ return PACKAGE_MODULES[propertyPackage]||[]; }


/**
 * Resolve the subscription entitlement key for a module or embedded workspace.
 * Subscription rows store workspace-level keys (frontoffice, pos, backoffice, store),
 * not every individual screen id such as "rooms" or "reservations".
 */
export function getSubscriptionEntitlement(module, workspaceModule = null) {
  const active = String(module || '').toLowerCase().trim();
  const workspace = String(workspaceModule || '').toLowerCase().trim();

  // The dashboard is a landing page; PaywallGuard has a specific approved-package
  // exception for it, so do not accidentally turn it into a workspace entitlement.
  if (active === 'dashboard') return 'dashboard';

  const workspaceAliases = { stores: 'store', store: 'store' };
  if (workspace) return workspaceAliases[workspace] || workspace;

  if (['rooms', 'room-planner', 'room_planner', 'reservations', 'guests', 'folio', 'housekeeping', 'night-audit', 'night_audit', 'maintenance', 'laundry'].includes(active)) return 'frontoffice';
  if (['pos', 'cashier'].includes(active)) return 'pos';
  if (['store', 'stores', 'inventory', 'purchasing', 'recipes', 'transfers', 'channels', 'kitchen', 'kds', 'printers', 'pos-devices', 'pos_devices'].includes(active)) return 'store';
  if (['backoffice', 'back_office', 'reports', 'booking-engine', 'booking_engine', 'settings', 'employees', 'customers'].includes(active)) return 'backoffice';
  return active || 'backoffice';
}
