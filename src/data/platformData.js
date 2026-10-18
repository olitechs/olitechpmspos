// Platform-level mock data (navigation, current staff session, dashboard
// figures, kitchen queue, guest directory).
//
// NOTE: this file shipped empty in the exported project even though ~7
// components import from it. The structures below were reconstructed from
// how each consumer uses the data (see Sidebar, TopBar, Dashboard, Reports,
// KitchenDisplay, GuestList) and are illustrative sample data, not your
// original hotel's real figures — replace with a live data source
// (services/*) when a backend is connected.

// --- Navigation -------------------------------------------------------
// `icon` keys must match the ICON_MAP in components/shell/Sidebar.jsx.
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

// --- Current staff session (front-of-house display, not the login account) ---
export const CURRENT_USER = {
	name: 'Amina Kariuki',
	role: 'General Manager',
	avatar: 'AK',
};

export const BUSINESSES = [
	{ id: 'b1', name: 'OliTechs Grand Hotel' },
];

export const BRANCHES = {
	b1: [
		{ id: 'br1', name: 'Nairobi Main' },
	],
};

// Transactional dashboard/report figures, kitchen queues and guest records are intentionally not stored here.
// They must come from Supabase-backed services for the active property.
