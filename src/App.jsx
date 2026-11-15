import { Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import Purchasing from '@/components/modules/Purchasing';
import InventoryReports from '@/components/modules/InventoryReports';
import InventoryOperations from '@/components/modules/InventoryOperations';
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { BrowserRouter as Router, Route, Routes, Navigate, Outlet, useParams, useLocation } from "react-router-dom";
import PageNotFound from "@/lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import AdminRoute from "@/lib/AdminRoute";
import ScrollToTop from "@/components/ui/ScrollToTop";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import PendingApproval from "@/pages/PendingApproval";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminUsage from "@/pages/admin/AdminUsage";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminRecovery from "@/pages/admin/AdminRecovery";
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
import TermsPage from "@/pages/TermsPage";
import PrivacyPage from "@/pages/PrivacyPage";import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { canAccessApp, getDefaultApp, normalizeAppRole } from "@/data/modules/navArchitecture";
import { getSessionStaff, normalizeStaffRole } from "@/services/authService";
import BackOfficeLayout from "@/components/layout/BackOfficeLayout";
import FrontOfficeLayout from "@/components/layout/FrontOfficeLayout";
import StoresLayout from "@/components/layout/StoresLayout";
import POSLayout from "@/components/layout/POSLayout";
import POSPinSettingsPage from "@/pages/POSPinSettingsPage";
import KitchenPrintersPage from "@/components/settings/KitchenPrintersPage";
import Phase2CataloguePage from "@/components/settings/Phase2CataloguePage";
import GuestList from "@/components/modules/GuestList";
import BookingEngine from "@/components/modules/BookingEngine";
import Transfers from "@/components/modules/Transfers";
import Recipes from "@/components/modules/Recipes";
import POSDevicesPage from '@/components/stores/POSDevicesPage';
import ModuleStatusPage from "@/components/shared/ModuleStatusPage";
import StorekeeperDashboard from '@/pages/StorekeeperDashboard';
import OperationalSettingsPage from "@/components/settings/OperationalSettingsPage";
import CategoriesPage from "@/components/settings/CategoriesPage";
import TimecardsPage from "@/components/settings/TimecardsPage";
import EmployeeListPage from "@/components/settings/EmployeeListPage";
import HelpCentre from "@/pages/HelpCentre";
import FrontOfficeDashboard from "@/pages/FrontOfficeDashboard";
import FrontOfficeStructure from "@/pages/FrontOfficeStructure";
import ShiftReport from '@/pages/ShiftReport';

const POSApp = lazyWithRetry(() => import('@/pages/POSApp'), 'app-pos-app');
const Reports = lazyWithRetry(() => import('@/components/modules/Reports'), 'app-reports');
const Store = lazyWithRetry(() => import('@/pages/Store'), 'app-store');
const FrontOfficeAssistance = lazyWithRetry(() => import('@/pages/FrontOfficeAssistance'), 'route-pages-frontoffice-assistance');
const FrontOfficeConfiguration = lazyWithRetry(() => import('@/pages/FrontOfficeConfiguration'), 'route-pages-frontoffice-configuration');
const FrontOfficeGuestRequests = lazyWithRetry(() => import('@/pages/FrontOfficeGuestRequests'), 'route-pages-frontoffice-guest-requests');
const FrontOfficeLaundry = lazyWithRetry(() => import('@/pages/FrontOfficeLaundry'), 'route-pages-frontoffice-laundry');
const FrontOfficeMaintenance = lazyWithRetry(() => import('@/pages/FrontOfficeMaintenance'), 'route-pages-frontoffice-maintenance');
const FrontOfficeMinibar = lazyWithRetry(() => import('@/pages/FrontOfficeMinibar'), 'route-pages-frontoffice-minibar');
const FrontOfficeStatistics = lazyWithRetry(() => import('@/pages/FrontOfficeStatistics'), 'route-pages-frontoffice-statistics');
const FrontOfficeTags = lazyWithRetry(() => import('@/pages/FrontOfficeTags'), 'route-pages-frontoffice-tags');
const StoresPage = lazyWithRetry(() => import('@/components/stores/StoresPage'), 'app-stores-page');

function PageSkeleton({ variant }) {
  const block = 'animate-pulse motion-reduce:animate-none rounded-md bg-[var(--border)]/70';
  const panel = 'rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4';
  const line = (w='w-full', h='h-3') => <div className={block+' '+w+' '+h}/>;
  const toolbar = <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-1 flex-wrap gap-2">{line('w-56 max-w-full','h-9')}{line('w-28','h-9')}</div>{line('w-32','h-9')}</div>;
  const table = <div className={panel}><div className="mb-4 grid grid-cols-4 gap-3 border-b border-[var(--border)] pb-3">{Array.from({length:4},(_,i)=><div key={i}>{line('w-3/4','h-3')}</div>)}</div><div className="space-y-4">{Array.from({length:7},(_,i)=><div key={i} className="grid grid-cols-4 items-center gap-3">{line('w-4/5')}{line('w-3/4')}{line('w-2/3')}{line('w-1/2')}</div>)}</div></div>;
  const metrics = <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({length:4},(_,i)=><div key={i} className={panel}>{line('w-20')}{line('mt-4 w-16','h-7')}</div>)}</div>;
  let content;
  switch (variant) {
    case 'calendar':
      content = <><div className="mb-4 flex flex-wrap justify-between gap-3">{line('w-44','h-9')}<div className="flex gap-2">{line('w-24','h-9')}{line('w-24','h-9')}{line('w-28','h-9')}</div></div><div className={panel}><div className="mb-3 grid grid-cols-7 gap-2">{Array.from({length:7},(_,i)=><div key={i}>{line('w-full','h-4')}</div>)}</div><div className="grid grid-cols-7 gap-2">{Array.from({length:35},(_,i)=><div key={i} className="min-h-20 rounded-lg border border-[var(--border)] p-2">{line('w-5')}{i%4===0&&line('mt-3 w-full','h-5')}</div>)}</div></div></>;
      break;
    case 'pos':
      content = <div className="grid min-h-[65vh] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><div><div className="mb-4 flex gap-2">{Array.from({length:5},(_,i)=><div key={i} className={block+' h-9 w-24 rounded-full'}/>)}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({length:8},(_,i)=><div key={i} className={panel}><div className={block+' mb-3 aspect-[4/3] rounded-lg'}/>{line('w-4/5')}{line('mt-2 w-1/3')}</div>)}</div></div><div className={panel}><div className="mb-5 flex justify-between">{line('w-28','h-5')}{line('w-8','h-8')}</div>{Array.from({length:4},(_,i)=><div key={i} className="mb-4 flex gap-3">{line('h-12 w-12') }<div className="flex-1 space-y-2">{line('w-3/4')}{line('w-1/3')}</div></div>)}<div className="mt-8 border-t border-[var(--border)] pt-4">{line('w-full','h-10')}</div></div></div>;
      break;
    case 'folio':
      content = <><div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({length:4},(_,i)=><div key={i} className={panel}>{line('w-20')}{line('mt-3 w-24','h-6')}</div>)}</div><div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]"><div className={panel}>{line('w-40','h-5')}<div className="mt-5">{table}</div></div><div className={panel}>{line('w-32','h-5')}{Array.from({length:5},(_,i)=><div key={i} className="mt-5 flex justify-between">{line('w-1/2')}{line('w-16')}</div>)}{line('mt-8 w-full','h-10')}</div></div></>;
      break;
    case 'settings':
      content = <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]"><div className={panel}><div className="space-y-4">{Array.from({length:7},(_,i)=><div key={i} className="flex gap-3">{line('h-8 w-8')}{line('w-3/4','h-4')}</div>)}</div></div><div className={panel}>{line('w-48','h-6')}{line('mt-3 w-3/4')}{Array.from({length:5},(_,i)=><div key={i} className="mt-6 flex items-center justify-between border-b border-[var(--border)] pb-4">{line('w-1/3')}{line('w-24','h-8')}</div>)}</div></div>;
      break;
    case 'form':
      content = <div className="grid gap-4 lg:grid-cols-2"><div className={panel}>{line('w-40','h-5')}{Array.from({length:6},(_,i)=><div key={i} className="mt-5 space-y-2">{line('w-28')}{line('w-full','h-10')}</div>)}</div><div className={panel}>{line('w-40','h-5')}{Array.from({length:4},(_,i)=><div key={i} className="mt-5 space-y-2">{line('w-28')}{line('w-full','h-10')}</div>)}</div></div>;
      break;
    case 'report':
      content = <>{metrics}<div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]"><div className={panel}>{line('w-40','h-5')}{line('mt-5 h-64 w-full')}</div><div className={panel}>{line('w-32','h-5')}{Array.from({length:5},(_,i)=><div key={i} className="mt-5">{line('w-full','h-5')}</div>)}</div></div></>;
      break;
    case 'dashboard':
      content = <>{metrics}<div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]"><div className={panel}>{line('w-40','h-5')}{line('mt-5 h-56 w-full')}{line('mt-4 w-2/3')}</div><div className={panel}>{line('w-32','h-5')}{Array.from({length:5},(_,i)=><div key={i} className="mt-5 flex gap-3">{line('h-9 w-9 rounded-full')}<div className="flex-1 space-y-2">{line('w-3/4')}{line('w-1/2')}</div></div>)}</div></div></>;
      break;
    default:
      content = <>{toolbar}{table}</>;
  }
  return <main aria-hidden="true" className="min-w-0 p-4 sm:p-6 lg:p-8"><div className="mb-6 flex items-start justify-between gap-4"><div className="min-w-0 flex-1">{line('mb-3 w-24')}{line('h-7 w-56 max-w-full')}{line('mt-3 h-3 w-72 max-w-full')}</div>{line('hidden h-9 w-32 sm:block')}</div>{content}</main>;
}
function AuthLoading(){
  const { pathname } = useLocation();
  const path = pathname.toLowerCase();
  const variant = /\/pos(?:\/|$)/.test(path) ? 'pos'
    : /folio|room-charges/.test(path) ? 'folio'
    : /room-planner|\/rooms(?:\/|$)|calendar/.test(path) ? 'calendar'
    : /settings|configuration|printers|access-rights/.test(path) ? 'settings'
    : /new|\/edit|create|registration-cards|walk-in/.test(path) ? 'form'
    : /reports|statistics|analytics|audit-log|shift/.test(path) ? 'report'
    : /dashboard|^\/$|^\/frontoffice\/?$|^\/backoffice\/?$|^\/stores\/?$|^\/admin\/?$/.test(path) ? 'dashboard'
    : 'table';
  return <main role="status" aria-live="polite" aria-label="Loading page" className="fixed inset-0 z-[9999] overflow-auto bg-[var(--canvas)] text-[var(--text)]">
    <span className="sr-only">Loading page content. Please wait.</span>
    <div className="flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-6"><div className="h-8 w-8 rounded-lg bg-[var(--brand-primary)]/15"/><div className="text-sm font-bold tracking-wide">OliTechs</div><div className="ml-auto flex gap-2"><div className="h-8 w-24 animate-pulse rounded-md bg-[var(--border)]/70 motion-reduce:animate-none"/><div className="h-8 w-8 animate-pulse rounded-full bg-[var(--border)]/70 motion-reduce:animate-none"/></div></div>
    <div className="grid min-h-[calc(100%-3.5rem)] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]"><aside aria-hidden="true" className="hidden border-r border-[var(--border)] bg-[var(--surface)] p-4 md:block"><div className="mb-7 h-3 w-24 animate-pulse rounded bg-[var(--border)]/70 motion-reduce:animate-none"/><div className="space-y-3">{Array.from({length:8},(_,i)=><div key={i} className="flex items-center gap-3 rounded-lg p-2"><div className="h-7 w-7 animate-pulse rounded-md bg-[var(--border)]/70 motion-reduce:animate-none"/><div className="h-3 flex-1 animate-pulse rounded bg-[var(--border)]/70 motion-reduce:animate-none"/></div>)}</div></aside><div className="min-w-0"><PageSkeleton variant={variant}/></div></div>
  </main>;
}
function appRole(user){const s=getSessionStaff();const raw=s?.role||user?.staff?.role||user?.propertyRole||user?.role;return normalizeAppRole(normalizeStaffRole(raw));}
function PublicRoute(){const {user,isLoadingAuth,isLoadingPublicSettings}=useAuth();if(isLoadingAuth||isLoadingPublicSettings)return <AuthLoading/>;if(user){if(user?.isPlatformOwner)return <Navigate to="/admin" replace/>;const defaultApp=getDefaultApp(appRole(user),user?.property?.package);return defaultApp?<Navigate to={'/'+defaultApp} replace/>:<PendingApproval/>;}return <Outlet/>;}
function ProtectedRoute({app,children}){const {user,isLoadingAuth,isLoadingPublicSettings}=useAuth();if(isLoadingAuth||isLoadingPublicSettings)return <AuthLoading/>;if(!user)return <Navigate to="/signin" replace/>;if(user?.isPlatformOwner)return <Navigate to="/admin" replace/>;if(!canAccessApp(appRole(user),app,user?.property?.package)){const defaultApp=getDefaultApp(appRole(user),user?.property?.package);return defaultApp?<Navigate to={'/'+defaultApp} replace/>:<PendingApproval/>;}const property=user?.property;const full=property?.status==='active'&&property?.package&&property.package!=='none';if(!full)return <PendingApproval/>;return children||<Outlet/>;}
function BackOfficeStorePage({tab="overview"}){return <Store initialTab={tab}/>;}
function BackOfficeReportPage({kind}){if(kind==="sales")return <Reports/>;if(kind==="inventory")return <InventoryReports/>;return <ModuleStatusPage title={kind==="employees"?"Employee Report":"Reports"} description="This report is not yet implemented as a dedicated reporting workflow. Open Timecards for attendance records." module={kind || "reports"} back="/backoffice"/>;}
function BackOfficeSettingsPage(){
  const { slug = '' } = useParams();
  if(slug==='receipt') return <ReceiptSettings/>;
  if(slug==='billing') return <SubscriptionPanel/>;
  if(slug==='kitchen-printers') return <KitchenPrintersPage/>;
  if(['modifiers','discounts','suppliers'].includes(slug)) return <Phase2CataloguePage section={slug}/>;
  if(['features','payment-types','taxes','loyalty','open-tickets','dining-options'].includes(slug)) return <OperationalSettingsPage module={slug}/>;
  return <ModuleStatusPage module={slug || 'features'} back='/backoffice/settings/features'/>;
}
const LEGACY_SYSTEM_SETTINGS_SLUGS=['features','billing','payment-types','loyalty','taxes','receipt','open-tickets','kitchen-printers','modifiers','discounts','suppliers','dining-options'];
function LegacySystemSettingsRedirect(){const {slug=''}=useParams();return <Navigate to={'/backoffice/settings/'+(LEGACY_SYSTEM_SETTINGS_SLUGS.includes(slug)?slug:'features')} replace/>;}
function AppRoutes(){return <AuthProvider><Suspense fallback={<AuthLoading/>}><Routes>
<Route element={<PublicRoute/>}><Route path="/" element={<PublicHome/>}/><Route path="/home" element={<PublicHome/>}/><Route path="/signin" element={<PublicSignIn/>}/><Route path="/signup" element={<PublicSignUp/>}/><Route path="/login" element={<Login/>}/><Route path="/register" element={<Register/>}/></Route>
<Route path="/forgot-password" element={<ForgotPassword/>}/><Route path="/reset-password" element={<ResetPassword/>}/>
<Route path="/terms" element={<TermsPage/>}/><Route path="/privacy" element={<PrivacyPage/>}/>
<Route element={<ProtectedRoute app="backoffice"/>}><Route path="/backoffice" element={<BackOfficeLayout/>}><Route index element={<POSApp initialModule="dashboard" embedded workspaceModule="backoffice"/>}/><Route path="items/list" element={<BackOfficeStorePage tab="products"/>}/><Route path="items/categories" element={<CategoriesPage/>}/><Route path="items/modifiers" element={<Phase2CataloguePage section="modifiers"/>}/><Route path="items/discounts" element={<Phase2CataloguePage section="discounts"/>}/><Route path="reports/sales" element={<BackOfficeReportPage kind="sales"/>}/><Route path="reports/inventory" element={<BackOfficeReportPage kind="inventory"/>}/><Route path="reports/employees" element={<BackOfficeReportPage kind="employees"/>}/><Route path="reports/shifts" element={<ShiftReport/>}/><Route path="inventory/purchase-orders" element={<Purchasing/>}/><Route path="inventory/transfer-orders" element={<POSApp initialModule="transfers" embedded workspaceModule="backoffice"/>}/><Route path="inventory/stock-adjustments" element={<InventoryOperations initialTab="adjustments"/>}/><Route path="inventory/counts" element={<InventoryOperations initialTab="counts"/>}/><Route path="inventory/productions" element={<InventoryOperations initialTab="production"/>}/><Route path="inventory/suppliers" element={<Phase2CataloguePage section="suppliers"/>}/><Route path="inventory/history" element={<InventoryOperations initialTab="history"/>}/><Route path="inventory/valuation" element={<InventoryOperations initialTab="valuation"/>}/><Route path="stores" element={<StoresPage/>}/><Route path="pos-devices" element={<POSDevicesPage/>}/><Route path="printers" element={<KitchenPrintersPage/>}/><Route path="employees/list" element={<EmployeeListPage/>}/><Route path="employees/access-rights" element={<Roles/>}/><Route path="employees/timecards" element={<TimecardsPage/>}/><Route path="employees/hours" element={<TimecardsPage/>}/><Route path="customers" element={<GuestList/>}/><Route path="integrations" element={<BookingEngine/>}/><Route path="settings/:slug" element={<BackOfficeSettingsPage/>}/><Route path="help" element={<HelpCentre/>}/></Route></Route>
<Route element={<ProtectedRoute app="frontoffice"/>}><Route path="/frontoffice" element={<FrontOfficeLayout/>}><Route index element={<FrontOfficeDashboard/>}/><Route path="room-planner" element={<POSApp initialModule="rooms" embedded workspaceModule="frontoffice"/>}/><Route path="rooms" element={<POSApp initialModule="rooms" embedded workspaceModule="frontoffice"/>}/><Route path="reservations" element={<POSApp initialModule="reservations" embedded workspaceModule="frontoffice"/>}/><Route path="folio" element={<POSApp initialModule="folio" embedded workspaceModule="frontoffice"/>}/><Route path="housekeeping" element={<POSApp initialModule="housekeeping" embedded workspaceModule="frontoffice"/>}/><Route path="night-audit" element={<POSApp initialModule="night-audit" embedded workspaceModule="frontoffice"/>}/>
<Route path="manuals" element={<HelpCentre/>}/>
<Route path="assistance" element={<FrontOfficeAssistance/>}/>
<Route path="dashboard" element={<FrontOfficeDashboard/>}/>
<Route path="channels" element={<POSApp initialModule="channels" embedded workspaceModule="frontoffice"/>}/>
<Route path="structure" element={<FrontOfficeStructure/>}/>
<Route path="configuration" element={<FrontOfficeConfiguration/>}/>
<Route path="tags" element={<FrontOfficeTags/>}/>
<Route path="check-in/arrivals" element={<POSApp initialModule="reservations" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/in-house" element={<POSApp initialModule="reservations" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/departures" element={<POSApp initialModule="reservations" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/walk-in" element={<POSApp initialModule="walk-in-checkin" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/express-checkout" element={<POSApp initialModule="express-checkout" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/registration-cards" element={<POSApp initialModule="registration-cards" embedded workspaceModule="frontoffice"/>}/>
<Route path="statistics/:report" element={<FrontOfficeStatistics/>}/>
<Route path="services/housekeeping" element={<POSApp initialModule="housekeeping" embedded workspaceModule="frontoffice"/>}/>
<Route path="services/room-charges" element={<POSApp initialModule="folio" embedded workspaceModule="frontoffice"/>}/>
<Route path="services/minibar" element={<FrontOfficeMinibar/>}/>
<Route path="services/laundry" element={<FrontOfficeLaundry/>}/>
<Route path="services/maintenance" element={<FrontOfficeMaintenance/>}/>
<Route path="services/guest-requests" element={<FrontOfficeGuestRequests/>}/>
<Route path="*" element={<PageNotFound/>}/>
</Route></Route>
<Route element={<ProtectedRoute app="stores"/>}><Route path="/stores" element={<StoresLayout/>}><Route index element={<StorekeeperDashboard/>}/><Route path="manage" element={<Navigate to="/backoffice/stores" replace/>}/><Route path="stock" element={<Store initialTab="overview"/>}/><Route path="stock-alerts" element={<Store initialTab="alerts"/>}/><Route path="purchasing" element={<Store initialTab="purchases"/>}/><Route path="transfers" element={<POSApp initialModule="transfers" embedded workspaceModule="stores"/>}/><Route path="inventory/stock-adjustments" element={<InventoryOperations initialTab="adjustments"/>}/><Route path="inventory/counts" element={<InventoryOperations initialTab="counts"/>}/><Route path="inventory/productions" element={<InventoryOperations initialTab="production"/>}/><Route path="inventory/history" element={<InventoryOperations initialTab="history"/>}/><Route path="inventory/valuation" element={<InventoryOperations initialTab="valuation"/>}/><Route path="reports/sales" element={<Reports/>}/><Route path="reports/inventory" element={<InventoryReports/>}/><Route path="requisitions" element={<ModuleStatusPage module="requisitions" title="Stock requisitions" description="This workspace currently has no requisition table, approval queue, issue linkage or save operation. No zero-count is implied. Use Purchase Orders for supported replenishment." back="/stores" backLabel="Return to Storekeeper Dashboard"/>}/><Route path="settings" element={<Navigate to="/stores" replace/>}/><Route path="pos-devices" element={<Navigate to="/backoffice/pos-devices" replace/>}/><Route path="printers" element={<Navigate to="/backoffice/printers" replace/>}/><Route path="kds" element={<KitchenDisplay/>}/></Route></Route>
<Route path="/dashboard" element={<Navigate to="/backoffice" replace/>}/><Route element={<ProtectedRoute app="pos"/>}><Route path="/pos/access-pin" element={<POSPinSettingsPage/>}/></Route><Route element={<ProtectedRoute app="pos"/>}><Route path="/pos" element={<POSLayout/>}><Route index element={<POSApp initialModule="pos" embedded workspaceModule="pos"/>}/></Route></Route><Route path="/pms" element={<Navigate to="/frontoffice" replace/>}/><Route path="/store" element={<Navigate to="/stores" replace/>}/><Route path="/rooms" element={<Navigate to="/frontoffice/rooms" replace/>}/><Route path="/settings/kitchen-printers" element={<Navigate to="/backoffice/settings/kitchen-printers" replace/>}/><Route path="/settings/system/*" element={<LegacySystemSettingsRedirect/>}/><Route path="/settings/stores" element={<Navigate to="/backoffice/stores" replace/>}/><Route path="/settings/printers" element={<Navigate to="/backoffice/printers" replace/>}/><Route path="/settings/receipt" element={<Navigate to="/backoffice/settings/receipt" replace/>}/><Route path="/404" element={<PageNotFound/>}/>
<Route path="/admin/login" element={<AdminLogin/>}/><Route element={<AdminRoute/>}><Route element={<AdminLayout/>}><Route path="/admin" element={<AdminDashboard/>}/><Route path="/admin/usage" element={<AdminUsage/>}/><Route path="/admin/users" element={<AdminUsers/>}/><Route path="/admin/recovery" element={<AdminRecovery/>}/><Route path="/admin/settings" element={<PropertyAdminSettings/>}/><Route path="/admin/properties" element={<AdminProperties/>}/><Route path="/admin/properties/new" element={<AdminCreateProperty/>}/><Route path="/admin/properties/:id" element={<AdminPropertyDetail/>}/><Route path="/admin/properties/:id/edit" element={<AdminEditProperty/>}/><Route path="/admin/audit-log" element={<AdminAuditLog/>}/><Route path="/admin/roles" element={<Roles/>}/><Route path="/admin/settings/printers" element={<SettingsPrinters/>}/><Route path="/admin/settings/receipt" element={<ReceiptSettings/>}/><Route path="/admin/settings/unsettled-receipt" element={<UnsettledReceiptSettings/>}/></Route></Route>
<Route path="*" element={<PageNotFound/>}/></Routes></Suspense></AuthProvider>;}
function App(){if(!isSupabaseConfigured)return <SupabaseSetupNotice/>;return <QueryClientProvider client={queryClientInstance}><Router><ScrollToTop/><Toaster/><AppRoutes/></Router></QueryClientProvider>;}
export default App;
