import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Building2, ScrollText, ShieldCheck, LogOut, UsersRound, Plus } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const NAV = [
	{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
	{ to: '/admin/properties', label: 'Properties', icon: Building2 },
	{ to: '/admin/audit-log', label: 'Audit Log', icon: ScrollText },
	{ to: '/admin/roles', label: 'Staff & Roles', icon: UsersRound },
];

export default function AdminLayout() {
	const { user, logout } = useAuth();
	const propertyAdmin = !user?.isPlatformOwner;
	const navItems = propertyAdmin ? NAV.filter((item) => item.to === '/admin/roles') : NAV;

	return (
		<div className="min-h-screen flex bg-background">
			<aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col">
				<div className="h-16 flex items-center gap-2 px-5 border-b border-border">
					<ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
					<span className="font-bold text-foreground">OliTechs Admin</span>
				</div>
				<nav className="flex-1 p-3 space-y-1">
					{navItems.map(({ to, label, icon: Icon, end }) => (
						<NavLink
							key={to}
							to={to}
							end={end}
							className={({ isActive }) =>
								`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
									isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
								}`
							}
						>
							<Icon className="w-4 h-4" aria-hidden="true" />
							{label}
						</NavLink>
					))}
				</nav>
				<div className="p-3 border-t border-border">
					<div className="px-3 py-2 text-xs text-muted-foreground truncate">{user?.email}</div>
					<button
						onClick={logout}
						className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
					>
						<LogOut className="w-4 h-4" aria-hidden="true" />
						Sign out
					</button>
				</div>
			</aside>
			<main className="flex-1 overflow-y-auto">
				<div className="max-w-6xl mx-auto p-8">
					<Outlet />
				</div>
			</main>
		</div>
	);
}
