export const SYSTEM_SETTINGS_NAV=[
{slug:'features',label:'Features'},{slug:'billing',label:'Billing & subscriptions'},{slug:'payment-types',label:'Payment types'},{slug:'loyalty',label:'Loyalty'},{slug:'taxes',label:'Taxes'},{slug:'receipt',label:'Receipt',path:'/settings/receipt'},{slug:'open-tickets',label:'Open tickets'},{slug:'kitchen-printers',label:'Kitchen printers',path:'/settings/kitchen-printers'},{slug:'dining-options',label:'Dining options'}
];
export const navPath=item=>item.path||`/settings/system/${item.slug}`;
export function isSystemSettingsPath(pathname=''){return pathname==='/settings/kitchen-printers'||pathname==='/settings/system'||pathname.startsWith('/settings/system/');}
export function slugFromPath(pathname=''){if(pathname==='/settings/kitchen-printers')return'kitchen-printers';const m=pathname.match(/^\/settings\/system\/([^/]+)/);return m?m[1]:'';}
