import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownRight, ArrowRight, BarChart3, Barcode,
  Boxes, Building2, CalendarDays, CheckCircle2, CircleAlert,
  ClipboardCheck, PackageOpen, RefreshCw, Search, ShoppingCart,
  Truck, XCircle, Eye,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/lib/AuthContext';
import StorekeeperAlertDetails from '@/components/store/StorekeeperAlertDetails';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';
import { storekeeperDashboardService } from '@/services/storekeeperDashboardService';
import {
  departmentComparison, estimateMovementValue, filterProducts, formatBusinessDate, getPeriodRange,
  getStockLocations, makeSalesConsumptionSeries,
  matchesDepartment, matchesLocation, normalizeDepartment, productDepartment, isStockConsumptionMovement,
  summarizeCount, summarizeSalesItems, summarizeStock, summarizeWastage,
} from '@/services/storekeeperDashboardCore';

const PERIODS = [['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom']];
const DEPARTMENTS = ['All', 'Bar', 'Kitchen', 'Housekeeping', 'General'];
const MONEY = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 });

function money(value) {
  return Number.isFinite(Number(value)) ? MONEY.format(Number(value)) : '—';
}

function dateLabel(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short' }).format(new Date(`${date}T00:00:00+03:00`));
}

function localHour(value) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  return Number(parts.find((part) => part.type === 'hour')?.value || 0);
}

function KpiCard({ title, value, detail, to, icon: Icon = Boxes, tone = 'normal' }) {
  const iconClass = tone === 'danger' ? 'text-[var(--danger-text)]' : tone === 'warning' ? 'text-[var(--warning-text)]' : 'text-[var(--primary)]';
  return <Link to={to} className="group min-h-32 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-[var(--primary)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
    <div className="flex items-start justify-between gap-2"><span className="text-xs font-bold leading-5 text-[var(--text-muted)]">{title}</span><Icon size={18} className={iconClass}/></div>
    <div className="mt-2 text-xl font-black leading-tight text-[var(--text)]">{value}</div>
    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] leading-4 text-[var(--text-muted)]"><span>{detail}</span><ArrowRight size={14} className="shrink-0 opacity-0 transition group-hover:opacity-100"/></div>
  </Link>;
}

function Section({ title, eyebrow, action, children, className = '' }) {
  return <section className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm md:p-5 ${className}`}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div>{eyebrow && <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--primary)]">{eyebrow}</div>}<h2 className="mt-1 text-base font-black text-[var(--text)]">{title}</h2></div>{action}</div>
    {children}
  </section>;
}

function EmptyState({ icon: Icon = PackageOpen, title, detail, action }) {
  return <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--canvas)] px-4 py-6 text-center">
    <Icon size={20} className="text-[var(--text-muted)]"/><p className="mt-2 text-sm font-bold text-[var(--text)]">{title}</p><p className="mt-1 max-w-xl text-xs leading-5 text-[var(--text-muted)]">{detail}</p>{action}
  </div>;
}

function ErrorNote({ message }) {
  if (!message) return null;
  return <p className="mt-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger-text)]" role="status">Data unavailable: {message}</p>;
}

function deriveAlerts({ products, expiry, movements, today, department, location, movementTruncated }) {
  const items = [];
  const scoped = products.filter((product) => matchesDepartment(product, department) && matchesLocation(product, location));
  const movementByProduct = new Map();
  for (const movement of movements) {
    const id = movement.product_id;
    if (!id) continue;
    const previous = movementByProduct.get(id);
    if (!previous || new Date(movement.created_at) > new Date(previous.created_at)) movementByProduct.set(id, movement);
  }
  const usage7 = new Map();
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 6);
  const recentFrom = from.toISOString().slice(0, 10);
  for (const movement of movements) {
    if (!isStockConsumptionMovement(movement)) continue;
    const day = formatBusinessDate(movement.created_at);
    if (day < recentFrom || day > today) continue;
    usage7.set(movement.product_id, (usage7.get(movement.product_id) || 0) + Math.abs(Number(movement.signed_qty ?? movement.qty) || 0));
  }
  const addProduct = (product, type, severity, message) => items.push({ id: `${type}-${product.id}`, product, type, severity, message });

  for (const product of scoped) {
    const stock = Number(product.current_stock) || 0;
    const min = Number(product.min_stock) || 0;
    const max = Number(product.max_stock) || 0;
    if (stock < 0) addProduct(product, 'negative-stock', 'critical', `Negative balance: ${stock} ${product.unit || 'units'}`);
    else if (stock === 0) addProduct(product, 'out-of-stock', 'critical', 'Out of stock');
    else if (min > 0 && stock <= min / 2) addProduct(product, 'critical-low', 'high', `Critical low · ${stock} ${product.unit || 'units'} on hand`);
    else if (min > 0 && stock <= min) addProduct(product, 'reorder', 'medium', `Below reorder level · minimum ${min}`);
    if (max > 0 && stock > max) addProduct(product, 'overstock', 'low', `Above maximum/par guide · ${stock} vs ${max}`);
    const consumed = usage7.get(product.id) || 0;
    if (consumed > 0 && stock > 0) {
      const daysLeft = stock / (consumed / 7);
      if (daysLeft <= 7) addProduct(product, 'fast-mover', 'high', `About ${Math.max(1, Math.floor(daysLeft))} days of stock left at the last 7-day issue rate`);
    }
    if (!movementTruncated && stock > 0 && !movementByProduct.has(product.id)) addProduct(product, 'slow-moving', 'low', 'No stock movement recorded in the last 30 days');
  }

  const productIds = new Set(scoped.map((product) => product.id));
  for (const row of expiry.filter((item) => productIds.has(item.product_id))) {
    if (row.expiry_status === 'expired') items.push({ id: `expired-${row.product_id}`, product: scoped.find((product) => product.id === row.product_id), type: 'expired', severity: 'critical', expiryDate: row.expiry_date, message: `Expired · ${row.expiry_date || 'date not set'}` });
    else if (row.expiry_status === 'expiring_soon') items.push({ id: `expiry-${row.product_id}`, product: scoped.find((product) => product.id === row.product_id), type: 'expiry', severity: 'high', expiryDate: row.expiry_date, message: `Expires within 7 days · ${row.expiry_date || 'date not set'}` });
  }
  for (const movement of movements) {
    if (formatBusinessDate(movement.created_at) !== today || !movement.product || !matchesDepartment(movement.product, department) || !matchesLocation(movement.product, location)) continue;
    const hour = localHour(movement.created_at);
    if (hour < 6 || hour >= 22) items.push({ id: `after-hours-${movement.id}`, product: movement.product, type: 'after-hours', severity: 'medium', message: `Movement recorded at ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' }).format(new Date(movement.created_at))} EAT` });
  }
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 12);
}

function getCurrentValueByDepartment(valuation, products, { department, location }) {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const totals = new Map(['Bar', 'Kitchen', 'Housekeeping', 'General'].map((name) => [name, 0]));
  for (const row of valuation) {
    const product = productMap.get(row.product_id);
    if (!product || !matchesDepartment(product, department) || !matchesLocation(product, location)) continue;
    const name = productDepartment(product);
    totals.set(name, (totals.get(name) || 0) + (Number(row.stock_value) || 0));
  }
  return [...totals].map(([departmentName, value]) => ({ department: departmentName, value }));
}

export default function StorekeeperDashboard() {
  const { user } = useAuth();
  const staffRole = getSessionStaff()?.role || user?.staff?.role || user?.propertyRole || user?.role;
  const role = normalizeStaffRole(staffRole);
  const canSeeCosts = ['store_manager', 'hotel_admin', 'super_admin'].includes(role) || user?.isPlatformOwner;
  const propertyId = user?.property?.id;
  const propertyName = user?.property?.business_name || user?.property?.name || 'Current property';
  const today = useMemo(() => formatBusinessDate(), []);
  const [period, setPeriod] = useState('today');
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [department, setDepartment] = useState('All');
  const [location, setLocation] = useState('All locations');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const range = useMemo(() => getPeriodRange(period, today, customFrom, customTo), [period, today, customFrom, customTo]);
  const weekFrom = useMemo(() => getPeriodRange('week', today).from, [today]);
  const monthFrom = `${today.slice(0, 7)}-01`;
  const query = useQuery({
    queryKey: ['storekeeper-dashboard', propertyId, today, period, range.from, range.to, canSeeCosts],
    queryFn: () => storekeeperDashboardService.load(propertyId, { today, weekFrom, monthFrom, ...range, includeCosts: Boolean(canSeeCosts) }),
    enabled: Boolean(propertyId),
    staleTime: 30_000,
    retry: 1,
  });
  const data = query.data;
  const products = data?.products || [];
  const scopedProducts = useMemo(() => filterProducts(products, { department, location }), [products, department, location]);
  const searchResults = useMemo(() => filterProducts(products, { department, location, search }).slice(0, 6), [products, department, location, search]);
  const stockSummary = useMemo(() => summarizeStock(products, data?.expiry || [], { department, location }), [products, data?.expiry, department, location]);
  const productIds = useMemo(() => new Set(scopedProducts.map((product) => product.id)), [scopedProducts]);
  const valuation = useMemo(() => (data?.valuation || []).filter((row) => productIds.has(row.product_id)), [data?.valuation, productIds]);
  const currentValue = valuation.reduce((sum, row) => sum + (Number(row.stock_value) || 0), 0);
  const scopedMovements = useMemo(() => (data?.movements || []).filter((movement) => {
    const product = movement.product || products.find((entry) => entry.id === movement.product_id);
    const day = formatBusinessDate(movement.created_at);
    return day >= range.from && day <= range.to && matchesDepartment(product, department) && matchesLocation(product, location);
  }), [data?.movements, products, range.from, range.to, department, location]);
  const alerts = useMemo(() => deriveAlerts({ products, expiry: data?.expiry || [], movements: data?.movements || [], today, department, location, movementTruncated: data?.movementTruncated }), [products, data?.expiry, data?.movements, data?.movementTruncated, today, department, location]);
  const lastCount = useMemo(() => summarizeCount(data?.counts || []), [data?.counts]);
  const salesItems = useMemo(() => summarizeSalesItems(data?.salesItems || []).filter((item) => department === 'All' || item.department === department), [data?.salesItems, department]);
  const wastedItems = useMemo(() => summarizeWastage(data?.wastage || []).filter((item) => department === 'All' || item.department === department), [data?.wastage, department]);
  const topValueItems = useMemo(() => valuation.map((row) => ({ ...row, value: Number(row.stock_value) || 0 })).sort((a, b) => b.value - a.value).slice(0, 10), [valuation]);
  const stockValueByDepartment = useMemo(() => getCurrentValueByDepartment(data?.valuation || [], products, { department, location }), [data?.valuation, products, department, location]);
  const selectedSalesDetail = data?.salesDetail || { daily: [], departments: [] };
  const chartFrom = range.from < (data?.movementCoverageFrom || range.from) ? data.movementCoverageFrom : range.from;
  const series = useMemo(() => makeSalesConsumptionSeries({ from: chartFrom, to: range.to < today ? range.to : today, salesDaily: selectedSalesDetail.daily || [], movements: scopedMovements }), [chartFrom, range.to, today, selectedSalesDetail.daily, scopedMovements]);
  const deptComparison = useMemo(() => departmentComparison(selectedSalesDetail.departments || [], scopedMovements), [selectedSalesDetail.departments, scopedMovements]);
  const locations = useMemo(() => getStockLocations(products), [products]);
  const purchaseRows = data?.purchases || [];
  const openOrders = purchaseRows.filter((order) => ['pending', 'open', 'partial', 'ordered', 'approved'].includes(String(order.status || '').toLowerCase()));
  const inTransit = (data?.transfers || []).filter((transfer) => ['pending', 'in_transit', 'awaiting_confirmation', 'sent', 'submitted'].includes(String(transfer.status || '').toLowerCase()));
  const todayIssueValue = (data?.movements || []).filter((movement) => {
    const product = movement.product || products.find((entry) => entry.id === movement.product_id);
    return formatBusinessDate(movement.created_at) === today && isStockConsumptionMovement(movement) && matchesDepartment(product, department) && matchesLocation(product, location);
  }).reduce((sum, movement) => {
    const product = products.find((entry) => entry.id === movement.product_id);
    return sum + (estimateMovementValue({ ...movement, product: { ...product, ...movement.product } }) || 0);
  }, 0);
  const todayWasteValue = (data?.wastageToday || []).reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.product?.cost_price) || 0), 0);
  const salesToday = Number(data?.salesToday?.sales?.pos_net);
  const salesWeek = Number(data?.salesWeek?.sales?.pos_net);
  const salesMonth = Number(data?.salesMonth?.sales?.pos_net);
  const todayDepartmentRows = data?.salesTodayDetail?.departments || [];
  const barSales = todayDepartmentRows.filter((row) => normalizeDepartment(row.department) === 'Bar').reduce((sum, row) => sum + (Number(row.revenue) || 0), 0);
  const kitchenSales = todayDepartmentRows.filter((row) => normalizeDepartment(row.department) === 'Kitchen').reduce((sum, row) => sum + (Number(row.revenue) || 0), 0);
  const lastCountLabel = lastCount ? `${money(lastCount.estimatedVarianceValue)} est.` : 'No approved count';
  const activePropertyName = user?.property?.name || propertyName;

  if (!propertyId) return <div className="min-h-full bg-[var(--canvas)] p-4 md:p-6"><EmptyState icon={Building2} title="No active property" detail="A property context is required to load store and inventory records."/></div>;

  return <div className="min-h-full space-y-5 bg-[var(--canvas)] p-4 text-[var(--text)] md:p-6">
    <header className="flex flex-col justify-between gap-4 rounded-2xl bg-[var(--deep-lagoon)] p-5 text-[var(--white)] md:flex-row md:items-center md:p-6">
      <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[var(--soft-white)]"><Boxes size={15}/> OliTechs · Stores</div><h1 className="mt-2 text-2xl font-black md:text-3xl">Storekeeper Dashboard</h1><p className="mt-1 text-sm text-[var(--soft-white)]">Stock, purchasing, movements and daily operations for {activePropertyName}.</p></div>
      <div className="flex flex-wrap items-center gap-2"><span className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--white)] px-3 text-sm font-bold text-[var(--deep-lagoon)]"><CalendarDays size={16}/>{new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium' }).format(new Date(`${today}T00:00:00+03:00`))}</span><button type="button" onClick={() => query.refetch()} disabled={query.isFetching} className="inline-flex h-10 items-center gap-2 rounded-xl border border-soft-white/40 px-3 text-sm font-bold text-[var(--white)] hover:bg-soft-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--white)] disabled:opacity-60"><RefreshCw size={15} className={query.isFetching ? 'animate-spin' : ''}/> Refresh</button></div>
    </header>

    <section aria-label="Dashboard filters" className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm md:grid-cols-2 xl:grid-cols-6">
      <div className="min-w-0 rounded-xl bg-[var(--sidebar)] px-3 py-2"><div className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Active business</div><div className="mt-1 flex items-center gap-2 text-sm font-bold" title={propertyName}><Building2 size={15} className="shrink-0 text-[var(--primary)]"/><span className="truncate">{propertyName}</span></div><p className="mt-1 text-[10px] text-[var(--text-muted)]">Single property in current account</p></div>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Stock location</span><select value={location} onChange={(event) => setLocation(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--input-border)] bg-[var(--surface)] px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"><option>All locations</option>{locations.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Period</span><select value={period} onChange={(event) => setPeriod(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--input-border)] bg-[var(--surface)] px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">{PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">Department</span><select value={department} onChange={(event) => setDepartment(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--input-border)] bg-[var(--surface)] px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">{DEPARTMENTS.map((item) => <option key={item}>{item}</option>)}</select></label>
      {period === 'custom' && <div className="grid grid-cols-2 gap-2 md:col-span-2 xl:col-span-2"><label><span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">From</span><input aria-label="Custom period from" type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--input-border)] bg-[var(--surface)] px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"/></label><label><span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">To</span><input aria-label="Custom period to" type="date" value={customTo} min={customFrom} max={today} onChange={(event) => setCustomTo(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--input-border)] bg-[var(--surface)] px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"/></label></div>}
      <div className="relative min-w-0 md:col-span-2 xl:col-span-2"><label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]" htmlFor="storekeeper-global-search">Global item search · scan barcode</label><div className="flex h-10 items-center gap-2 rounded-xl border border-[var(--input-border)] bg-[var(--surface)] px-3 focus-within:ring-2 focus-within:ring-[var(--focus)]"><Search size={16} className="shrink-0 text-[var(--text-muted)]"/><input id="storekeeper-global-search" value={search} onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === 'Enter') setSearchOpen(true); if (event.key === 'Escape') setSearchOpen(false); }} placeholder="Name, SKU or scanner input…" autoComplete="off" className="min-w-0 flex-1 bg-transparent text-sm outline-none"/><Barcode size={17} className="shrink-0 text-[var(--primary)]"/><button type="button" aria-label="Clear product search" onClick={() => { setSearch(''); setSearchOpen(false); }} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--sidebar)]"><XCircle size={15}/></button></div>
        {searchOpen && search.trim() && <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">{searchResults.length ? searchResults.map((product) => <Link key={product.id} to={`/stores/stock?tab=products&search=${encodeURIComponent(product.name || product.sku || '')}`} onClick={() => setSearchOpen(false)} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-[var(--primary-soft)]"><span className="min-w-0"><span className="block truncate font-bold">{product.name}</span><span className="text-xs text-[var(--text-muted)]">{product.sku || 'No SKU'} · {product.location || 'Location not set'}</span></span><span className="shrink-0 text-xs font-bold">{Number(product.current_stock) || 0} {product.unit || ''}</span></Link>) : <p className="p-3 text-xs text-[var(--text-muted)]">No matching item. Try the barcode, name or SKU.</p>}</div>}
      </div>
    </section>
    <p className="-mt-3 px-1 text-[11px] leading-4 text-[var(--text-muted)]">Business/branch switching is not exposed by the current account context (one active property). This selector filters product, valuation and product-linked alert views by saved stock location; ledger rows do not yet store a consistent branch/location field.</p>

    {query.isLoading && <div role="status" aria-live="polite" className="space-y-4"><div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm font-semibold text-[var(--text-muted)]">Loading Storekeeper dashboard…</div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)]"/>)}</div></div>}
    {query.isError && <div role="alert" className="rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-5"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 text-[var(--danger-text)]"/><div><h2 className="font-black text-[var(--danger-text)]">Dashboard data could not be loaded</h2><p className="mt-1 text-sm text-[var(--text)]">{query.error?.message || 'Please retry the property-scoped dashboard request.'}</p><button type="button" onClick={() => query.refetch()} className="mt-3 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-bold text-[var(--on-primary)]">Retry</button></div></div></div>}

    {data && <>
      {Object.keys(data.errors || {}).length > 0 && <div role="status" className="rounded-xl border border-[var(--status-deposit-paid)] bg-[var(--warning-soft)] px-4 py-3 text-xs leading-5 text-[var(--warning-text)]"><strong>Some dashboard sections are incomplete.</strong> A source query failed; affected panels are labelled below. Metrics are not substituted with sample data.</div>}
      <section aria-label="Key performance indicators" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <KpiCard title="Total stock value · current" value={canSeeCosts ? money(currentValue) : 'Restricted'} detail={canSeeCosts ? 'Week/month change unavailable · no valuation snapshots' : 'Cost permission required'} to="/stores/inventory/valuation" icon={Boxes}/>
        <KpiCard title="Today’s POS sales" value={Number.isFinite(salesToday) ? money(salesToday) : 'Unavailable'} detail={`Bar ${money(barSales)} · Kitchen ${money(kitchenSales)}`} to="/stores/reports/sales" icon={BarChart3} tone="normal"/>
        <KpiCard title="Issued / consumed / wasted · today" value={canSeeCosts ? money(todayIssueValue + todayWasteValue) : 'Restricted'} detail={canSeeCosts ? `Issue/consume ~${money(todayIssueValue)} · waste ~${money(todayWasteValue)} at current cost` : 'Cost permission required'} to="/stores/inventory/history" icon={ArrowDownRight} tone="warning"/>
        <KpiCard title="Cost of goods sold" value="Unavailable" detail={`Today ${money(salesToday)} · week ${money(salesWeek)} · month ${money(salesMonth)} sales bases; COGS snapshots are missing`} to="/stores/reports/inventory" icon={PercentIcon} tone="warning"/>
        <KpiCard title="Reorder / out of stock / expiry" value={`${stockSummary.belowReorder} / ${stockSummary.outOfStock} / ${stockSummary.expiring}`} detail={`${stockSummary.criticalLow} critical low · item-level expiry only`} to="/stores/stock-alerts" icon={AlertTriangle} tone={stockSummary.outOfStock ? 'danger' : 'warning'}/>
        <KpiCard title="Open purchase orders" value={data.errors.purchases ? 'Unavailable' : String(openOrders.length)} detail="Expected delivery date is not stored" to="/stores/purchasing" icon={ShoppingCart}/>
        <KpiCard title="Pending requisitions" value="Not configured" detail="No requisition entity/workflow in current schema" to="/stores/requisitions" icon={ClipboardCheck} tone="warning"/>
        <KpiCard title="Transfers in transit" value={data.errors.transfers ? 'Unavailable' : String(inTransit.length)} detail="Pending / sent / awaiting confirmation" to="/stores/transfers" icon={Truck}/>
        <KpiCard title="Last approved count variance" value={canSeeCosts ? lastCountLabel : 'Restricted'} detail={lastCount ? `Qty Δ ${lastCount.varianceQty.toLocaleString('en-KE')} · ${lastCount.variancePercent == null ? '—' : `${lastCount.variancePercent.toFixed(1)}%`} · current-cost estimate` : 'No approved inventory count found'} to="/stores/inventory/counts" icon={ClipboardCheck} tone={lastCount?.varianceQty ? 'warning' : 'normal'}/>
      </section>

      <Section title="Stock alerts" eyebrow="Prioritised · current on-hand and recorded activity" action={<span className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--deep-lagoon)]">{alerts.length} shown</span>}>
        <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-bold"><span className="rounded-full bg-[var(--status-not-paid)] px-2 py-1 text-[var(--status-not-paid-foreground)]">Critical</span><span className="rounded-full bg-[var(--status-deposit-paid)] px-2 py-1 text-[var(--status-deposit-foreground)]">Action soon</span><span className="rounded-full bg-[var(--primary-soft)] px-2 py-1 text-[var(--deep-lagoon)]">Watch</span></div>
        {data.errors.products ? <EmptyState icon={CircleAlert} title="Stock alerts could not be loaded" detail={data.errors.products}/> : alerts.length === 0 ? <EmptyState title="No active alerts for these filters" detail={products.length ? 'No current out-of-stock, reorder, expiry or recorded-movement alert matches this view.' : 'Add products with stock and reorder thresholds to start monitoring.'} action={<Link to="/stores/stock?tab=products" className="mt-3 inline-flex h-10 items-center rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-[var(--on-primary)]">Manage items</Link>}/> : <div className="space-y-2">{alerts.map((alert) => <div key={alert.id} className="grid gap-3 rounded-xl border border-[var(--border)] p-3 transition-colors hover:border-[var(--primary)] hover:bg-[var(--canvas)] lg:grid-cols-[minmax(0,1fr)_auto]">
          <button type="button" onClick={() => setSelectedAlert(alert)} aria-label={`Inspect ${alert.product?.name || 'inventory activity'}: ${alert.message}`} className="group flex min-w-0 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${alert.severity === 'critical' ? 'bg-[var(--status-not-paid)] text-[var(--status-not-paid-foreground)]' : alert.severity === 'high' ? 'bg-[var(--status-deposit-paid)] text-[var(--status-deposit-foreground)]' : 'bg-[var(--primary-soft)] text-[var(--deep-lagoon)]'}`}><AlertTriangle size={15}/></span>
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-black text-[var(--text)] group-hover:text-[var(--primary)]">{alert.product?.name || 'Inventory activity'}</span><span className="rounded-full bg-[var(--sidebar)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-muted)]">{alert.type.replaceAll('-', ' ')}</span></span><span className="mt-1 block text-xs text-[var(--text-muted)]">{alert.message}{alert.product ? ` · ${Number(alert.product.current_stock) || 0} ${alert.product.unit || 'units'} on hand` : ''}</span><span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[var(--primary)]"><Eye size={12}/> Inspect item details <ArrowRight size={12}/></span></span>
          </button>
          <div className="flex flex-wrap items-center gap-1.5 lg:justify-end"><Link to="/stores/purchasing" className="inline-flex min-h-9 items-center rounded-lg bg-[var(--primary)] px-2.5 text-[10px] font-bold text-[var(--on-primary)]">Raise PO</Link><Link to="/stores/transfers" className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] px-2.5 text-[10px] font-bold">Transfer stock</Link><Link to="/stores/inventory/counts" className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] px-2.5 text-[10px] font-bold">Start count</Link><Link to="/stores/requisitions" className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] px-2.5 text-[10px] font-bold">Create requisition</Link><button type="button" disabled title="Alert dismissal notes are not persisted by the current schema." className="inline-flex min-h-9 cursor-not-allowed items-center rounded-lg border border-[var(--border)] px-2.5 text-[10px] font-bold text-[var(--text-muted)] opacity-60">Dismiss with note</button></div>
        </div>)}</div>}
        <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--canvas)] p-3 text-xs leading-5 text-[var(--text-muted)]"><strong className="text-[var(--text)]">Not yet measurable:</strong> batch expiry, a separate par level, price-jump baselines, requisition-linked issues, large-adjustment thresholds and wastage-spike baselines are not represented consistently in the current data model. Historical movement value uses today’s product cost and is an estimate only.</div>
      </Section>
      <StorekeeperAlertDetails alert={selectedAlert} open={Boolean(selectedAlert)} onOpenChange={(open) => { if (!open) setSelectedAlert(null); }} canSeeCosts={Boolean(canSeeCosts)}/>

      <section className="grid gap-4 xl:grid-cols-2">
        <Section title="Today’s deliveries" eyebrow="Expected vs received"><ErrorNote message={data.errors.deliveries}/>{data.errors.deliveries ? null : data.goodsReceipts.length ? <div className="space-y-2">{data.goodsReceipts.map((receipt) => <div key={receipt.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] p-3"><div><p className="text-sm font-bold">{receipt.grn_no || 'Goods receipt'}</p><p className="text-xs text-[var(--text-muted)]">Received {new Date(receipt.received_at).toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' })} EAT · {(receipt.goods_receipt_lines || []).length} line(s)</p></div><span className="rounded-full bg-[var(--status-paid)] px-2 py-1 text-[10px] font-bold text-[var(--white)]">Received</span></div>)}</div> : <EmptyState icon={Truck} title="No goods receipts recorded today" detail="Purchase orders do not currently store an expected delivery date, so expected/late status cannot be calculated." action={<Link to="/stores/purchasing" className="mt-3 inline-flex h-9 items-center rounded-lg bg-[var(--primary)] px-3 text-xs font-bold text-[var(--on-primary)]">Open purchasing</Link>}/>}</Section>
        <Section title="Open requisitions" eyebrow="Approval / issue queue"><EmptyState icon={ClipboardCheck} title="Requisition workflow not configured" detail="The current database has no requisition table, approval queue or issue linkage. No zero-count is implied." action={<Link to="/stores/requisitions" className="mt-3 inline-flex h-9 items-center rounded-lg border border-[var(--border)] px-3 text-xs font-bold">View capability status</Link>}/></Section>
        <Section title="Transfers awaiting confirmation" eyebrow={`${inTransit.length} pending`} action={<Link to="/stores/transfers" className="text-xs font-bold text-[var(--primary)] hover:underline">Open transfers</Link>}>
          <ErrorNote message={data.errors.transfers}/>{data.errors.transfers ? null : inTransit.length ? <div className="space-y-2">{inTransit.slice(0, 6).map((transfer) => <div key={transfer.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{transfer.reference || transfer.transfer_no || `Transfer ${String(transfer.id).slice(0, 8)}`}</p><p className="text-xs text-[var(--text-muted)]">{transfer.from_location_name || transfer.source_location_id || 'Source'} → {transfer.to_location_name || transfer.destination_location_id || 'Destination'}</p></div><span className="rounded-full bg-[var(--status-deposit-paid)] px-2 py-1 text-[10px] font-bold text-[var(--status-deposit-foreground)]">{transfer.status}</span></div>)}</div> : <EmptyState icon={CheckCircle2} title="No transfers awaiting confirmation" detail="There are no pending or in-transit transfer records for this property."/>}
        </Section>
        <Section title="Recent stock movements" eyebrow="Property-wide activity" action={<Link to="/stores/inventory/history" className="text-xs font-bold text-[var(--primary)] hover:underline">View history</Link>}>
          <ErrorNote message={data.errors.movements}/>{data.errors.movements ? null : scopedMovements.length ? <div className="space-y-2">{[...scopedMovements].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 7).map((movement) => <div key={movement.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-[var(--border)] pb-2 last:border-0"><div className="min-w-0"><p className="truncate text-sm font-bold">{movement.product?.name || products.find((item) => item.id === movement.product_id)?.name || 'Stock item'}</p><p className="truncate text-[11px] text-[var(--text-muted)]">{movement.user_profile?.full_name || movement.user_profile?.email || 'Staff not recorded'} · {movement.source_type || movement.reason || movement.type || 'Movement'} · location not recorded in ledger</p></div><div className="text-right"><p className="text-sm font-black">{movement.type === 'in' || movement.type === 'opening' || movement.type === 'transfer_in' ? '+' : '−'}{Math.abs(Number(movement.signed_qty ?? movement.qty) || 0)}</p><p className="text-[10px] text-[var(--text-muted)]">{new Date(movement.created_at).toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' })} EAT</p></div></div>)}</div> : <EmptyState title="No recent stock movements" detail="Ledger rows will appear here when goods receipts, usage, transfers, counts or adjustments are posted."/>}
        </Section>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Section title="Daily sales vs stock consumption" eyebrow={period === 'today' ? 'Today' : `${dateLabel(chartFrom)}–${dateLabel(range.to)}`}><ErrorNote message={data.errors.salesDetail || data.errors.movements}/>{data.errors.salesDetail || data.errors.movements ? null : series.length ? <><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={series} margin={{ top: 8, right: 10, left: -12, bottom: 8 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3"/><XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fill: 'var(--text-muted)', fontSize: 10 }}/><YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }}/><Tooltip formatter={(value, name) => [money(value), name === 'sales' ? 'POS sales' : 'Recorded usage estimate']} labelFormatter={dateLabel}/><Legend formatter={(value) => value === 'sales' ? 'POS sales' : 'Recorded stock-use value estimate'}/><Bar dataKey="sales" name="sales" fill="var(--primary)" radius={[4,4,0,0]}/><Bar dataKey="consumptionEstimate" name="consumption" fill="var(--accent)" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div><p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">Stock-use value is estimated at current product cost, not movement-time cost. It is not an audit-grade COGS reconciliation.</p></> : <EmptyState title="No sales or stock-use records for this period" detail="The chart is built from posted POS receipts and recorded usage/recipe movements; missing rows are not filled with sample data."/>}</Section>
        <Section title="Stock value by department" eyebrow="Current snapshot · historical trend unavailable"><ErrorNote message={data.errors.valuation}/>{!canSeeCosts ? <EmptyState icon={CircleAlert} title="Cost view restricted" detail="Your role does not have the current UI permission to view purchase costs or stock valuation."/> : data.errors.valuation ? null : <><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={stockValueByDepartment} margin={{ top: 8, right: 12, left: -10, bottom: 8 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3"/><XAxis dataKey="department" tick={{ fill: 'var(--text-muted)', fontSize: 11 }}/><YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }}/><Tooltip formatter={(value) => money(value)}/><Bar dataKey="value" name="Current value" fill="var(--coastal-teal)" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div><p className="mt-2 text-xs text-[var(--text-muted)]">Current value is the only supported snapshot. Week/month history is unavailable because valuation snapshots are not stored.</p></>}</Section>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Section title="Top 10 selling items" eyebrow="Posted POS receipts"><ErrorNote message={data.errors.salesItems}/>{data.errors.salesItems ? null : salesItems.length ? <RankedList rows={salesItems.map((item) => ({ name: item.name, metric: `${item.qty.toLocaleString('en-KE')} sold`, secondary: money(item.revenue) }))}/> : <EmptyState title="No item-level sales found" detail="Posted receipts in the selected period contain no item rows, or the current selection has no sales."/>}</Section>
        <Section title="Top 10 wasted items" eyebrow="Recorded wastage"><ErrorNote message={data.errors.wastage}/>{data.errors.wastage ? null : wastedItems.length ? <RankedList rows={wastedItems.map((item) => ({ name: item.name, metric: `${item.qty.toLocaleString('en-KE')} units`, secondary: canSeeCosts ? `~${money(item.estimatedValue)}` : 'Cost restricted' }))}/> : <EmptyState title="No wastage records for this period" detail="Only posted inventory-wastage records are included."/>}</Section>
        <Section title="Top 10 highest-value items" eyebrow="Current valuation"><ErrorNote message={data.errors.valuation}/>{!canSeeCosts ? <EmptyState title="Cost view restricted" detail="Your role does not have current UI permission to view stock value."/> : data.errors.valuation ? null : topValueItems.length ? <RankedList rows={topValueItems.map((item) => ({ name: item.name || products.find((product) => product.id === item.product_id)?.name || 'Stock item', metric: `${Number(item.current_stock) || 0} ${item.unit || ''}`, secondary: money(item.stock_value) }))}/> : <EmptyState title="No valued stock items" detail="Add products and current cost/on-hand values to see this list."/>}</Section>
        <Section title="Usage vs POS sales by department" eyebrow="Directional comparison"><ErrorNote message={data.errors.salesDetail || data.errors.movements}/>{data.errors.salesDetail || data.errors.movements ? null : <><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={deptComparison} margin={{ top: 8, right: 10, left: -12, bottom: 8 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3"/><XAxis dataKey="department" tick={{ fill: 'var(--text-muted)', fontSize: 10 }}/><YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }}/><Tooltip formatter={(value, name) => [money(value), name === 'sales' ? 'POS sales' : 'Recorded use estimate']}/><Legend formatter={(value) => value === 'sales' ? 'POS sales' : 'Recorded stock-use estimate'}/><Bar dataKey="sales" name="sales" fill="var(--primary)" radius={[4,4,0,0]}/><Bar dataKey="usageEstimate" name="usage" fill="var(--accent)" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div><p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">Directional only: recipe/BOM and department/source mappings are not sufficient to treat this as a reconciled variance chart.</p></>}</Section>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--sidebar)] px-4 py-3 text-[11px] leading-5 text-[var(--text-muted)]"><span>Period: <strong className="text-[var(--text)]">{dateLabel(range.from)} – {dateLabel(range.to)}</strong> · Department: <strong className="text-[var(--text)]">{department}</strong> · Location: <strong className="text-[var(--text)]">{location}</strong></span><span>{data.movementTruncated ? `Movement history capped; complete window starts ${dateLabel(data.movementCoverageFrom)}.` : 'Values sourced from the active property; estimated cost fields are labelled.'}</span></footer>
    </>}
  </div>;
}

function RankedList({ rows }) {
  return <ol className="space-y-1">{rows.slice(0, 10).map((row, index) => <li key={`${row.name}-${index}`} className="flex items-center gap-3 rounded-lg px-2 py-2 even:bg-[var(--canvas)]"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[10px] font-black text-[var(--deep-lagoon)]">{index + 1}</span><span className="min-w-0 flex-1 truncate text-xs font-bold">{row.name}</span><span className="shrink-0 text-right text-[10px] text-[var(--text-muted)]">{row.metric}<span className="block font-bold text-[var(--text)]">{row.secondary}</span></span></li>)}</ol>;
}

function PercentIcon(props) {
  return <span className="inline-flex h-5 w-5 items-center justify-center text-sm font-black" aria-hidden="true">%</span>;
}
