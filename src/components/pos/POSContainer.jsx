import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, GitMerge, X, MoveRight } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/data/AppStore';
import { tableLabel } from '@/lib/posTables';
import { fromMinor, toMinor } from '@/lib/money';
import AppHeader from '@/components/pos/AppHeader';
import StaffDock from '@/components/pos/StaffDock';
import FloorPlan from '@/components/pos/FloorPlan';
import OrderTaking from '@/components/pos/OrderTaking';
import BillPayment from '@/components/pos/BillPayment';
import OpenTableDialog from '@/components/pos/OpenTableDialog';
import PinPad from '@/components/auth/PinPad';
import { authService } from '@/services/authService';
import { useAuth } from '@/lib/AuthContext';
import { printOrderByCategory } from '@/services/printService';
import { posService } from '@/services/posService';
import { getUnsentOrderLines } from '@/services/printTemplates';
import { posAccessService } from '@/services/posAccessService';
import POSAccessGate, { POS_ACCESS_KEY } from '@/components/pos/POSAccessGate';
import PosPinSetupGate from '@/components/pos/PosPinSetupGate';
import MenuManager from '@/components/pos/MenuManager';
import POSSettings from '@/components/pos/settings/POSSettings';
import ShiftManagementPage from '@/components/pos/ShiftManagementPage';
import CloseShiftModal from '@/components/pos/CloseShiftModal';
import { shiftService } from '@/services/shiftService';

const THERMAL_COLUMNS = 42; // standard 80mm thermal ticket text width

function wrapTicketLine(text, width = THERMAL_COLUMNS) {
	const value = String(text || '');
	if (value.length <= width) return [value];
	const words = value.split(/\s+/);
	const rows = [];
	let row = '';
	for (const word of words) {
		if (!row) row = word;
		else if ((row + ' ' + word).length <= width) row += ' ' + word;
		else { rows.push(row); row = word; }
	}
	if (row) rows.push(row);
	return rows;
}

function buildKitchenTicketText(center, lines, { orderNumber, table, propertyName, waiter }) {
	const divider = '-'.repeat(THERMAL_COLUMNS);
	const itemRows = lines.flatMap((line) => wrapTicketLine(`${line.qty}x ${line.name}`));
	return [
		String(propertyName || 'OliTechs PMS + POS').toUpperCase(),
		divider,
		`${center.toUpperCase()} ORDER TICKET`,
		`ORDER: ${orderNumber}`,
		`TABLE: ${tableLabel(table)}`,
		`WAITER: ${String(waiter || 'Unassigned').toUpperCase()}`,
		`TIME: ${new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`,
		divider,
		...itemRows,
		divider,
		'',
	].join('\n');
}

// Owns the floor → order → bill flow for the POS module: table selection,
// opening a new table session, taking an order, and settling the bill.
export default function POSContainer({ initialTab = 'floor' } = {}) {
	const store = useStore();
	const navigate = useNavigate();
	const { user } = useAuth();
	const propertyId = user?.property?.id;
	const sessionStaff = (() => { try { return JSON.parse(sessionStorage.getItem('olitech_active_staff_v2') || 'null'); } catch { return null; } })();
	const posRole = String(sessionStaff?.role || user?.staff?.role || user?.propertyRole || '').toLowerCase().replace(/\s+/g,'_');
	const canCloseShift = Boolean(user?.isPlatformOwner || ['hotel_admin','super_admin','cashier','fb_manager','owner','admin','manager','property_manager','general_manager'].includes(posRole));
	const propertyName = user?.property?.name || user?.property?.business_name || 'OliTechs PMS + POS';
	const [posStaff, setPosStaff] = useState([]);
	const [posStaffError, setPosStaffError] = useState('');
	const [switchStaff, setSwitchStaff] = useState(null);
	// The active till operator, so the staff dock can show who is signed in.
	const [activeStaffId, setActiveStaffId] = useState(() => sessionStaff?.id ?? null);
	const [switchError, setSwitchError] = useState('');
	const [posUnlocked, setPosUnlocked] = useState(false);
	const [posAccessError, setPosAccessError] = useState('');
	const [posAccessBusy, setPosAccessBusy] = useState(false);
	const canManagePosPin = Boolean(user?.isPlatformOwner || ['owner', 'admin'].includes(String(user?.propertyRole || '').toLowerCase()) || ['hotel_admin', 'super_admin'].includes(String(user?.staff?.role || '').toLowerCase()));
	useEffect(() => {
		if (!propertyId) return;
		// Keep the POS access grant for this browser window only. Navigating between
		// POS screens/routes must not ask for the property PIN again; closing or
		// refreshing this window clears the grant and requires a fresh PIN.
		const accessKey = `${POS_ACCESS_KEY}:${propertyId}`;
		setPosUnlocked(sessionStorage.getItem(accessKey) === '1');
		setPosAccessError('');
		setCurrentShift(null);
		setShiftLoadError('');
		setShiftLoading(true);
		setActiveTab('shifts');
		authService.listStaff(propertyId, 'pos')
			.then((rows) => {
				setPosStaff((rows || []).map((row) => ({ id: row.id, name: row.full_name })));
				setPosStaffError('');
			})
			.catch((error) => {
				// Without this list a table cannot be opened, so the dialog must say
				// why instead of showing a bare "no waiters configured" message.
				console.error('[POS] staff list could not be loaded', error);
				setPosStaff([]);
				setPosStaffError('The staff list could not be loaded. Check the connection and retry.');
			});
		shiftService.getCurrentShift(propertyId)
			.then((shift) => {
				setCurrentShift(shift);
				setActiveTab(initialTab === 'shifts' ? 'shifts' : (shift ? 'floor' : 'shifts'));
			})
			.catch((error) => {
				setCurrentShift(null);
				setShiftLoadError(error?.message || 'Could not verify the current POS shift.');
			})
			.finally(() => setShiftLoading(false));
	}, [propertyId]);
	useEffect(() => {
		if (!propertyId) return undefined;
		const accessKey = `${POS_ACCESS_KEY}:${propertyId}`;
		const clearWindowAccess = () => {
			try { sessionStorage.removeItem(accessKey); } catch {}
		};
		window.addEventListener('beforeunload', clearWindowAccess);
		return () => window.removeEventListener('beforeunload', clearWindowAccess);
	}, [propertyId]);
	// Keep the open-shift state honest across terminals: another till can open
	// or close the property shift, and this screen must follow it instead of
	// showing a stale banner or letting sales continue against a closed shift.
	useEffect(() => {
		if (!propertyId) return undefined;
		let active = true;
		const refresh = () => {
			if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
			shiftService.getCurrentShift(propertyId)
				.then((shift) => {
					if (!active) return;
					setCurrentShift((previous) => (previous?.id === shift?.id ? previous : shift));
					setShiftLoadError('');
				})
				.catch(() => {
					// Keep the last known shift; the next tick retries rather than
					// flashing a false "no open shift" warning.
				});
		};
		const timer = window.setInterval(refresh, 60000);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			active = false;
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', refresh);
		};
	}, [propertyId]);
	const verifySwitch = async (pin) => { try { const result = await authService.verifyStaffPinForStaff({ propertyId, staffId: switchStaff?.id, module: 'pos', pin }); if (!result?.ok) { setSwitchError('Wrong PIN'); return; } sessionStorage.setItem('olitech_active_staff_v2', JSON.stringify(result.staff)); setActiveStaffId(result.staff?.id ?? null); window.dispatchEvent(new CustomEvent('olitech:staff-changed', { detail: result.staff })); setSwitchStaff(null); setSwitchError(''); } catch (e) { setSwitchError(e.message); } };
	// Forced "Set a new POS PIN" flow (upgrade pack Task 3): owners/admins must
	// replace the default (or missing) POS access PIN before entering POS.
	// Staff entering with the default PIN still get in — the hard server block
	// is a deliberate platform decision that has NOT been taken yet.
	const [posPinSetup, setPosPinSetup] = useState(null);
	const verifyPosAccess = async (pin) => {
		if (posAccessBusy) return;
		setPosAccessBusy(true);
		setPosAccessError('');
		let timeoutId;
		try {
			const timeout = new Promise((_, reject) => {
				timeoutId = window.setTimeout(() => reject(new Error('POS PIN verification is taking too long. Check your connection and try again.')), 20000);
			});
			const result = await Promise.race([
				posAccessService.verifyPin({ propertyId, pin }),
				timeout,
			]);
			if (!result?.ok) {
				setPosAccessError(result?.message || 'Incorrect POS PIN. Try again.');
				return;
			}
			if (result.must_change) {
				if (canManagePosPin) {
					setPosPinSetup('must_change');
					return;
				}
				toast.warning('POS is still using the default access PIN. Ask a property administrator to change it.');
			}
			sessionStorage.setItem(`${POS_ACCESS_KEY}:${propertyId}`, '1');
			setPosUnlocked(true);
		} catch (error) {
			const message = error?.message || 'Could not verify the POS PIN. Check your connection.';
			if (/not configured/i.test(message) && canManagePosPin) {
				setPosPinSetup('not_configured');
				return;
			}
			setPosAccessError(message);
		} finally {
			window.clearTimeout(timeoutId);
			setPosAccessBusy(false);
		}
	};
	const handlePosPinSetup = () => {
		sessionStorage.setItem(`${POS_ACCESS_KEY}:${propertyId}`, '1');
		setPosPinSetup(null);
		setPosUnlocked(true);
		toast.success('POS access PIN set. The default code is no longer active.');
	};
	const handlePosSignOut = () => {
		const confirmed = window.confirm('Sign out of the POS? The current shift will remain open, and all orders and payment records will be preserved.');
		if (!confirmed) return;
		try {
			sessionStorage.removeItem('olitech_active_staff_v2');
			sessionStorage.removeItem(`${POS_ACCESS_KEY}:${propertyId}`);
		} catch (error) {
			console.error('[POS] could not clear the local sign-in session', error);
			toast.error('Could not sign out. Please try again.');
			return;
		}
		setActiveStaffId(null);
		setSwitchStaff(null);
		setSwitchError('');
		setActiveTable(null);
		setActiveTab('shifts');
		setPosAccessError('');
		setPosUnlocked(false);
		toast.success('You have signed out of the POS.');
	};
	const [activeTab, setActiveTab] = useState('floor');
	const [activeTable, setActiveTable] = useState(null);
	const [pendingTable, setPendingTable] = useState(null); // table awaiting "open" dialog
	const [tableTransferOpen, setTableTransferOpen] = useState(false);
	const [tableTransferTarget, setTableTransferTarget] = useState(null);
	const [tableTransferBusy, setTableTransferBusy] = useState(false);
	const [tableTransferError, setTableTransferError] = useState('');
	const [currentShift, setCurrentShift] = useState(null);
	const [shiftLoading, setShiftLoading] = useState(true);
	const [shiftLoadError, setShiftLoadError] = useState('');
		const [menuManagerOpen, setMenuManagerOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [closeShiftOpen, setCloseShiftOpen] = useState(false);
	// Order lines are kept per-table so switching tabs/tables doesn't lose an in-progress order.
	const [orderLinesByTable, setOrderLinesByTable] = useState({});
	useEffect(() => {
		setOrderLinesByTable({});
		orderNumbersRef.current = {};
	}, [propertyId]);

	// Stable per-table order numbers (regenerated each time a table is opened).
	const orderNumbersRef = useRef({});
	const sendingTablesRef = useRef(new Set());
	const orderLines = activeTable ? orderLinesByTable[activeTable.id] || [] : [];
	useEffect(() => {
		if (!activeTable) return;
		const lines = orderLinesByTable[activeTable.id] || [];
		const total = fromMinor(toMinor(lines.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.qty || 0), 0)));
		store.updateSessionTotals(activeTable.id, { total, orderCount: lines.length });
	}, [activeTable, orderLinesByTable, store.updateSessionTotals]);

	const setOrderLines = useCallback((updater) => {
		if (!activeTable) return;
		setOrderLinesByTable((prev) => {
			const current = prev[activeTable.id] || [];
			const next = typeof updater === 'function' ? updater(current) : updater;
			store.setSessionOrderLines(activeTable.id, next, orderNumbersRef.current[activeTable.id] || null);
			return { ...prev, [activeTable.id]: next };
		});
	}, [activeTable]);

	const handleTableSelect = (table) => {
		const session = store.getSession(table.id);
		if (!session) {
			// Free table — ask for guests/waiter before opening an order.
			setPendingTable(table);
			return;
		}
		if (!orderNumbersRef.current[table.id]) {
			orderNumbersRef.current[table.id] = session.orderNumber || `ORD-${String(table.number).padStart(3, '0')}-${Date.now().toString(36).slice(-7).toUpperCase()}`;
		}
		// Hydrate the bill screen from the persisted table session. Without this,
		// a printed/unsettled table reopened after navigation/reload had its
		// session in AppStore but POSContainer's local orderLinesByTable was
		// empty, producing a bill with 0 items / 0 total.
		setOrderLinesByTable((prev) => ({ ...prev, [table.id]: Array.isArray(session.orderLines) ? session.orderLines : [] }));
		store.setSessionOrderLines(table.id, session.orderLines || [], orderNumbersRef.current[table.id]);
		setActiveTable(table);
		setActiveTab(session.status === 'unsettled' ? 'bill' : 'order');
	};

	const handleStartTable = ({ guests, waiter }) => {
		const orderNumber = `ORD-${String(pendingTable.number).padStart(3, '0')}-${Date.now().toString(36).slice(-7).toUpperCase()}`;
		orderNumbersRef.current[pendingTable.id] = orderNumber;
		store.openTable(pendingTable.id, {
			guests,
			waiter,
			tableNumber: pendingTable.number,
			zoneId: pendingTable.zoneId || null,
			orderNumber,
		});
		setActiveTable(pendingTable);
		setPendingTable(null);
		setActiveTab('order');
	};

	// Firing the order to the kitchen is recorded first and unconditionally —
	// a printer failure never loses or duplicates the order itself. Any
	// failed ticket surfaces as a dismissable, retryable toast so staff can
	// keep working the floor instead of being blocked on a printer issue.
	const sendToKitchenNow = async () => {
		const table = activeTable;
		const orderNumber = orderNumbersRef.current[table.id];
		const linesSnapshot = orderLinesByTable[table.id] || [];
		const session = store.getSession(table.id);
		const previouslySent = session?.kotSentOrderLines || [];
		const newLines = getUnsentOrderLines(linesSnapshot, previouslySent);

		if (!newLines.length) {
			toast.info('There are no new items to send. Previously fired items will not be printed again.');
			return;
		}

		setActiveTab('floor');
		setActiveTable(null);

		const kitchenOrderRecord = await store.fireKitchenOrder({
			table, orderLines: newLines, orderNumber,
			buildTicketText: (center, lines) => buildKitchenTicketText(center, lines, { orderNumber, table, propertyName, waiter: session?.waiter }),
			printTickets: false,
		});

		const printOrder = (linesToPrint = newLines) => printOrderByCategory({
			propertyId,
			propertyName,
			orderNumber,
			checkNo: orderNumber,
			table: tableLabel(table),
			waiter: session?.waiter,
			covers: session?.guests || table.seats,
			diningOption: table?.diningOption || table?.dining_option || 'Dine In',
			isAddition: !!session?.kotSentAt,
			createdAt: Date.now(),
			items: linesToPrint,
		});
		let retryLines = newLines;
		const persistSentSnapshot = async () => {
			try {
				await store.setKotSentOrderLines(table.id, linesSnapshot, { markSent: true });
				return true;
			} catch (error) {
				console.error('[POS] ticket printed but KOT snapshot could not be saved', error);
				toast.error('Tickets printed, but the sent-item snapshot could not be saved. Do not resend this order until the connection is restored.');
				return false;
			}
		};
		// Every ticket is routed by production department inside printOrderByCategory:
		// a group or the category's production centre decides the destination.
		const dispatchTickets = async (linesToPrint = retryLines) => printOrder(linesToPrint);
		// Persist the full sent-item snapshot before printer I/O. The POS leaves
		// the order screen while tickets are being dispatched; without this
		// early snapshot, staff can reopen the table during a slow print and the
		// next send sees the previous snapshot, reprinting the whole check.
		if (!(await persistSentSnapshot())) return;

		let printResult;
		try {
			printResult = await dispatchTickets();
		} catch (error) {
			toast.error(`Order ${orderNumber} was saved, but KOT/BOT routing failed.`, {
				description: error?.message || 'Check printer groups, category mappings, and assigned physical printers.',
				duration: 12000,
				action: { label: 'Retry Tickets', onClick: async () => {
					try {
						const retry = await dispatchTickets(retryLines);
						if (retry.ok) {
							toast.success(retry.queued ? `New items for ${orderNumber} queued for printing.` : `New items for ${orderNumber} printed.`);
						} else toast.error('Ticket retry failed. Check printer assignments.');
					} catch (retryError) {
						toast.error(retryError?.message || 'Ticket retry failed. Check printer configuration.');
					}
				}},
			});
			return;
		}
		if (!printResult.ok) {
			const failedAssignments = new Set((printResult.results || []).filter((r) => !r.ok && r.assignmentType).map((r) => r.assignmentType));
			if (failedAssignments.size) retryLines = newLines.filter(item => {
				const category = String(item?.category || '').toLowerCase();
				const center = String(item?.center || '').toLowerCase();
				const drinks = ['drink','drinks','bibite'].includes(category) || center === 'bar';
				return failedAssignments.has(drinks ? 'drinks_orders' : 'food_orders');
			});
			const failures = (printResult.results || []).filter((r) => !r.ok).map((r) => r.friendlyError).filter(Boolean);
			toast.error(`New items for order ${orderNumber} were saved, but one or more tickets did not print.`, {
				description: failures.join(' ') || 'Check printer assignments.',
				duration: 12000,
				action: { label: 'Retry Tickets', onClick: async () => {
					try {
						const retry = await dispatchTickets(retryLines);
						if (retry.ok) {
							toast.success(retry.queued ? `New items for ${orderNumber} queued for printing.` : `New items for ${orderNumber} printed.`);
						} else toast.error('Ticket retry failed. Check printer assignments.');
					} catch (retryError) {
						toast.error(retryError?.message || 'Ticket retry failed. Check printer configuration.');
					}
				}},
			});
			return;
		}

		toast.success(printResult.queued ? `New items for ${orderNumber} queued for the print agent.` : `New items for ${orderNumber} tickets printed.`);
	};

	// A send now leaves the order screen before its KOT snapshot is persisted, so
	// staff can reach the same table again while the first send is still running.
	// Two concurrent sends would create a second KDS order and could write an
	// older sent-item snapshot over the newer one. Only one send per table may be
	// in flight; the store additionally serialises snapshot writes per table.
	const handleSendToKitchen = async () => {
		const table = activeTable;
		if (!table) return;
		if (sendingTablesRef.current.has(table.id)) {
			toast.info('This order is still being sent. Wait for it to finish before sending again.');
			return;
		}
		sendingTablesRef.current.add(table.id);
		try {
			await sendToKitchenNow();
		} finally {
			sendingTablesRef.current.delete(table.id);
		}
	};

	const openTableTransfer = () => {
		if (!activeTable) return;
		setTableTransferTarget(null);
		setTableTransferError('');
		setTableTransferOpen(true);
	};

	const handleTableTransfer = async () => {
		if (!activeTable || !tableTransferTarget || !propertyId) return;
		setTableTransferBusy(true);
		setTableTransferError('');
		try {
			const sourceSession = store.getSession(activeTable.id);
			const mode = tableTransferTarget.occupied ? 'merge' : 'move';
			const result = await posService.moveOrMergeTable({
				propertyId,
				sourceTableKey: activeTable.id,
				targetTableKey: tableTransferTarget.table.id,
				targetTableNumber: tableTransferTarget.table.number,
				mode,
			});
			const session = result?.session;
			if (!session || result?.source_closed !== true || result?.source_session?.status !== 'closed') {
				throw new Error('The table transfer completed without returning the definitive destination and closed source sessions.');
			}
			const nextLines = Array.isArray(session.order_lines) ? session.order_lines : (Array.isArray(session.orderLines) ? session.orderLines : []);
			const target = tableTransferTarget.table;
			orderNumbersRef.current[target.id] = session.order_number || sourceSession?.orderNumber || null;
			setOrderLinesByTable((prev) => {
				const next = { ...prev, [target.id]: nextLines };
				delete next[activeTable.id];
				return next;
			});
			// The RPC already closed the source and wrote the merged/moved state.
			// Reflect both locally instead of waiting for the realtime channel:
			// without this, a slow/offline channel left the source as a ghost order
			// and a later touch on the destination could wipe the server lines.
			store.closeTableLocal(activeTable.id);
			delete orderNumbersRef.current[activeTable.id];
			store.applyServerSession(target.id, session);
			// applyServerSession adopts the complete authoritative row (including
			// KOT and VAT snapshots) without issuing another write. Do not call
			// setSessionOrderLines / setKotSentOrderLines here: those would enqueue
			// a second full-row save immediately after the atomic transaction.
			setActiveTable(target);
			setActiveTab(session.status === 'unsettled' ? 'bill' : 'order');
			setTableTransferOpen(false);
			setTableTransferTarget(null);
			toast.success(mode === 'merge' ? `Tables ${tableLabel(activeTable)} and ${tableLabel(target)} joined.` : `Bill moved to ${tableLabel(target)}.`);
		} catch (error) {
			setTableTransferError(error?.message || 'Could not move or join the table.');
		} finally {
			setTableTransferBusy(false);
		}
	};

	const handleBillRequest = () => {
		if (!activeTable) return;
		store.setUnsettled(activeTable.id);
		setActiveTab('bill');
	};

	const handleConfirmPayment = () => {
		if (!activeTable) return;
		store.closeTable(activeTable.id);
		setOrderLinesByTable((prev) => {
			const next = { ...prev };
			delete next[activeTable.id];
			return next;
		});
		setActiveTable(null);
		setActiveTab('floor');
	};

	if (!propertyId) return <div className="flex h-full items-center justify-center bg-[var(--canvas)] p-6 text-sm text-[var(--text-muted)]">Select an active property before opening POS.</div>;
	if (shiftLoading) return <div className="flex h-full items-center justify-center bg-[var(--canvas)] text-sm text-[var(--text-muted)]">Loading POS shift…</div>;
	if (!posUnlocked) return (
		<POSAccessGate propertyName={propertyName} logoUrl={user?.property?.logo_url} error={posAccessError} busy={posAccessBusy} canManagePin={canManagePosPin} onAdminReset={() => navigate('/pos/access-pin')} onSubmit={verifyPosAccess} />
	);
	if (posPinSetup && canManagePosPin) return (
		<PosPinSetupGate propertyId={propertyId} propertyName={propertyName} reason={posPinSetup} onComplete={handlePosPinSetup} />
	);
	return (
		<div className="flex flex-col h-full overflow-hidden">
			<AppHeader activeTab={activeTab} onTabChange={setActiveTab} activeTable={activeTable} shift={currentShift} hasOpenShift={Boolean(currentShift)} onOpenShifts={() => setActiveTab('shifts')} propertyName={propertyName} onCloseShift={currentShift && canCloseShift ? ()=>setCloseShiftOpen(true) : null} onManageMenu={canCloseShift ? ()=>setMenuManagerOpen(true) : null} onOpenSettings={()=>setSettingsOpen(true)} onSignOut={handlePosSignOut} />

			<div className="flex-1 min-h-0 overflow-y-auto">
				{activeTab === 'shifts' && <ShiftManagementPage propertyId={propertyId} currentShift={currentShift} loadError={shiftLoadError} onOpened={(shift) => { setCurrentShift(shift); setActiveTab('floor'); }} onCloseShift={canCloseShift ? () => setCloseShiftOpen(true) : null} onGoToFloor={() => setActiveTab('floor')} />}
				{activeTab === 'floor' && currentShift && (
					<div className="flex h-full min-h-0 flex-col">
						<div className="min-h-0 flex-1">
							<FloorPlan onTableSelect={handleTableSelect} />
						</div>
						<StaffDock staff={posStaff} activeStaffId={activeStaffId} onSelect={(person) => { setSwitchStaff(person); setSwitchError(''); }} />
						{switchStaff && <PinPad title="Switch POS Staff" staffName={switchStaff.name} error={switchError} onSubmit={verifySwitch} onClose={() => setSwitchStaff(null)} />}
					</div>
				)}

				{activeTab === 'order' && currentShift && activeTable && (
					<OrderTaking
						table={activeTable}
						orderLines={orderLines}
						setOrderLines={setOrderLines}
						onSendToKitchen={handleSendToKitchen}
						onBill={handleBillRequest}
						onMoveTable={openTableTransfer}
						orderNumber={orderNumbersRef.current[activeTable.id]}
					/>
				)}

				{activeTab === 'bill' && currentShift && activeTable && (
					<BillPayment
						table={activeTable}
						orderLines={orderLines}
						onConfirmPayment={handleConfirmPayment}
						onAddOrder={() => setActiveTab('order')}
						onMoveTable={openTableTransfer}
						onBackToFloor={() => { setActiveTable(null); setActiveTab('floor'); }}
						orderNumber={orderNumbersRef.current[activeTable.id]}
						waiter={store.getSession(activeTable.id)?.waiter || ''}
						covers={store.getSession(activeTable.id)?.guests || 1}
						onOpenShifts={() => setActiveTab('shifts')}
					/>
				)}
			</div>


			{tableTransferOpen && activeTable && (
				<div className="fixed inset-0 z-[220] flex items-center justify-center bg-[var(--overlay-scrim)] p-4">
					<div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-surface shadow-2xl">
						<div className="flex items-center justify-between border-b border-border px-5 py-4">
							<div>
								<div className="flex items-center gap-2 text-base font-semibold text-foreground"><ArrowRightLeft size={18}/> Move / Join Table</div>
								<div className="mt-1 text-xs text-muted-foreground">Current bill: <b>{tableLabel(activeTable)}</b>. Select a free table to move it, or an ongoing table to join the bills.</div>
							</div>
							<button type="button" aria-label="Close move or join table dialog" onClick={() => setTableTransferOpen(false)} className="rounded-xl p-2 text-muted-foreground hover:bg-secondary"><X size={18} aria-hidden="true"/></button>
						</div>
						<div className="max-h-[55vh] overflow-y-auto p-5">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
								{store.zones.flatMap(z => z.tables.map(t => ({ table: t, zone: z }))).filter(({table:t}) => t.id !== activeTable.id).map(({table:t, zone}) => {
									const session = store.getSession(t.id);
									const occupied = Boolean(session);
									const selected = tableTransferTarget?.table.id === t.id;
									return (
										<button key={t.id} onClick={() => { setTableTransferTarget({ table:t, zone, occupied, session }); setTableTransferError(''); }} className="rounded-2xl border-2 p-4 text-left transition hover:-translate-y-0.5" style={{ borderColor: selected ? 'var(--primary)' : occupied ? 'var(--warning)' : 'var(--border)', background: selected ? 'var(--primary-soft)' : 'var(--surface)' }}>
											<div className="flex items-center justify-between"><span className="text-lg font-semibold text-foreground">T{t.number}</span>{occupied ? <GitMerge size={17} className="text-[var(--warning-text)]"/> : <MoveRight size={17} className="text-[var(--primary)]"/>}</div>
											<div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{zone.name}</div>
											<div className="mt-2 text-xs font-semibold text-muted-foreground">{occupied ? `Ongoing · ${session?.orderNumber || 'Open bill'}` : 'Free · Move bill here'}</div>
										</button>
									);
								})}
							</div>
							{tableTransferTarget && (
								<div className="mt-5 rounded-2xl border border-border bg-secondary p-4">
									<div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tableTransferTarget.occupied ? 'Join ongoing table' : 'Move bill to free table'}</div>
									<div className="mt-1 text-sm font-bold text-foreground">T{activeTable.number} → T{tableTransferTarget.table.number}</div>
									<div className="mt-1 text-xs text-muted-foreground">{tableTransferTarget.occupied ? 'All items and covers will be combined. The destination check remains the active check and the source table is closed.' : 'The complete open bill, waiter, check number and production status move to the new table. No duplicate kitchen ticket is printed.'}</div>
								</div>
							)}
							{tableTransferError && <div className="mt-3 rounded-xl bg-[var(--danger-soft)] p-3 text-xs font-bold text-[var(--danger-text)]">{tableTransferError}</div>}
						</div>
						<div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
							<div className="text-[11px] font-semibold text-muted-foreground">{tableTransferTarget ? (tableTransferTarget.occupied ? 'Join keeps the destination table open.' : 'Move preserves the current check.') : 'Choose a destination table.'}</div>
							<div className="flex gap-2"><button onClick={() => setTableTransferOpen(false)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={!tableTransferTarget || tableTransferBusy} onClick={handleTableTransfer} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-foreground disabled:opacity-40">{tableTransferBusy ? 'Processing…' : tableTransferTarget?.occupied ? 'Join Tables' : 'Move Bill'}</button></div>
						</div>
					</div>
				</div>
			)}

			{menuManagerOpen && <MenuManager open={menuManagerOpen} onClose={()=>setMenuManagerOpen(false)} />}
			{settingsOpen && <POSSettings user={user} onClose={()=>setSettingsOpen(false)} />}
			{closeShiftOpen && currentShift && <CloseShiftModal shift={currentShift} onClose={() => setCloseShiftOpen(false)} onGoToFloor={() => { setCloseShiftOpen(false); setActiveTab('floor'); }} onClosed={() => { setCloseShiftOpen(false); setCurrentShift(null); setActiveTab('shifts'); }} />}
			<OpenTableDialog
				open={!!pendingTable}
				table={pendingTable}
				staff={posStaff}
				staffError={posStaffError}
				onCancel={() => setPendingTable(null)}
				onStart={handleStartTable}
			/>
		</div>
	);
}
