import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

// Client-side gate for /admin/*. This is a UX convenience only — it stops
// a normal user from seeing the admin shell flash on screen. The REAL
// protection is server-side: every admin data call goes through Supabase
// with RLS policies that check `is_platform_owner()` (see
// supabase/migrations/0001_platform_admin.sql), so even if someone bypassed
// this component entirely, every read/write would still be rejected by
// Postgres.
export default function AdminRoute() {
	const { user, isLoadingAuth, authChecked } = useAuth();

	if (isLoadingAuth || !authChecked) {
		return (
			<div className="fixed inset-0 flex items-center justify-center">
				<div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
			</div>
		);
	}

	if (!user) {
		return <Navigate to="/admin/login" replace />;
	}

	const propertyAdmin = ['owner','admin','manager'].includes(String(user?.propertyRole || '').toLowerCase());
	const staffAdmin = ['hotel_admin','super_admin'].includes(String(user?.staff?.role || '').toLowerCase());
	if (!user.isPlatformOwner && !propertyAdmin && !staffAdmin) {
		return <Navigate to="/backoffice" replace />;
	}

	return <Outlet />;
}
