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
