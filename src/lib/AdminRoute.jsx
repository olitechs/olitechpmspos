import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import AppLoadingSkeleton from '@/components/ui/AppLoadingSkeleton';

// Client-side route separation is defense in depth. Supabase RLS and guarded
// database functions remain the authoritative authorization boundary.
export default function AdminRoute() {
  const { user, isLoadingAuth, authChecked } = useAuth();
  const location = useLocation();

  if (isLoadingAuth || !authChecked) {
    return <AppLoadingSkeleton variant="admin" label="Preparing administration workspace" className="border-[var(--border)]" />;
  }

  if (!user) return <Navigate to="/admin/login" replace />;

  const isPlatformOwner = user?.isPlatformOwner === true;
  const propertyAdmin = ['owner', 'admin', 'manager'].includes(String(user?.propertyRole || '').toLowerCase());
  const staffAdmin = ['hotel_admin', 'super_admin', 'fb_manager'].includes(String(user?.staff?.role || '').toLowerCase());

  const platformOnlyPaths = ['/admin/properties', '/admin/audit-log', '/admin/usage', '/admin/users', '/admin/recovery'];
  const isPlatformOnlyPath = platformOnlyPaths.some((path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`)
  );

  const propertyOnlyPaths = ['/admin/roles', '/admin/settings'];
  const isPropertyOnlyPath = propertyOnlyPaths.some((path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`)
  );

  // Never expose platform-wide property/subscription/audit pages to property admins.
  if (!isPlatformOwner && (isPlatformOnlyPath || location.pathname === '/admin')) {
    return <Navigate to="/backoffice" replace />;
  }

  // Platform owners use platform operations, not tenant staff/settings screens.
  if (isPlatformOwner && isPropertyOnlyPath) {
    return <Navigate to="/admin" replace />;
  }

  if (!isPlatformOwner && !propertyAdmin && !staffAdmin) {
    return <Navigate to="/backoffice" replace />;
  }

  return <Outlet />;
}
