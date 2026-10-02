import React, { useState, useCallback, useRef, useEffect } from 'react';
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

function buildKitchenTicketText(center, lines, { orderNumber, table, propertyName }) {
	const divider = '-'.repeat(THERMAL_COLUMNS);
	const itemRows = lines.flatMap((line) => wrapTicketLine(`${line.qty}x ${line.name}`));
	return [
		String(propertyName || 'OLITECHS PMS & POS').toUpperCase(),
		divider,
		`${center.toUpperCase()} ORDER TICKET`,
		`ORDER: ${orderNumber}`,
		`TABLE: ${tableLabel(table)}`,
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
	const propertyName = user?.property?.name || user?.property?.business_name || 'OliTechs PMS & POS';
	const [posStaff, setPosStaff] = useState([]);
	const [switchStaff, setSwitchStaff] = useState(null);
	const [switchError, setSwitchError] = useState('');
	useEffect(() => { if (!propertyId) return; authService.listStaff(propertyId, 'pos').then(setPosStaff).catch(() => {}); }, [propertyId]);
	const verifySwitch = async (pin) => { try { const result = await authService.verifyStaffPin({ propertyId, module: 'pos', pin }); if (!result?.ok) { setSwitchError('Wrong PIN'); return; } sessionStorage.setItem('olitech_active_staff_v2', JSON.stringify(result.staff)); window.dispatchEvent(new CustomEvent('olitech:staff-changed', { detail: result.staff })); setSwitchStaff(null); setSwitchError(''); } catch (e) { setSwitchError(e.message); } };
	const [activeTab, setActiveTab] = useState('floor');
	const [activeTable, setActiveTable] = useState(null);
	const [pendingTable, setPendingTable] = useState(null); // table awaiting "open" dialog
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
			store.setSessionOrderLines(table.id, session.orderLines || [], orderNumbersRef.current[table.id]);
		}
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

		const { id: kitchenOrderId, failedCenters } = await store.fireKitchenOrder({
			table, orderLines: linesSnapshot, orderNumber,
			buildTicketText: (center, lines) => buildKitchenTicketText(center, lines, { orderNumber, table, propertyName }),
		});

		if (failedCenters.length === 0) {
			toast.success(`Order ${orderNumber} sent to kitchen.`);
			return;
		}

		toast.error(`Order ${orderNumber} was saved, but the ${failedCenters.join(', ')} ticket didn't print.`, {
			description: 'The order is safe — only the ticket failed to print.',
			duration: 12000,
			action: {
				label: 'Retry Ticket',
				onClick: async () => {
					for (const center of failedCenters) {
						const result = await store.retryKitchenPrint(kitchenOrderId, center, (c, lines) => buildKitchenTicketText(c, lines, { orderNumber, table }));
						if (result.ok) toast.success(`${center} ticket printed.`);
						else toast.error(`${center} ticket still failed: ${result.friendlyError}`);
					}
				},
			},
		});
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
			<AppHeader activeTab={activeTab} onTabChange={setActiveTab} activeTable={activeTable} />

			<div className="flex-1 min-h-0">
				{activeTab === 'floor' && <div className="relative h-full"><FloorPlan onTableSelect={handleTableSelect} /><div className="absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded-2xl border-2 border-[#090C11] bg-white p-2 shadow-lg"><span className="px-1 text-[9px] font-black uppercase tracking-wider text-[#6B7280]">Staff</span>{posStaff.slice(0,8).map(person => <button key={person.id} title={`Switch to ${person.full_name}`} onClick={()=>{setSwitchStaff(person);setSwitchError('');}} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#090C11] bg-[#FFD300] text-[10px] font-black text-[#090C11] hover:scale-105">{person.avatar || person.full_name?.slice(0,2).toUpperCase()}</button>)}</div>{switchStaff&&<PinPad title="Switch POS Staff" staffName={switchStaff.full_name} error={switchError} onSubmit={verifySwitch} onClose={()=>setSwitchStaff(null)}/>}</div>}

				{activeTab === 'order' && activeTable && (
					<OrderTaking
						table={activeTable}
						orderLines={orderLines}
						setOrderLines={setOrderLines}
						onSendToKitchen={handleSendToKitchen}
						onBill={handleBillRequest}
						orderNumber={orderNumbersRef.current[activeTable.id]}
					/>
				)}

				{activeTab === 'bill' && activeTable && (
					<BillPayment
						table={activeTable}
						orderLines={orderLines}
						onConfirmPayment={handleConfirmPayment}
					/>
				)}
			</div>

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
