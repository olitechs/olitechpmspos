import { Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
const Purchasing = lazyWithRetry(() => import('@/components/modules/Purchasing'), 'route-components-modules-purchasing');
const InventoryReports = lazyWithRetry(() => import('@/components/modules/InventoryReports'), 'route-components-modules-inventoryreports');
const InventoryOperations = lazyWithRetry(() => import('@/components/modules/InventoryOperations'), 'route-components-modules-inventoryoperations');
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { BrowserRouter as Router, Route, Routes, Navigate, Outlet, useParams } from "react-router-dom";
import PageNotFound from "@/lib/PageNotFound";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import AdminRoute from "@/lib/AdminRoute";
const ScrollToTop = lazyWithRetry(() => import('@/components/ui/ScrollToTop'), 'route-components-ui-scrolltotop');
const Login = lazyWithRetry(() => import('@/pages/Login'), 'route-pages-login');
const Register = lazyWithRetry(() => import('@/pages/Register'), 'route-pages-register');
const ForgotPassword = lazyWithRetry(() => import('@/pages/ForgotPassword'), 'route-pages-forgotpassword');
const ResetPassword = lazyWithRetry(() => import('@/pages/ResetPassword'), 'route-pages-resetpassword');
const PendingApproval = lazyWithRetry(() => import('@/pages/PendingApproval'), 'route-pages-pendingapproval');
const AdminLogin = lazyWithRetry(() => import('@/pages/admin/AdminLogin'), 'route-pages-admin-adminlogin');
const AdminLayout = lazyWithRetry(() => import('@/pages/admin/AdminLayout'), 'route-pages-admin-adminlayout');
const AdminDashboard = lazyWithRetry(() => import('@/pages/admin/AdminDashboard'), 'route-pages-admin-admindashboard');
const AdminUsage = lazyWithRetry(() => import('@/pages/admin/AdminUsage'), 'route-pages-admin-adminusage');
const AdminUsers = lazyWithRetry(() => import('@/pages/admin/AdminUsers'), 'route-pages-admin-adminusers');
const AdminRecovery = lazyWithRetry(() => import('@/pages/admin/AdminRecovery'), 'route-pages-admin-adminrecovery');
const AdminProperties = lazyWithRetry(() => import('@/pages/admin/AdminProperties'), 'route-pages-admin-adminproperties');
const AdminCreateProperty = lazyWithRetry(() => import('@/pages/admin/AdminCreateProperty'), 'route-pages-admin-admincreateproperty');
const AdminEditProperty = lazyWithRetry(() => import('@/pages/admin/AdminEditProperty'), 'route-pages-admin-admineditproperty');
const AdminPropertyDetail = lazyWithRetry(() => import('@/pages/admin/AdminPropertyDetail'), 'route-pages-admin-adminpropertydetail');
const AdminAuditLog = lazyWithRetry(() => import('@/pages/admin/AdminAuditLog'), 'route-pages-admin-adminauditlog');
const Roles = lazyWithRetry(() => import('@/pages/admin/Roles'), 'route-pages-admin-roles');
const PropertyAdminSettings = lazyWithRetry(() => import('@/pages/admin/PropertyAdminSettings'), 'route-pages-admin-propertyadminsettings');
const UnsettledReceiptSettings = lazyWithRetry(() => import('@/pages/admin/UnsettledReceiptSettings'), 'route-pages-admin-unsettledreceiptsettings');
const StaffAdmin = lazyWithRetry(() => import('@/components/admin/StaffAdmin'), 'route-components-admin-staffadmin');
const SettingsPrinters = lazyWithRetry(() => import('@/pages/SettingsPrinters'), 'route-pages-settingsprinters');
const ReceiptSettings = lazyWithRetry(() => import('@/components/settings/ReceiptSettings'), 'route-components-settings-receiptsettings');
const SubscriptionPanel = lazyWithRetry(() => import('@/components/admin/SubscriptionPanel'), 'route-components-admin-subscriptionpanel');
const KitchenDisplay = lazyWithRetry(() => import('@/components/modules/KitchenDisplay'), 'route-components-modules-kitchendisplay');
const SupabaseSetupNotice = lazyWithRetry(() => import('@/pages/SupabaseSetupNotice'), 'route-pages-supabasesetupnotice');
const PublicHome = lazyWithRetry(() => import('@/pages/PublicHome'), 'route-pages-publichome');
const PublicSignIn = lazyWithRetry(() => import('@/pages/PublicSignIn'), 'route-pages-publicsignin');
const PublicSignUp = lazyWithRetry(() => import('@/pages/PublicSignUp'), 'route-pages-publicsignup');
const LegalComingSoon = lazyWithRetry(() => import('@/pages/LegalComingSoon'), 'route-pages-legalcomingsoon');
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { canAccessApp, getDefaultApp, normalizeAppRole } from "@/data/modules/navArchitecture";
import { getSessionStaff, normalizeStaffRole } from "@/services/authService";
const BackOfficeLayout = lazyWithRetry(() => import('@/components/layout/BackOfficeLayout'), 'route-components-layout-backofficelayout');
const FrontOfficeLayout = lazyWithRetry(() => import('@/components/layout/FrontOfficeLayout'), 'route-components-layout-frontofficelayout');
const StoresLayout = lazyWithRetry(() => import('@/components/layout/StoresLayout'), 'route-components-layout-storeslayout');
const POSLayout = lazyWithRetry(() => import('@/components/layout/POSLayout'), 'route-components-layout-poslayout');
const POSPinSettingsPage = lazyWithRetry(() => import('@/pages/POSPinSettingsPage'), 'route-pages-pospinsettingspage');
const KitchenPrintersPage = lazyWithRetry(() => import('@/components/settings/KitchenPrintersPage'), 'route-components-settings-kitchenprinterspage');
const Phase2CataloguePage = lazyWithRetry(() => import('@/components/settings/Phase2CataloguePage'), 'route-components-settings-phase2cataloguepage');
const GuestList = lazyWithRetry(() => import('@/components/modules/GuestList'), 'route-components-modules-guestlist');
const BookingEngine = lazyWithRetry(() => import('@/components/modules/BookingEngine'), 'route-components-modules-bookingengine');
const Transfers = lazyWithRetry(() => import('@/components/modules/Transfers'), 'route-components-modules-transfers');
const Recipes = lazyWithRetry(() => import('@/components/modules/Recipes'), 'route-components-modules-recipes');
const POSDevicesPage = lazyWithRetry(() => import('@/components/stores/POSDevicesPage'), 'route-components-stores-posdevicespage');
const ModuleStatusPage = lazyWithRetry(() => import('@/components/shared/ModuleStatusPage'), 'route-components-shared-modulestatuspage');
const StorekeeperDashboard = lazyWithRetry(() => import('@/pages/StorekeeperDashboard'), 'route-pages-storekeeperdashboard');
const OperationalSettingsPage = lazyWithRetry(() => import('@/components/settings/OperationalSettingsPage'), 'route-components-settings-operationalsettingspage');
const CategoriesPage = lazyWithRetry(() => import('@/components/settings/CategoriesPage'), 'route-components-settings-categoriespage');
const TimecardsPage = lazyWithRetry(() => import('@/components/settings/TimecardsPage'), 'route-components-settings-timecardspage');
const EmployeeListPage = lazyWithRetry(() => import('@/components/settings/EmployeeListPage'), 'route-components-settings-employeelistpage');
const HelpCentre = lazyWithRetry(() => import('@/pages/HelpCentre'), 'route-pages-helpcentre');
const FrontOfficeDashboard = lazyWithRetry(() => import('@/pages/FrontOfficeDashboard'), 'route-pages-frontofficedashboard');
const FrontOfficeStructure = lazyWithRetry(() => import('@/pages/FrontOfficeStructure'), 'route-pages-frontofficestructure');
const ShiftReport = lazyWithRetry(() => import('@/pages/ShiftReport'), 'route-pages-shiftreport');
const POSApp = lazyWithRetry(() => import('@/pages/POSApp'), 'app-pos-app');
const Reports = lazyWithRetry(() => import('@/components/modules/Reports'), 'app-reports');
const Store = lazyWithRetry(() => import('@/pages/Store'), 'app-store');
const StoresPage = lazyWithRetry(() => import('@/components/stores/StoresPage'), 'app-stores-page');

function AuthLoading(){return <main role="status" aria-live="polite" aria-label="Loading OliTechs" className="min-h-screen bg-[var(--canvas)] p-4 sm:p-6"><div className="mx-auto w-full max-w-[1600px] space-y-5"><div className="flex items-center justify-between"><div className="h-9 w-40 animate-pulse rounded-lg bg-[var(--surface-2)]"/><div className="h-9 w-28 animate-pulse rounded-lg bg-[var(--surface-2)]"/></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({length:4},(_,i)=><div key={i} className="h-28 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]"/>)}</div><div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"><div className="h-[420px] animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]"/><div className="h-[420px] animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]"/></div></div></main>;}
function appRole(user){const s=getSessionStaff();const raw=s?.role||user?.staff?.role||user?.propertyRole||user?.role;return normalizeAppRole(normalizeStaffRole(raw));}
function PublicRoute(){const {user,isLoadingAuth,isLoadingPublicSettings}=useAuth();if(isLoadingAuth||isLoadingPublicSettings)return <Outlet/>;if(user){if(user?.isPlatformOwner)return <Navigate to="/admin" replace/>;const defaultApp=getDefaultApp(appRole(user),user?.property?.package);return defaultApp?<Navigate to={'/'+defaultApp} replace/>:<PendingApproval/>;}return <Outlet/>;}
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
function AppRoutes(){return <AuthProvider><Suspense fallback={<AuthLoading/>}><Routes>
<Route element={<PublicRoute/>}><Route path="/" element={<PublicHome/>}/><Route path="/home" element={<PublicHome/>}/><Route path="/signin" element={<PublicSignIn/>}/><Route path="/signup" element={<PublicSignUp/>}/><Route path="/login" element={<Login/>}/><Route path="/register" element={<Register/>}/></Route>
<Route path="/forgot-password" element={<ForgotPassword/>}/><Route path="/reset-password" element={<ResetPassword/>}/>
<Route path="/terms" element={<LegalComingSoon page="terms"/>}/><Route path="/privacy" element={<LegalComingSoon page="privacy"/>}/>
<Route element={<ProtectedRoute app="backoffice"/>}><Route path="/backoffice" element={<BackOfficeLayout/>}><Route index element={<POSApp initialModule="dashboard" embedded workspaceModule="backoffice"/>}/><Route path="items/list" element={<BackOfficeStorePage tab="products"/>}/><Route path="items/categories" element={<CategoriesPage/>}/><Route path="items/modifiers" element={<Phase2CataloguePage section="modifiers"/>}/><Route path="items/discounts" element={<Phase2CataloguePage section="discounts"/>}/><Route path="reports/sales" element={<BackOfficeReportPage kind="sales"/>}/><Route path="reports/inventory" element={<BackOfficeReportPage kind="inventory"/>}/><Route path="reports/employees" element={<BackOfficeReportPage kind="employees"/>}/><Route path="reports/shifts" element={<ShiftReport/>}/><Route path="inventory/purchase-orders" element={<Purchasing/>}/><Route path="inventory/transfer-orders" element={<POSApp initialModule="transfers" embedded workspaceModule="backoffice"/>}/><Route path="inventory/stock-adjustments" element={<InventoryOperations initialTab="adjustments"/>}/><Route path="inventory/counts" element={<InventoryOperations initialTab="counts"/>}/><Route path="inventory/productions" element={<InventoryOperations initialTab="production"/>}/><Route path="inventory/suppliers" element={<Phase2CataloguePage section="suppliers"/>}/><Route path="inventory/history" element={<InventoryOperations initialTab="history"/>}/><Route path="inventory/valuation" element={<InventoryOperations initialTab="valuation"/>}/><Route path="stores" element={<StoresPage/>}/><Route path="pos-devices" element={<POSDevicesPage/>}/><Route path="printers" element={<KitchenPrintersPage/>}/><Route path="employees/list" element={<EmployeeListPage/>}/><Route path="employees/access-rights" element={<Roles/>}/><Route path="employees/timecards" element={<TimecardsPage/>}/><Route path="employees/hours" element={<TimecardsPage/>}/><Route path="customers" element={<GuestList/>}/><Route path="integrations" element={<BookingEngine/>}/><Route path="settings/:slug" element={<BackOfficeSettingsPage/>}/><Route path="help" element={<HelpCentre/>}/></Route></Route>
<Route element={<ProtectedRoute app="frontoffice"/>}><Route path="/frontoffice" element={<FrontOfficeLayout/>}><Route index element={<FrontOfficeDashboard/>}/><Route path="room-planner" element={<POSApp initialModule="rooms" embedded workspaceModule="frontoffice"/>}/><Route path="rooms" element={<POSApp initialModule="rooms" embedded workspaceModule="frontoffice"/>}/><Route path="reservations" element={<POSApp initialModule="reservations" embedded workspaceModule="frontoffice"/>}/><Route path="folio" element={<POSApp initialModule="folio" embedded workspaceModule="frontoffice"/>}/><Route path="housekeeping" element={<POSApp initialModule="housekeeping" embedded workspaceModule="frontoffice"/>}/><Route path="night-audit" element={<POSApp initialModule="night-audit" embedded workspaceModule="frontoffice"/>}/>
<Route path="manuals" element={<HelpCentre/>}/>
<Route path="assistance" element={<ModuleStatusPage title="Assistance" description="Support contacts, service requests, ticket history and system status." module="assistance" back="/frontoffice"/>}/>
<Route path="dashboard" element={<FrontOfficeDashboard/>}/>
<Route path="channels" element={<POSApp initialModule="channels" embedded workspaceModule="frontoffice"/>}/>
<Route path="structure" element={<FrontOfficeStructure/>}/>
<Route path="configuration" element={<ModuleStatusPage title="Configuration" description="Rates, seasons, VAT, payment methods, policies, templates, users, roles and planner settings." module="configuration" back="/frontoffice"/>}/>
<Route path="tags" element={<ModuleStatusPage title="Tags" description="Create and assign coloured tags for reservations, guests and rooms." module="tags" back="/frontoffice"/>}/>
<Route path="check-in/arrivals" element={<POSApp initialModule="reservations" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/in-house" element={<POSApp initialModule="reservations" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/departures" element={<POSApp initialModule="reservations" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/walk-in" element={<POSApp initialModule="walk-in-checkin" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/express-checkout" element={<POSApp initialModule="express-checkout" embedded workspaceModule="frontoffice"/>}/>
<Route path="check-in/registration-cards" element={<POSApp initialModule="registration-cards" embedded workspaceModule="frontoffice"/>}/>
<Route path="statistics/:report" element={<ModuleStatusPage title="Statistics" description="Property performance reporting with period filters and document exports." module="statistics" back="/frontoffice"/>}/>
<Route path="services/housekeeping" element={<POSApp initialModule="housekeeping" embedded workspaceModule="frontoffice"/>}/>
<Route path="services/room-charges" element={<POSApp initialModule="folio" embedded workspaceModule="frontoffice"/>}/>
<Route path="services/minibar" element={<ModuleStatusPage title="Minibar and Extras" description="Track minibar consumption and guest extras." module="minibar" back="/frontoffice"/>}/>
<Route path="services/laundry" element={<ModuleStatusPage title="Laundry" description="Manage guest laundry requests and charges." module="laundry" back="/frontoffice"/>}/>
<Route path="services/maintenance" element={<ModuleStatusPage title="Maintenance / Work Orders" description="Record maintenance requests, work orders and room downtime." module="maintenance" back="/frontoffice"/>}/>
<Route path="services/guest-requests" element={<ModuleStatusPage title="Guest Requests / Transfers and Tours" description="Coordinate guest requests, transfers and tours." module="guest-requests" back="/frontoffice"/>}/>
<Route path="*" element={<ModuleStatusPage title="Front Office Module" description="This Front Office route is reserved for a supported module." module="frontoffice" back="/frontoffice"/>}/>
</Route></Route>
<Route element={<ProtectedRoute app="stores"/>}><Route path="/stores" element={<StoresLayout/>}><Route index element={<StorekeeperDashboard/>}/><Route path="manage" element={<Navigate to="/backoffice/stores" replace/>}/><Route path="stock" element={<Store initialTab="overview"/>}/><Route path="stock-alerts" element={<Store initialTab="alerts"/>}/><Route path="purchasing" element={<Store initialTab="purchases"/>}/><Route path="transfers" element={<POSApp initialModule="transfers" embedded workspaceModule="stores"/>}/><Route path="inventory/stock-adjustments" element={<InventoryOperations initialTab="adjustments"/>}/><Route path="inventory/counts" element={<InventoryOperations initialTab="counts"/>}/><Route path="inventory/productions" element={<InventoryOperations initialTab="production"/>}/><Route path="inventory/history" element={<InventoryOperations initialTab="history"/>}/><Route path="inventory/valuation" element={<InventoryOperations initialTab="valuation"/>}/><Route path="reports/sales" element={<Reports/>}/><Route path="reports/inventory" element={<InventoryReports/>}/><Route path="requisitions" element={<ModuleStatusPage module="requisitions" title="Stock requisitions" description="This workspace currently has no requisition table, approval queue, issue linkage or save operation. No zero-count is implied. Use Purchase Orders for supported replenishment." back="/stores" backLabel="Return to Storekeeper Dashboard"/>}/><Route path="settings" element={<Navigate to="/stores" replace/>}/><Route path="pos-devices" element={<Navigate to="/backoffice/pos-devices" replace/>}/><Route path="printers" element={<Navigate to="/backoffice/printers" replace/>}/><Route path="kds" element={<KitchenDisplay/>}/></Route></Route>
<Route path="/dashboard" element={<Navigate to="/backoffice" replace/>}/><Route element={<ProtectedRoute app="pos"/>}><Route path="/pos/access-pin" element={<POSPinSettingsPage/>}/></Route><Route element={<ProtectedRoute app="pos"/>}><Route path="/pos" element={<POSLayout/>}><Route index element={<POSApp initialModule="pos" embedded workspaceModule="pos"/>}/></Route></Route><Route path="/pms" element={<Navigate to="/frontoffice" replace/>}/><Route path="/store" element={<Navigate to="/stores" replace/>}/><Route path="/rooms" element={<Navigate to="/frontoffice/rooms" replace/>}/><Route path="/settings/kitchen-printers" element={<Navigate to="/backoffice/settings/kitchen-printers" replace/>}/><Route path="/settings/system/*" element={<Navigate to="/backoffice/settings/features" replace/>}/><Route path="/404" element={<PageNotFound/>}/>
<Route path="/admin/login" element={<AdminLogin/>}/><Route element={<AdminRoute/>}><Route element={<AdminLayout/>}><Route path="/admin" element={<AdminDashboard/>}/><Route path="/admin/usage" element={<AdminUsage/>}/><Route path="/admin/users" element={<AdminUsers/>}/><Route path="/admin/recovery" element={<AdminRecovery/>}/><Route path="/admin/settings" element={<PropertyAdminSettings/>}/><Route path="/admin/properties" element={<AdminProperties/>}/><Route path="/admin/properties/new" element={<AdminCreateProperty/>}/><Route path="/admin/properties/:id" element={<AdminPropertyDetail/>}/><Route path="/admin/properties/:id/edit" element={<AdminEditProperty/>}/><Route path="/admin/audit-log" element={<AdminAuditLog/>}/><Route path="/admin/roles" element={<Roles/>}/><Route path="/admin/settings/printers" element={<SettingsPrinters/>}/><Route path="/admin/settings/receipt" element={<ReceiptSettings/>}/><Route path="/admin/settings/unsettled-receipt" element={<UnsettledReceiptSettings/>}/></Route></Route>
<Route path="*" element={<PageNotFound/>}/></Routes></Suspense></AuthProvider>;}
function App(){if(!isSupabaseConfigured)return <SupabaseSetupNotice/>;return <QueryClientProvider client={queryClientInstance}><Router><ScrollToTop/><Toaster/><AppRoutes/></Router></QueryClientProvider>;}
export default App;
