import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { canAccessPlatformAdmin } from '@/lib/authorization';

// Client-side UX gate for /admin/*. The database remains authoritative:
// platform RPCs and RLS policies independently require is_platform_owner().
// Hotel administrators/staff are deliberately kept inside the hotel workspace.
export default function AdminRoute() {
  const { user, isLoadingAuth, authChecked } = useAuth();

  if (isLoadingAuth || !authChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  if (!canAccessPlatformAdmin(user)) {
    return <Navigate to="/backoffice" replace />;
  }

  return <Outlet />;
}
