import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { StoreProvider } from '@/data/AppStore';
import { PmsProvider } from '@/data/PmsStore';
import { MODULES } from '@/data/platformData';
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
import RoomManagement from '@/components/pms/RoomManagement';
import Housekeeping from '@/components/modules/Housekeeping';
import Maintenance from '@/components/modules/Maintenance';
import Purchasing from '@/components/modules/Purchasing';
import Recipes from '@/components/modules/Recipes';
import Laundry from '@/components/modules/Laundry';
import Transfers from '@/components/modules/Transfers';
import BookingEngine from '@/components/modules/BookingEngine';
import ChannelManager from '@/components/modules/ChannelManager';
import Inventory from '@/components/modules/Inventory';
import Store from '@/pages/Store';
import POSContainer from '@/components/pos/POSContainer';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import RouteGuard from '@/components/auth/RouteGuard';
import PaywallGuard from '@/components/auth/PaywallGuard';

const COMING_SOON_IDS = new Set(MODULES.filter((m) => m.comingSoon).map((m) => m.id));

function ComingSoon({ label }) {
	return (
		<div className="flex-1 flex items-center justify-center" style={{ background: SAND }}>
			<div className="text-center max-w-sm">
				<h2 className="text-lg font-semibold mb-2" style={{ color: NAVY }}>{label}</h2>
				<p className="text-sm" style={{ color: MUTED }}>
					This module isn't wired up to real data yet — it's on the roadmap.
				</p>
			</div>
		</div>
	);
}

// Main authenticated app shell: sidebar/bottom-nav + top bar + the active
// module. Wraps everything the POS and PMS modules need (table sessions,
// printers, rooms, reservations) in their local-state providers.
export default function POSApp({ initialModule = 'dashboard', embedded = false, workspaceModule = null, storeTab = null }) {
	const location = useLocation();
	const queryModule = new URLSearchParams(location.search).get('module');
	const [activeModule, setActiveModule] = useState(queryModule || initialModule);
	useEffect(() => { if (queryModule && queryModule !== activeModule) setActiveModule(queryModule); }, [queryModule]);
	const isMobile = useIsMobile();

	const currentModule = MODULES.find((m) => m.id === activeModule);

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
			case 'purchasing': content = <Purchasing />; break;
			case 'recipes': content = <Recipes />; break;
			case 'laundry': content = <Laundry />; break;
			case 'transfers': content = <Transfers />; break;
			case 'booking-engine': content = <BookingEngine />; break;
			case 'channels': content = <ChannelManager />; break;
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

	// The POS module renders its own header (with the floor/order/bill tabs)
	// so it doesn't need the generic TopBar duplicating that space.
	const showTopBar = activeModule !== 'pos';

	return (
		<StoreProvider>
			<PmsProvider>
				<div className={embedded ? "min-h-full w-full bg-[#F9F9FA]" : "app-shell flex min-h-screen w-full bg-[#F9F9FA]"}>
					{!embedded && <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />}
					<div className={embedded ? "min-w-0" : "flex min-w-0 flex-1 flex-col"}>
						{showTopBar && !embedded && <TopBar moduleLabel={currentModule?.label || ''} />}
						<div className="min-h-0 flex-1 overflow-y-auto">
							<ErrorBoundary label={currentModule?.label || 'This section'}>
								<RouteGuard module={workspaceModule || (activeModule === 'pos' || activeModule === 'cashier' ? 'pos' : activeModule === 'store' || activeModule === 'inventory' || activeModule === 'purchasing' || activeModule === 'recipes' || activeModule === 'transfers' || activeModule === 'channels' ? 'store' : activeModule === 'reservations' || activeModule === 'rooms' || activeModule === 'guests' || activeModule === 'folio' || activeModule === 'housekeeping' || activeModule === 'night-audit' ? 'frontoffice' : 'backoffice')}>
									{activeModule === 'settings' ? content : <PaywallGuard module={activeModule}>{content}</PaywallGuard>}
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
