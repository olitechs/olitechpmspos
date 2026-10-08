import InventoryOperations from '@/components/modules/InventoryOperations';
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { BrowserRouter as Router, Route, Routes, Navigate, Outlet, useParams } from "react-router-dom";
import PageNotFound from "@/lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import AdminRoute from "@/lib/AdminRoute";
import ScrollToTop from "@/components/ui/ScrollToTop";
import POSApp from "@/pages/POSApp";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import PendingApproval from "@/pages/PendingApproval";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminProperties from "@/pages/admin/AdminProperties";
import AdminCreateProperty from "@/pages/admin/AdminCreateProperty";
import AdminEditProperty from "@/pages/admin/AdminEditProperty";
import AdminPropertyDetail from "@/pages/admin/AdminPropertyDetail";
import AdminAuditLog from "@/pages/admin/AdminAuditLog";
import Roles from "@/pages/admin/Roles";
import PropertyAdminSettings from "@/pages/admin/PropertyAdminSettings";
import UnsettledReceiptSettings from "@/pages/admin/UnsettledReceiptSettings";
import StaffAdmin from "@/components/admin/StaffAdmin";
import SettingsPrinters from "@/pages/SettingsPrinters";
import ReceiptSettings from "@/components/settings/ReceiptSettings";
import SubscriptionPanel from "@/components/admin/SubscriptionPanel";
import KitchenDisplay from "@/components/modules/KitchenDisplay";
import SupabaseSetupNotice from "@/pages/SupabaseSetupNotice";
import PublicHome from "@/pages/PublicHome";
import PublicSignIn from "@/pages/PublicSignIn";
import PublicSignUp from "@/pages/PublicSignUp";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { canAccessApp, getDefaultApp, normalizeAppRole } from "@/data/modules/navArchitecture";
import { getSessionStaff, normalizeStaffRole } from "@/services/authService";
import BackOfficeLayout from "@/components/layout/BackOfficeLayout";
import FrontOfficeLayout from "@/components/layout/FrontOfficeLayout";
import StoresLayout from "@/components/layout/StoresLayout";
import KitchenPrintersPage from "@/components/settings/KitchenPrintersPage";
import Phase2CataloguePage from "@/components/settings/Phase2CataloguePage";
import GuestList from "@/components/modules/GuestList";
import Reports from "@/components/modules/Reports";
import Store from "@/pages/Store";
import BookingEngine from "@/components/modules/BookingEngine";
import Transfers from "@/components/modules/Transfers";
import Recipes from "@/components/modules/Recipes";
import StoresPage from "@/components/stores/StoresPage";
import ModuleStatusPage from "@/components/shared/ModuleStatusPage";

function AuthLoading(){return <div className="fixed inset-0 flex items-center justify-center bg-[#F5F3EF]"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#D6D6D6] border-t-[#FFD300]"/></div>;}
function appRole(user){const s=getSessionStaff();const raw=s?.role||user?.staff?.role||user?.propertyRole||user?.role;return normalizeAppRole(normalizeStaffRole(raw));}
function PublicRoute(){const {user,isLoadingAuth,isLoadingPublicSettings}=useAuth();if(isLoadingAuth||isLoadingPublicSettings)return <AuthLoading/>;if(user)return <Navigate to={'/'+getDefaultApp(appRole(user), user?.property?.package)} replace/>;return <Outlet/>;}
function ProtectedRoute({app,children}){const {user,isLoadingAuth,isLoadingPublicSettings}=useAuth();if(isLoadingAuth||isLoadingPublicSettings)return <AuthLoading/>;if(!user)return <Navigate to="/signin" replace/>;if(user?.isPlatformOwner)return <Navigate to="/admin" replace/>;if(!canAccessApp(appRole(user),app,user?.property?.package))return <Navigate to={'/'+getDefaultApp(appRole(user),user?.property?.package)} replace/>;const property=user?.property;const full=property?.status==='active'&&property?.package&&property.package!=='none';if(!full)return <PendingApproval/>;return children||<Outlet/>;}
function LegacyPOS(){return <ProtectedRoute app="pos"><POSApp initialModule="pos" workspaceModule="pos"/></ProtectedRoute>;}
function BackOfficeStorePage({tab="overview"}){return <Store initialTab={tab}/>;}
function BackOfficeReportPage({kind}){if(kind==="sales")return <Reports/>;if(kind==="inventory")return <BackOfficeStorePage tab="alerts"/>;return <StaffAdmin/>;}
function BackOfficeSettingsPage(){
  const { slug = '' } = useParams();
  if(slug==='receipt') return <ReceiptSettings/>;
  if(slug==='billing') return <SubscriptionPanel/>;
  if(slug==='kitchen-printers') return <KitchenPrintersPage/>;
  if(['modifiers','discounts','suppliers'].includes(slug)) return <Phase2CataloguePage section={slug}/>;
  return <ModuleStatusPage module={slug || 'features'} back='/backoffice/settings/features'/>;
}
function AppRoutes(){return <AuthProvider><Routes>
<Route element={<PublicRoute/>}><Route path="/" element={<PublicHome/>}/><Route path="/home" element={<PublicHome/>}/><Route path="/signin" element={<PublicSignIn/>}/><Route path="/signup" element={<PublicSignUp/>}/><Route path="/login" element={<Login/>}/><Route path="/register" element={<Register/>}/></Route>
<Route path="/forgot-password" element={<ForgotPassword/>}/><Route path="/reset-password" element={<ResetPassword/>}/>
<Route element={<ProtectedRoute app="backoffice"/>}><Route path="/backoffice" element={<BackOfficeLayout/>}><Route index element={<POSApp initialModule="dashboard" embedded workspaceModule="backoffice"/>}/><Route path="items/list" element={<BackOfficeStorePage tab="products"/>}/><Route path="items/categories" element={<BackOfficeStorePage tab="products"/>}/><Route path="items/modifiers" element={<Phase2CataloguePage section="modifiers"/>}/><Route path="items/discounts" element={<Phase2CataloguePage section="discounts"/>}/><Route path="reports/sales" element={<BackOfficeReportPage kind="sales"/>}/><Route path="reports/inventory" element={<BackOfficeReportPage kind="inventory"/>}/><Route path="reports/employees" element={<BackOfficeReportPage kind="employees"/>}/><Route path="inventory/purchase-orders" element={<BackOfficeStorePage tab="purchases"/>}/><Route path="inventory/transfer-orders" element={<POSApp initialModule="transfers" embedded workspaceModule="backoffice"/>}/><Route path="inventory/stock-adjustments" element={<InventoryOperations/>}/><Route path="inventory/counts" element={<InventoryOperations/>}/><Route path="inventory/productions" element={<InventoryOperations/>}/><Route path="inventory/suppliers" element={<Phase2CataloguePage section="suppliers"/>}/><Route path="inventory/history" element={<InventoryOperations/>}/><Route path="inventory/valuation" element={<InventoryOperations/>}/><Route path="employees/list" element={<StaffAdmin/>}/><Route path="employees/access-rights" element={<Roles/>}/><Route path="employees/timecards" element={<StaffAdmin/>}/><Route path="employees/hours" element={<StaffAdmin/>}/><Route path="customers" element={<GuestList/>}/><Route path="integrations" element={<BookingEngine/>}/><Route path="settings/:slug" element={<BackOfficeSettingsPage/>}/><Route path="help" element={<ModuleStatusPage title="Help & Support" description="Operational help, troubleshooting and support documentation will be added as the application workflows are completed." phase="Phase 10" back="/backoffice"/>}/></Route></Route>
<Route element={<ProtectedRoute app="frontoffice"/>}><Route path="/frontoffice" element={<FrontOfficeLayout/>}><Route index element={<POSApp initialModule="dashboard" workspaceModule="frontoffice"/>}/><Route path="room-planner" element={<POSApp initialModule="rooms" embedded workspaceModule="frontoffice"/>}/><Route path="rooms" element={<POSApp initialModule="rooms" embedded workspaceModule="frontoffice"/>}/><Route path="reservations" element={<POSApp initialModule="reservations" embedded workspaceModule="frontoffice"/>}/><Route path="folio" element={<POSApp initialModule="folio" embedded workspaceModule="frontoffice"/>}/><Route path="housekeeping" element={<POSApp initialModule="housekeeping" embedded workspaceModule="frontoffice"/>}/><Route path="night-audit" element={<POSApp initialModule="night-audit" embedded workspaceModule="frontoffice"/>}/></Route></Route>
<Route element={<ProtectedRoute app="stores"/>}><Route path="/stores" element={<StoresLayout/>}><Route index element={<StoresPage/>}/><Route path="settings" element={<StoresPage/>}/><Route path="pos-devices" element={<ModuleStatusPage title="POS Devices" description="POS device registration and terminal management will be delivered with the cashier and device-control phase." phase="Phase 6" back="/stores"/>}/><Route path="printers" element={<KitchenPrintersPage/>}/><Route path="kds" element={<KitchenDisplay/>}/></Route></Route>
<Route path="/dashboard" element={<Navigate to="/backoffice" replace/>}/><Route path="/pos" element={<LegacyPOS/>}/><Route path="/pms" element={<Navigate to="/frontoffice" replace/>}/><Route path="/store" element={<Navigate to="/stores" replace/>}/><Route path="/rooms" element={<Navigate to="/frontoffice/rooms" replace/>}/><Route path="/settings/kitchen-printers" element={<Navigate to="/backoffice/settings/kitchen-printers" replace/>}/><Route path="/settings/system/*" element={<Navigate to="/backoffice/settings/features" replace/>}/><Route path="/404" element={<PageNotFound/>}/>
<Route path="/admin/login" element={<AdminLogin/>}/><Route element={<AdminRoute/>}><Route element={<AdminLayout/>}><Route path="/admin" element={<AdminDashboard/>}/><Route path="/admin/settings" element={<PropertyAdminSettings/>}/><Route path="/admin/properties" element={<AdminProperties/>}/><Route path="/admin/properties/new" element={<AdminCreateProperty/>}/><Route path="/admin/properties/:id" element={<AdminPropertyDetail/>}/><Route path="/admin/properties/:id/edit" element={<AdminEditProperty/>}/><Route path="/admin/audit-log" element={<AdminAuditLog/>}/><Route path="/admin/roles" element={<Roles/>}/><Route path="/admin/settings/printers" element={<SettingsPrinters/>}/><Route path="/admin/settings/receipt" element={<ReceiptSettings/>}/><Route path="/admin/settings/unsettled-receipt" element={<UnsettledReceiptSettings/>}/></Route></Route>
<Route path="*" element={<PageNotFound/>}/></Routes></AuthProvider>;}
function App(){if(!isSupabaseConfigured)return <SupabaseSetupNotice/>;return <QueryClientProvider client={queryClientInstance}><Router><ScrollToTop/><Toaster/><AppRoutes/></Router></QueryClientProvider>;}
export default App;