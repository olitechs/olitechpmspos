import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

// Client-side UX gate. Server-side Supabase RLS remains the authoritative
// security boundary for platform operations.
export default function AdminRoute() {
  const { user, isLoadingAuth, authChecked } = useAuth();
  const location = useLocation();

  if (isLoadingAuth || !authChecked) {
    return <div className="fixed inset-0 flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;
  }

  if (!user) return <Navigate to="/admin/login" replace />;

  const propertyAdmin = ['owner', 'admin', 'manager'].includes(String(user?.propertyRole || '').toLowerCase());
  const staffAdmin = ['hotel_admin', 'super_admin'].includes(String(user?.staff?.role || '').toLowerCase());

  // Platform administrators and hotel/property administrators are separate
  // security domains. Platform owners must never enter property staff/settings
  // screens, even by typing the URL directly.
  const propertyOnlyPaths = [
    '/admin/roles',
    '/admin/settings',
    '/admin/settings/printers',
    '/admin/settings/receipt',
    '/admin/settings/unsettled-receipt',
  ];
  const isPropertyOnlyPath = propertyOnlyPaths.some((path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`)
  );

  if (user.isPlatformOwner && isPropertyOnlyPath) {
    return <Navigate to="/admin" replace />;
  }

  if (!user.isPlatformOwner && !propertyAdmin && !staffAdmin) {
    return <Navigate to="/backoffice" replace />;
  }

  return <Outlet />;
}
