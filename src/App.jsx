import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Route, Routes, Navigate, Outlet } from 'react-router-dom';
import PageNotFound from '@/lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import AdminRoute from '@/lib/AdminRoute';
import UserNotRegisteredError from '@/components/ui/UserNotRegisteredError';
import ScrollToTop from '@/components/ui/ScrollToTop';
import POSApp from '@/pages/POSApp';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import PendingApproval from '@/pages/PendingApproval';
import AdminLogin from '@/pages/admin/AdminLogin';
import AdminLayout from '@/pages/admin/AdminLayout';
import AdminDashboard from '@/pages/admin/AdminDashboard';
import AdminProperties from '@/pages/admin/AdminProperties';
import AdminCreateProperty from '@/pages/admin/AdminCreateProperty';
import AdminEditProperty from '@/pages/admin/AdminEditProperty';
import AdminPropertyDetail from '@/pages/admin/AdminPropertyDetail';
import AdminAuditLog from '@/pages/admin/AdminAuditLog';
import Roles from '@/pages/Admin/Roles';
import SupabaseSetupNotice from '@/pages/SupabaseSetupNotice';
import PublicHome from '@/pages/PublicHome';
import PublicSignIn from '@/pages/PublicSignIn';
import PublicSignUp from '@/pages/PublicSignUp';
import { isSupabaseConfigured } from '@/lib/supabaseClient';
import { hasActivePropertyAccess } from '@/lib/authorization';

function AdminHome(){ const { user } = useAuth(); return user?.isPlatformOwner ? <AdminDashboard/> : <Roles/>; }

function AuthLoading(){
  return <div className="fixed inset-0 flex items-center justify-center bg-[#F5F3EF]"><div className="w-8 h-8 border-4 border-[#D6D6D6] border-t-[#FFD300] rounded-full animate-spin"/></div>;
}

function PublicRoute(){
  const {user,isLoadingAuth,isLoadingPublicSettings}=useAuth();
  if(isLoadingAuth||isLoadingPublicSettings) return <AuthLoading/>;
  if(user) return <Navigate to={user.isPlatformOwner?'/admin':'/backoffice'} replace/>;
  return <Outlet/>;
}

function ProtectedApp({initialModule='dashboard'}){
  const {user,isLoadingAuth,isLoadingPublicSettings}=useAuth();
  if(isLoadingAuth||isLoadingPublicSettings) return <AuthLoading/>;
  if(!user) return <Navigate to="/signin" replace/>;
  if(user?.isPlatformOwner) return <Navigate to="/admin" replace/>;
  if(!hasActivePropertyAccess(user)) return <PendingApproval/>;
  return <POSApp initialModule={initialModule}/>;
}

function AppRoutes(){
  return <AuthProvider><Routes>
    <Route element={<PublicRoute/>}>
      <Route path="/" element={<PublicHome/>}/>
      <Route path="/home" element={<PublicHome/>}/>
      <Route path="/signin" element={<PublicSignIn/>}/>
      <Route path="/signup" element={<PublicSignUp/>}/>
      <Route path="/login" element={<Login/>}/>
      <Route path="/register" element={<Register/>}/>
    </Route>
    <Route path="/forgot-password" element={<ForgotPassword/>}/>
    <Route path="/reset-password" element={<ResetPassword/>}/>
    <Route path="/dashboard" element={<Navigate to="/backoffice" replace/>}/>
    <Route path="/backoffice" element={<ProtectedApp initialModule="dashboard"/>}/>
    <Route path="/pos" element={<ProtectedApp initialModule="pos"/>}/>
    <Route path="/store" element={<ProtectedApp initialModule="store"/>}/>
    <Route path="/rooms" element={<ProtectedApp initialModule="rooms"/>}/>
    <Route path="/admin/login" element={<AdminLogin/>}/>
    <Route element={<AdminRoute/>}><Route element={<AdminLayout/>}>
      <Route path="/admin" element={<AdminHome/>}/>
      <Route path="/admin/properties" element={<AdminProperties/>}/>
      <Route path="/admin/properties/new" element={<AdminCreateProperty/>}/>
      <Route path="/admin/properties/:id" element={<AdminPropertyDetail/>}/>
      <Route path="/admin/properties/:id/edit" element={<AdminEditProperty/>}/>
      <Route path="/admin/audit-log" element={<AdminAuditLog/>}/>
      <Route path="/admin/roles" element={<Roles/>}/>
    </Route></Route>
    <Route path="*" element={<PageNotFound/>}/>
  </Routes></AuthProvider>;
}

function App(){
  if(!isSupabaseConfigured) return <SupabaseSetupNotice/>;
  return <QueryClientProvider client={queryClientInstance}><Router><ScrollToTop/><AppRoutes/></Router><Toaster/></QueryClientProvider>;
}
export default App;
