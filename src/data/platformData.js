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

// --- Dashboard / Reports sample figures --------------------------------
export const DASHBOARD_STATS = {
	revenueToday: 284650,
	openTables: 7,
	openChecks: 5,
	coversSeated: 42,
	reservationsTonight: 6,
	avgCheck: 3850,
	topItems: [
		{ name: 'Tusker Lager', qty: 34, revenue: 15300 },
		{ name: 'Margherita', qty: 21, revenue: 23100 },
		{ name: 'Filetto di Manzo', qty: 12, revenue: 33600 },
		{ name: 'Branzino alla Griglia', qty: 9, revenue: 21600 },
		{ name: 'Tiramisù', qty: 15, revenue: 12750 },
	],
	paymentBreakdown: [
		{ method: 'Cash', amount: 92300 },
		{ method: 'Card', amount: 118500 },
		{ method: 'M-Pesa', amount: 63850 },
		{ method: 'Charge to Room', amount: 10000 },
	],
	recentActivity: [
		{ type: 'order', action: 'New order fired', detail: 'Table R5 · Bruschetta, Tusker x2', time: '2m ago' },
		{ type: 'payment', action: 'Bill settled', detail: 'Table T12 · KES 6,400 · Card', time: '9m ago' },
		{ type: 'reserve', action: 'Reservation confirmed', detail: 'Emma Williams · Room 202 · 2 nights', time: '18m ago' },
		{ type: 'order', action: 'Order marked ready', detail: 'Kitchen · Order #4821', time: '24m ago' },
		{ type: 'payment', action: 'Charged to room', detail: 'Room 105 · KES 2,150', time: '31m ago' },
	],
};

// --- Kitchen display queue ---------------------------------------------
export const KITCHEN_ORDERS = [
	{
		id: 'ko1', orderRef: '#4821', area: 'Restaurant Room', table: 'R5', waiter: 'Grace Wanjiru',
		sentAt: '19:42', status: 'new',
		items: [
			{ qty: 2, name: 'Bruschetta al Pomodoro', status: 'new', center: 'Kitchen' },
			{ qty: 1, name: 'Filetto di Manzo', status: 'new', center: 'Kitchen' },
		],
	},
	{
		id: 'ko2', orderRef: '#4819', area: 'Bar', table: 'T3', waiter: 'David Lumumba',
		sentAt: '19:31', status: 'preparing',
		items: [
			{ qty: 4, name: 'Tusker Lager', status: 'preparing', center: 'Bar' },
			{ qty: 1, name: 'Cocktail del Tramonto', status: 'preparing', center: 'Bar' },
		],
	},
	{
		id: 'ko3', orderRef: '#4816', area: 'Pool', table: 'T25', waiter: 'Amina Kariuki',
		sentAt: '19:20', status: 'ready',
		items: [
			{ qty: 2, name: 'Calamari Fritti', status: 'ready', center: 'Kitchen' },
			{ qty: 2, name: 'Insalata Mista', status: 'ready', center: 'Kitchen' },
		],
	},
	{
		id: 'ko4', orderRef: '#4810', area: 'Restaurant Room', table: 'R12', waiter: 'John Mwangi',
		sentAt: '18:55', status: 'served',
		items: [
			{ qty: 3, name: 'Margherita', status: 'served', center: 'Kitchen' },
			{ qty: 2, name: 'Tiramisù', status: 'served', center: 'Dessert' },
		],
	},
];

// --- Guest directory -----------------------------------------------------
export const MOCK_GUESTS = [
	{ id: 'g1', name: 'James Odhiambo', email: 'james.odhiambo@example.com', country: 'Kenya', visits: 6, lastVisit: '2026-08-28', totalSpend: 148500 },
	{ id: 'g2', name: 'Sarah Kamau', email: 'sarah.kamau@example.com', country: 'Kenya', visits: 2, lastVisit: '2026-08-30', totalSpend: 41200 },
	{ id: 'g3', name: 'Chen Wei', email: 'chen.wei@example.com', country: 'China', visits: 1, lastVisit: '2026-08-29', totalSpend: 44000 },
	{ id: 'g4', name: 'Emma Williams', email: 'emma.williams@example.com', country: 'United Kingdom', visits: 3, lastVisit: '2026-08-31', totalSpend: 76500 },
	{ id: 'g5', name: 'Priya Sharma', email: 'priya.sharma@example.com', country: 'India', visits: 4, lastVisit: '2026-08-27', totalSpend: 92300 },
	{ id: 'g6', name: "Liam O'Connor", email: 'liam.oconnor@example.com', country: 'Ireland', visits: 1, lastVisit: '2026-08-29', totalSpend: 19000 },
];
