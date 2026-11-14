import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, GitMerge, X, MoveRight } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/data/AppStore';
import { tableLabel } from '@/lib/posTables';
import AppHeader from '@/components/pos/AppHeader';
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
	const verifySwitch = async (pin) => { try { const result = await authService.verifyStaffPin({ propertyId, module: 'pos', pin }); if (!result?.ok) { setSwitchError('Wrong PIN'); return; } sessionStorage.setItem('olitech_active_staff_v2', JSON.stringify(result.staff)); window.dispatchEvent(new CustomEvent('olitech:staff-changed', { detail: result.staff })); setSwitchStaff(null); setSwitchError(''); } catch (e) { setSwitchError(e.message); } };
	const verifyPosAccess = async (pin) => {
		setPosAccessBusy(true);
		setPosAccessError('');
		try {
			const result = await posAccessService.verifyPin({ propertyId, pin });
			if (!result?.ok) {
				setPosAccessError(result?.message || 'Incorrect POS PIN. Try again.');
				return;
			}
			sessionStorage.setItem(`${POS_ACCESS_KEY}:${propertyId}`, '1');
			setPosUnlocked(true);
		} catch (error) {
			setPosAccessError(error?.message || 'Could not verify the POS PIN. Check your connection.');
		} finally {
			setPosAccessBusy(false);
		}
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
	const orderLines = activeTable ? orderLinesByTable[activeTable.id] || [] : [];
	useEffect(() => {
		if (!activeTable) return;
		const lines = orderLinesByTable[activeTable.id] || [];
		const total = lines.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.qty || 0), 0);
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
	const handleSendToKitchen = async () => {
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
			if (!session) throw new Error('The table transfer completed without returning the new table session.');
			const nextLines = Array.isArray(session.order_lines) ? session.order_lines : (Array.isArray(session.orderLines) ? session.orderLines : []);
			const target = tableTransferTarget.table;
			orderNumbersRef.current[target.id] = session.order_number || sourceSession?.orderNumber || null;
			setOrderLinesByTable((prev) => {
				const next = { ...prev, [target.id]: nextLines };
				delete next[activeTable.id];
				return next;
			});
			// Update the local status first so the subsequent session persistence
			// cannot race with an older "occupied" status after a printed bill join.
			if (session.status === 'unsettled') store.setUnsettled(target.id);
			// Keep the in-memory AppStore session in sync with the atomic database
			// merge. Otherwise reopening the destination can restore its old lines.
			store.setSessionOrderLines(target.id, nextLines, session.order_number || sourceSession?.orderNumber || null);
			store.setKotSentOrderLines(
				target.id,
				Array.isArray(session.kot_sent_order_lines) ? session.kot_sent_order_lines : [],
			).catch((syncError) => console.warn('[POS] joined-table KOT snapshot sync failed', syncError));
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
	return (
		<div className="flex flex-col h-full overflow-hidden">
			<AppHeader activeTab={activeTab} onTabChange={setActiveTab} activeTable={activeTable} shift={currentShift} hasOpenShift={Boolean(currentShift)} onOpenShifts={() => setActiveTab('shifts')} propertyName={propertyName} onCloseShift={currentShift && canCloseShift ? ()=>setCloseShiftOpen(true) : null} onManageMenu={canCloseShift ? ()=>setMenuManagerOpen(true) : null} onOpenSettings={()=>setSettingsOpen(true)} />

			<div className="flex-1 min-h-0 overflow-y-auto">
				{activeTab === 'shifts' && <ShiftManagementPage propertyId={propertyId} currentShift={currentShift} loadError={shiftLoadError} onOpened={(shift) => { setCurrentShift(shift); setActiveTab('floor'); }} onCloseShift={canCloseShift ? () => setCloseShiftOpen(true) : null} />}
				{activeTab === 'floor' && currentShift && <div className="relative h-full"><FloorPlan onTableSelect={handleTableSelect} /><div className="absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded-2xl border-2 border-border bg-surface p-2 shadow-lg"><span className="px-1 text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Staff</span>{posStaff.slice(0,8).map(person => <button key={person.id} title={`Switch to ${person.full_name}`} onClick={()=>{setSwitchStaff(person);setSwitchError('');}} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-border bg-primary text-[10px] font-black text-foreground hover:scale-105">{person.avatar || person.full_name?.slice(0,2).toUpperCase()}</button>)}</div>{switchStaff&&<PinPad title="Switch POS Staff" staffName={switchStaff.full_name} error={switchError} onSubmit={verifySwitch} onClose={()=>setSwitchStaff(null)}/>}</div>}

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
					/>
				)}
			</div>


			{tableTransferOpen && activeTable && (
				<div className="fixed inset-0 z-[220] flex items-center justify-center bg-[var(--overlay-scrim)] p-4">
					<div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-surface shadow-2xl">
						<div className="flex items-center justify-between border-b border-border px-5 py-4">
							<div>
								<div className="flex items-center gap-2 text-base font-black text-foreground"><ArrowRightLeft size={18}/> Move / Join Table</div>
								<div className="mt-1 text-xs text-muted-foreground">Current bill: <b>{tableLabel(activeTable)}</b>. Select a free table to move it, or an ongoing table to join the bills.</div>
							</div>
							<button onClick={() => setTableTransferOpen(false)} className="rounded-xl p-2 text-muted-foreground hover:bg-secondary"><X size={18}/></button>
						</div>
						<div className="max-h-[55vh] overflow-y-auto p-5">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
								{store.zones.flatMap(z => z.tables.map(t => ({ table: t, zone: z }))).filter(({table:t}) => t.id !== activeTable.id).map(({table:t, zone}) => {
									const session = store.getSession(t.id);
									const occupied = Boolean(session);
									const selected = tableTransferTarget?.table.id === t.id;
									return (
										<button key={t.id} onClick={() => { setTableTransferTarget({ table:t, zone, occupied, session }); setTableTransferError(''); }} className="rounded-2xl border-2 p-4 text-left transition hover:-translate-y-0.5" style={{ borderColor: selected ? 'var(--primary)' : occupied ? 'var(--warning)' : 'var(--border)', background: selected ? 'var(--primary-soft)' : 'var(--surface)' }}>
											<div className="flex items-center justify-between"><span className="text-lg font-black text-foreground">T{t.number}</span>{occupied ? <GitMerge size={17} className="text-[var(--warning-text)]"/> : <MoveRight size={17} className="text-[var(--primary)]"/>}</div>
											<div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{zone.name}</div>
											<div className="mt-2 text-xs font-semibold text-muted-foreground">{occupied ? `Ongoing · ${session?.orderNumber || 'Open bill'}` : 'Free · Move bill here'}</div>
										</button>
									);
								})}
							</div>
							{tableTransferTarget && (
								<div className="mt-5 rounded-2xl border border-border bg-secondary p-4">
									<div className="text-xs font-black uppercase tracking-wider text-muted-foreground">{tableTransferTarget.occupied ? 'Join ongoing table' : 'Move bill to free table'}</div>
									<div className="mt-1 text-sm font-bold text-foreground">T{activeTable.number} → T{tableTransferTarget.table.number}</div>
									<div className="mt-1 text-xs text-muted-foreground">{tableTransferTarget.occupied ? 'All items and covers will be combined. The destination check remains the active check and the source table is closed.' : 'The complete open bill, waiter, check number and production status move to the new table. No duplicate kitchen ticket is printed.'}</div>
								</div>
							)}
							{tableTransferError && <div className="mt-3 rounded-xl bg-[var(--danger-soft)] p-3 text-xs font-bold text-[var(--danger-text)]">{tableTransferError}</div>}
						</div>
						<div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
							<div className="text-[11px] font-semibold text-muted-foreground">{tableTransferTarget ? (tableTransferTarget.occupied ? 'Join keeps the destination table open.' : 'Move preserves the current check.') : 'Choose a destination table.'}</div>
							<div className="flex gap-2"><button onClick={() => setTableTransferOpen(false)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={!tableTransferTarget || tableTransferBusy} onClick={handleTableTransfer} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-foreground disabled:opacity-40">{tableTransferBusy ? 'Processing…' : tableTransferTarget?.occupied ? 'Join Tables' : 'Move Bill'}</button></div>
						</div>
					</div>
				</div>
			)}

			{menuManagerOpen && <MenuManager open={menuManagerOpen} onClose={()=>setMenuManagerOpen(false)} />}
			{settingsOpen && <POSSettings user={user} onClose={()=>setSettingsOpen(false)} />}
			{closeShiftOpen && currentShift && <CloseShiftModal shift={currentShift} onClose={() => setCloseShiftOpen(false)} onClosed={() => { setCloseShiftOpen(false); setCurrentShift(null); setActiveTab('shifts'); }} />}
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
