import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { StoreProvider } from '@/data/AppStore';
import { PmsProvider } from '@/data/PmsStore';
import { MODULES } from '@/data/platformData';
import { getSubscriptionEntitlement } from '@/data/modules/navArchitecture';
import { SAND, NAVY, MUTED } from '@/data/themePalette';
import { useIsMobile } from '@/hooks/use-mobile';
import Sidebar from '@/components/shell/Sidebar';
import POSTabs from '@/components/shell/POSTabs';
import TopBar from '@/components/shell/TopBar';
import Dashboard from '@/components/modules/Dashboard';
import Reservations from '@/components/modules/Reservations';
import GuestList from '@/components/modules/GuestList';
import Receipts from '@/components/modules/Receipts';
import Folio from '@/components/modules/Folio';
import Cashier from '@/components/modules/Cashier';
import NightAudit from '@/components/modules/NightAudit';
import KitchenDisplay from '@/components/modules/KitchenDisplay';
import Reports from '@/components/modules/Reports';
import SettingsPanel from '@/components/modules/SettingsPanel';
import Rooms from '@/components/pms/Rooms';
import Housekeeping from '@/components/modules/Housekeeping';
import Maintenance from '@/components/modules/Maintenance';
import Purchasing from '@/components/modules/Purchasing';
import Recipes from '@/components/modules/Recipes';
import Laundry from '@/components/modules/Laundry';
import Transfers from '@/components/modules/Transfers';
import BookingEngine from '@/components/modules/BookingEngine';
import ChannelManager from '@/components/modules/ChannelManager';
import DistributionOps from '@/components/modules/DistributionOps';
import Inventory from '@/components/modules/Inventory';
import Store from '@/pages/Store';
import POSContainer from '@/components/pos/POSContainer';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import RouteGuard from '@/components/auth/RouteGuard';
import PaywallGuard from '@/components/auth/PaywallGuard';

const COMING_SOON_IDS = new Set(MODULES.filter((module) => module.comingSoon).map((module) => module.id));

function ComingSoon({ label }) {
  return (
    <div className="flex flex-1 items-center justify-center" style={{ background: SAND }}>
      <div className="max-w-sm text-center">
        <h2 className="mb-2 text-lg font-medium" style={{ color: NAVY }}>{label}</h2>
        <p className="text-sm" style={{ color: MUTED }}>
          This module isn't wired up to real data yet — it's on the roadmap.
        </p>
      </div>
    </div>
  );
}

// The global workspace shell owns navigation when embedded. The legacy sidebar
// remains available only for standalone POSApp entry points.
export default function POSApp({
  initialModule = 'dashboard',
  embedded = false,
  workspaceModule = null,
  storeTab = null,
}) {
  const location = useLocation();
  const queryModule = new URLSearchParams(location.search).get('module');
  const routeModule = queryModule || initialModule;
  const [activeModule, setActiveModule] = useState(routeModule);

  // Keep routed content aligned with direct URLs and browser back/forward.
  // Local module actions remain local until the URL changes.
  useEffect(() => {
    setActiveModule(routeModule);
  }, [routeModule]);

  const isMobile = useIsMobile();
  const currentModule = MODULES.find((module) => module.id === activeModule);

  let content;
  if (COMING_SOON_IDS.has(activeModule)) {
    content = <ComingSoon label={currentModule?.label || 'Module'} />;
  } else {
    switch (activeModule) {
      case 'dashboard':
        content = <Dashboard onNavigateToPOS={() => setActiveModule('pos')} />;
        break;
      case 'pos':
        content = <POSContainer />;
        break;
      case 'reservations':
        content = <Reservations />;
        break;
      case 'rooms':
        content = <Rooms />;
        break;
      case 'guests':
        content = <GuestList />;
        break;
      case 'receipts':
        content = <Receipts />;
        break;
      case 'folio':
        content = <Folio />;
        break;
      case 'cashier':
        content = <Cashier />;
        break;
      case 'night-audit':
        content = <NightAudit />;
        break;
      case 'kitchen':
        content = <KitchenDisplay />;
        break;
      case 'housekeeping':
        content = <Housekeeping />;
        break;
      case 'maintenance':
        content = <Maintenance />;
        break;
      case 'purchasing':
        content = <Purchasing />;
        break;
      case 'recipes':
        content = <Recipes />;
        break;
      case 'laundry':
        content = <Laundry />;
        break;
      case 'transfers':
        content = <Transfers />;
        break;
      case 'booking-engine':
        content = <BookingEngine />;
        break;
      case 'channels':
        content = <ChannelManager />;
        break;
      case 'distribution-ops':
        content = <DistributionOps />;
        break;
      case 'inventory':
        content = <Inventory />;
        break;
      case 'store':
        content = <Store initialTab={storeTab || 'overview'} />;
        break;
      case 'reports':
        content = <Reports />;
        break;
      case 'settings':
        content = <SettingsPanel />;
        break;
      default:
        content = <Dashboard onNavigateToPOS={() => setActiveModule('pos')} />;
    }
  }

  // POS renders its own floor/order/bill controls and should not get a second
  // generic TopBar. Embedded workspaces also suppress the legacy sidebar.
  const showTopBar = activeModule !== 'pos';
  const guardedWorkspace = workspaceModule || (
    activeModule === 'pos' || activeModule === 'cashier'
      ? 'pos'
      : ['store', 'inventory', 'purchasing', 'recipes', 'transfers', 'channels'].includes(activeModule)
        ? 'store'
        : ['reservations', 'rooms', 'guests', 'folio', 'housekeeping', 'night-audit'].includes(activeModule)
          ? 'frontoffice'
          : 'backoffice'
  );

  return (
    <StoreProvider>
      <PmsProvider>
        <div className={embedded ? 'min-h-full w-full bg-[var(--bg)]' : 'app-shell flex min-h-screen w-full bg-[var(--bg)]'}>
          {!embedded && <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />}
          <div className={embedded ? 'min-w-0' : 'flex min-w-0 flex-1 flex-col'}>
            {showTopBar && !embedded && <TopBar moduleLabel={currentModule?.label || ''} />}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ErrorBoundary label={currentModule?.label || 'This section'}>
                <RouteGuard module={guardedWorkspace}>
                  {activeModule === 'settings'
                    ? content
                    : <PaywallGuard module={getSubscriptionEntitlement(activeModule, workspaceModule)}>{content}</PaywallGuard>}
                </RouteGuard>
              </ErrorBoundary>
            </div>
            {isMobile && !embedded && <POSTabs activeModule={activeModule} onModuleChange={setActiveModule} />}
          </div>
        </div>
      </PmsProvider>
    </StoreProvider>
  );
}
