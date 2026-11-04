import React, { useEffect, useState, useCallback } from 'react';
import { PackageSearch, Plus, Minus, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { inventoryService } from '@/services/inventoryService';
import FeatureGate from '@/lib/FeatureGate';
import { NAVY, TEAL, TEAL_DARK, SAND, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE } from '@/data/themePalette';

function InventoryInner() {
	const { user } = useAuth();
	const propertyId = user?.property?.id;

	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [name, setName] = useState('');
	const [unit, setUnit] = useState('pcs');
	const [quantity, setQuantity] = useState(0);
	const [threshold, setThreshold] = useState(5);

	const load = useCallback(() => {
		if (!propertyId) return;
		setLoading(true);
		inventoryService
			.listItems(propertyId)
			.then(setItems)
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, [propertyId]);

	useEffect(() => {
		load();
	}, [load]);

	const addItem = async () => {
		if (!name) {
			setError('Item name is required.');
			return;
		}
		try {
			await inventoryService.createItem({ propertyId, name, unit, quantity: Number(quantity) || 0, lowStockThreshold: Number(threshold) || 5 });
			setName(''); setUnit('pcs'); setQuantity(0); setThreshold(5); setError('');
			load();
		} catch (err) {
			setError(err.message);
		}
	};

	const adjust = async (item, delta) => {
		try {
			await inventoryService.adjustStock(item.id, delta, delta > 0 ? 'Manual restock' : 'Manual deduction');
			load();
		} catch (err) {
			setError(err.message);
		}
	};

	return (
		<div className="flex-1 overflow-y-auto p-4" style={{ background: SAND }}>
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<div className="lg:col-span-1 rounded-2xl p-4 h-fit" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
					<div className="flex items-center gap-2 mb-4">
						<PackageSearch size={16} style={{ color: NAVY }} />
						<h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: MUTED }}>New Item</h3>
					</div>

					<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Item name *</label>
					<input value={name} onChange={(e) => setName(e.target.value)}
						className="w-full px-3 py-2.5 rounded-lg mb-3 text-sm outline-none"
						style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }} />

					<div className="grid grid-cols-2 gap-3 mb-3">
						<div>
							<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Unit</label>
							<input value={unit} onChange={(e) => setUnit(e.target.value)}
								className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
								style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }} />
						</div>
						<div>
							<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Starting qty</label>
							<input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
								className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
								style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }} />
						</div>
					</div>

					<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Low-stock alert below</label>
					<input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)}
						className="w-full px-3 py-2.5 rounded-lg mb-4 text-sm outline-none"
						style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }} />

					{error && <div className="text-xs mb-3" style={{ color: DESTRUCTIVE }}>{error}</div>}

					<button onClick={addItem} className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-bold" style={{ background: TEAL, color: 'var(--primary-foreground)' }}>
						<Plus size={14} /> Add Item
					</button>

					<p className="text-xs mt-3" style={{ color: MUTED }}>
						Automatic deduction on POS sale is planned once the POS product catalog moves to the same backend — for now, adjust stock manually here.
					</p>
				</div>

				<div className="lg:col-span-2 rounded-2xl overflow-hidden h-fit" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
					<div className="px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
						<h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: MUTED }}>Stock</h3>
					</div>
					{loading && <div className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>Loading…</div>}
					{!loading && items.length === 0 && <div className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No inventory items yet.</div>}
					{items.map((item) => {
						const low = Number(item.quantity) <= Number(item.low_stock_threshold);
						return (
							<div key={item.id} className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium flex items-center gap-1.5" style={{ color: NAVY }}>
										{item.name}
										{low && <AlertTriangle size={12} style={{ color: DESTRUCTIVE }} aria-label="Low stock" />}
									</div>
									<div className="text-xs" style={{ color: low ? DESTRUCTIVE : MUTED }}>
										{item.quantity} {item.unit} {low ? '· low stock' : ''}
									</div>
								</div>
								<div className="flex items-center gap-1">
									<button onClick={() => adjust(item, -1)} className="p-1.5 rounded-lg" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: DESTRUCTIVE }} aria-label={`Decrease ${item.name}`}>
										<Minus size={14} />
									</button>
									<button onClick={() => adjust(item, 1)} className="p-1.5 rounded-lg" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: TEAL_DARK }} aria-label={`Increase ${item.name}`}>
										<Plus size={14} />
									</button>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

export default function Inventory() {
	return (
		<FeatureGate feature="inventory">
			<InventoryInner />
		</FeatureGate>
	);
}
