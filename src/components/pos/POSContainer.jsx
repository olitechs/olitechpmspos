import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowRightLeft, GitMerge, X, MoveRight } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/data/AppStore';
import { tableLabel } from '@/data/mockData';
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
import { shiftService } from '@/services/shiftService';
import CloseShiftModal, { OpenShiftModal } from '@/components/pos/CloseShiftModal';
import MenuManager from '@/components/pos/MenuManager';

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
		String(propertyName || 'OLITECHS PMS & POS').toUpperCase(),
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
export default function POSContainer() {
	const store = useStore();
	const { user } = useAuth();
	const propertyId = user?.property?.id;
	const sessionStaff = (() => { try { return JSON.parse(sessionStorage.getItem('olitech_active_staff_v2') || 'null'); } catch { return null; } })();
	const posRole = String(sessionStaff?.role || user?.staff?.role || user?.propertyRole || '').toLowerCase().replace(/\s+/g,'_');
	const canCloseShift = Boolean(user?.isPlatformOwner || ['hotel_admin','super_admin','cashier','fb_manager','owner','admin','manager','property_manager','general_manager'].includes(posRole));
	const propertyName = user?.property?.name || user?.property?.business_name || 'OliTechs PMS & POS';
	const [posStaff, setPosStaff] = useState([]);
	const [switchStaff, setSwitchStaff] = useState(null);
	const [switchError, setSwitchError] = useState('');
	useEffect(() => { if (!propertyId) return; authService.listStaff(propertyId, 'pos').then(setPosStaff).catch(() => {}); shiftService.getCurrentShift(propertyId).then(setCurrentShift).catch(()=>setCurrentShift(null)).finally(()=>setShiftLoading(false)); }, [propertyId]);
	const verifySwitch = async (pin) => { try { const result = await authService.verifyStaffPin({ propertyId, module: 'pos', pin }); if (!result?.ok) { setSwitchError('Wrong PIN'); return; } sessionStorage.setItem('olitech_active_staff_v2', JSON.stringify(result.staff)); window.dispatchEvent(new CustomEvent('olitech:staff-changed', { detail: result.staff })); setSwitchStaff(null); setSwitchError(''); } catch (e) { setSwitchError(e.message); } };
	const [activeTab, setActiveTab] = useState('floor');
	const [activeTable, setActiveTable] = useState(null);
	const [pendingTable, setPendingTable] = useState(null); // table awaiting "open" dialog
	const [tableTransferOpen, setTableTransferOpen] = useState(false);
	const [tableTransferTarget, setTableTransferTarget] = useState(null);
	const [tableTransferBusy, setTableTransferBusy] = useState(false);
	const [tableTransferError, setTableTransferError] = useState('');
	const [currentShift, setCurrentShift] = useState(null);
	const [shiftLoading, setShiftLoading] = useState(true);
	const [closeShiftOpen, setCloseShiftOpen] = useState(false);
	const [menuManagerOpen, setMenuManagerOpen] = useState(false);
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

		setActiveTab('floor');
		setActiveTable(null);

		await store.fireKitchenOrder({
			table, orderLines: linesSnapshot, orderNumber,
			buildTicketText: (center, lines) => buildKitchenTicketText(center, lines, { orderNumber, table, propertyName, waiter: store.getSession(table.id)?.waiter }),
			printTickets: false,
		});

		const printOrder = () => printOrderByCategory({
			propertyId,
			orderNumber,
			checkNo: orderNumber,
			table: tableLabel(table),
			waiter: store.getSession(table.id)?.waiter,
			createdAt: Date.now(),
			items: linesSnapshot,
		});
		const printResult = await printOrder();
		if (!printResult.ok) {
			const failures = (printResult.results || []).filter((r) => !r.ok).map((r) => r.friendlyError).filter(Boolean);
			toast.error(`Order ${orderNumber} was saved, but one or more tickets did not print.`, {
				description: failures.join(' ') || 'Check printer assignments.',
				duration: 12000,
				action: { label: 'Retry Tickets', onClick: async () => {
					const retry = await printOrder();
					if (retry.ok) { await posService.markKotSent({ propertyId, tableKey: table.id }).catch(() => {}); toast.success(`Order ${orderNumber} tickets printed.`); }
					else toast.error('Ticket retry failed. Check printer assignments.');
				}},
			});
			return;
		}

		await posService.markKotSent({ propertyId, tableKey: table.id }).catch((error) => console.warn('[POS] failed to mark KOT sent', error));
		toast.success(`Order ${orderNumber} sent to kitchen/bar printers.`);
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

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<AppHeader activeTab={activeTab} onTabChange={setActiveTab} activeTable={activeTable} shift={currentShift} onCloseShift={canCloseShift ? ()=>setCloseShiftOpen(true) : null} onManageMenu={canCloseShift ? ()=>setMenuManagerOpen(true) : null} />

			<div className="flex-1 min-h-0">
				{activeTab === 'floor' && <div className="relative h-full"><FloorPlan onTableSelect={handleTableSelect} /><div className="absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded-2xl border-2 border-[#090C11] bg-white p-2 shadow-lg"><span className="px-1 text-[9px] font-black uppercase tracking-wider text-[#6B7280]">Staff</span>{posStaff.slice(0,8).map(person => <button key={person.id} title={`Switch to ${person.full_name}`} onClick={()=>{setSwitchStaff(person);setSwitchError('');}} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#090C11] bg-[#FFD300] text-[10px] font-black text-[#090C11] hover:scale-105">{person.avatar || person.full_name?.slice(0,2).toUpperCase()}</button>)}</div>{switchStaff&&<PinPad title="Switch POS Staff" staffName={switchStaff.full_name} error={switchError} onSubmit={verifySwitch} onClose={()=>setSwitchStaff(null)}/>}</div>}

				{activeTab === 'order' && activeTable && (
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

				{activeTab === 'bill' && activeTable && (
					<BillPayment
						table={activeTable}
						orderLines={orderLines}
						onConfirmPayment={handleConfirmPayment}
						onAddOrder={() => setActiveTab('order')}
						onMoveTable={openTableTransfer}
						onBackToFloor={() => { setActiveTable(null); setActiveTab('floor'); }}
						orderNumber={orderNumbersRef.current[activeTable.id]}
						waiter={store.getSession(activeTable.id)?.waiter || ''}
						covers={store.getSession(activeTable.id)?.guests || activeTable.seats}
					/>
				)}
			</div>


			{tableTransferOpen && activeTable && (
				<div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/65 p-4">
					<div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
						<div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
							<div>
								<div className="flex items-center gap-2 text-base font-black text-slate-950"><ArrowRightLeft size={18}/> Move / Join Table</div>
								<div className="mt-1 text-xs text-slate-500">Current bill: <b>{tableLabel(activeTable)}</b>. Select a free table to move it, or an ongoing table to join the bills.</div>
							</div>
							<button onClick={() => setTableTransferOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18}/></button>
						</div>
						<div className="max-h-[55vh] overflow-y-auto p-5">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
								{store.zones.flatMap(z => z.tables.map(t => ({ table: t, zone: z }))).filter(({table:t}) => t.id !== activeTable.id).map(({table:t, zone}) => {
									const session = store.getSession(t.id);
									const occupied = Boolean(session);
									const selected = tableTransferTarget?.table.id === t.id;
									return (
										<button key={t.id} onClick={() => { setTableTransferTarget({ table:t, zone, occupied, session }); setTableTransferError(''); }} className="rounded-2xl border-2 p-4 text-left transition hover:-translate-y-0.5" style={{ borderColor: selected ? '#0E7482' : occupied ? '#F59E0B' : '#E2E8F0', background: selected ? '#ECFEFF' : '#fff' }}>
											<div className="flex items-center justify-between"><span className="text-lg font-black text-slate-950">T{t.number}</span>{occupied ? <GitMerge size={17} className="text-amber-600"/> : <MoveRight size={17} className="text-teal-700"/>}</div>
											<div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{zone.name}</div>
											<div className="mt-2 text-xs font-semibold text-slate-600">{occupied ? `Ongoing · ${session?.orderNumber || 'Open bill'}` : 'Free · Move bill here'}</div>
										</button>
									);
								})}
							</div>
							{tableTransferTarget && (
								<div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
									<div className="text-xs font-black uppercase tracking-wider text-slate-500">{tableTransferTarget.occupied ? 'Join ongoing table' : 'Move bill to free table'}</div>
									<div className="mt-1 text-sm font-bold text-slate-900">T{activeTable.number} → T{tableTransferTarget.table.number}</div>
									<div className="mt-1 text-xs text-slate-500">{tableTransferTarget.occupied ? 'All items and covers will be combined. The destination check remains the active check and the source table is closed.' : 'The complete open bill, waiter, check number and production status move to the new table. No duplicate kitchen ticket is printed.'}</div>
								</div>
							)}
							{tableTransferError && <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{tableTransferError}</div>}
						</div>
						<div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
							<div className="text-[11px] font-semibold text-slate-500">{tableTransferTarget ? (tableTransferTarget.occupied ? 'Join keeps the destination table open.' : 'Move preserves the current check.') : 'Choose a destination table.'}</div>
							<div className="flex gap-2"><button onClick={() => setTableTransferOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={!tableTransferTarget || tableTransferBusy} onClick={handleTableTransfer} className="rounded-xl bg-[#0E7482] px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">{tableTransferBusy ? 'Processing…' : tableTransferTarget?.occupied ? 'Join Tables' : 'Move Bill'}</button></div>
						</div>
					</div>
				</div>
			)}

			{menuManagerOpen && <MenuManager open={menuManagerOpen} onClose={()=>setMenuManagerOpen(false)} />}
			{closeShiftOpen && currentShift && <CloseShiftModal shift={currentShift} onClose={()=>setCloseShiftOpen(false)} onClosed={()=>{setCurrentShift(null);setCloseShiftOpen(false);setActiveTable(null);setActiveTab('floor');}} />}
			{!shiftLoading && !currentShift && propertyId && <OpenShiftModal propertyId={propertyId} onOpened={(s)=>setCurrentShift(s)} />}
			<OpenTableDialog
				open={!!pendingTable}
				table={pendingTable}
				staff={store.staff}
				onCancel={() => setPendingTable(null)}
				onStart={handleStartTable}
			/>
		</div>
	);
}
