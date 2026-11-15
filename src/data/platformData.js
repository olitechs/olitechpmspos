// Application module navigation.
//
// `icon` keys must match the ICON_MAP in `components/shell/Sidebar.jsx`.
// Dashboard figures, kitchen queues, guests and staff records are not stored
// here; they come from the Supabase-backed services for the active property.
export const MODULES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'pos', label: 'Point of Sale', icon: 'UtensilsCrossed' },
  { id: 'store', label: 'Store / Controls', icon: 'Package' },
  { id: 'reservations', label: 'Reservations', icon: 'CalendarCheck' },
  { id: 'rooms', label: 'Rooms & Room Types', icon: 'BedDouble' },
  { id: 'guests', label: 'Guests', icon: 'Users' },
  { id: 'receipts', label: 'Receipts', icon: 'Receipt' },
  { id: 'cashier', label: 'Cashier Control', icon: 'Banknote' },
  { id: 'kitchen', label: 'Kitchen Display', icon: 'ChefHat' },
  { id: 'housekeeping', label: 'Housekeeping', icon: 'Sparkles' },
  { id: 'maintenance', label: 'Maintenance', icon: 'Wrench' },
  { id: 'inventory', label: 'Inventory', icon: 'PackageSearch' },
  { id: 'reports', label: 'Reports', icon: 'BarChart3' },
  { id: 'settings', label: 'Settings', icon: 'Settings' },
];
