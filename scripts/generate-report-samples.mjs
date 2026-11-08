import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildMonthlySalesByCategoryDefinition,
  buildMonthlySalesByItemDefinition,
  buildMonthlySalesByShiftDefinition,
  buildSalesByPaymentTypeDefinition,
  buildSalesReportDefinition,
  buildSalesSummaryDefinition,
  buildStockControlDefinition,
} from '../src/services/reportDefinitions.js';
import { createExcelBlob, createPdfBlob, reportFilename } from '../src/services/reportDocumentEngine.js';
import { readCoastalLinenDocumentTheme } from './reportTheme.mjs';

const OUTPUT = join(process.cwd(), 'docs/report-samples');
const THEME = await readCoastalLinenDocumentTheme();
const fontBase64 = (await readFile(join(process.cwd(), 'public/fonts/olitechs-report-sans.ttf'))).toString('base64');
const common = { from: '2026-10-01', to: '2026-10-31', propertyName: 'Sample Coastal Linen Property', generatedBy: 'Synthetic Sample Generator' };
const shifts = [
  { id: 'synthetic-shift-01', shift_no: 'Morning', date: '2026-10-04' },
  { id: 'synthetic-shift-02', shift_no: 'Evening', date: '2026-10-12' },
  { id: 'synthetic-shift-03', shift_no: 'Night', date: '2026-10-25' },
];
const receipts = [
  { id: 'synthetic-receipt-01', status: 'posted', total: 3850, pos_shift_id: shifts[0].id, items: [
    { sku: 'BAR-001', name: 'Kahawa House Blend', category: 'Hot drinks', production_center: 'Bar', qty: 3, unit_price: 400 },
    { sku: 'KIT-001', name: 'Coastal Catch with Coconut Rice', category: 'Main Course', production_center: 'Kitchen', qty: 2, unit_price: 1100 },
    { sku: 'BAR-002', name: 'Fresh Passion & Lime Juice', category: 'Cold drinks', production_center: 'Bar', qty: 1, unit_price: 450 },
  ] },
  { id: 'synthetic-receipt-02', status: 'posted', total: 2460, pos_shift_id: shifts[1].id, items: [
    { sku: 'KIT-002', name: 'Slow-roasted Garden Chicken', category: 'Main Course', production_center: 'Kitchen', qty: 2, unit_price: 980 },
    { sku: 'BAR-001', name: 'Kahawa House Blend', category: 'Hot drinks', production_center: 'Bar', qty: 1, unit_price: 500 },
  ] },
  { id: 'synthetic-receipt-03', status: 'posted', total: 1750, shift_id: shifts[2].id, items: [
    { sku: 'KIT-003', name: 'Market Garden Vegetable Bowl', category: 'Plant-forward', production_center: 'Kitchen', qty: 1, unit_price: 1100 },
    { sku: 'BAR-003', name: 'Spiced Hibiscus Iced Tea', category: 'Cold drinks', production_center: 'Bar', qty: 1, unit_price: 650 },
  ] },
  { id: 'synthetic-receipt-04', status: 'voided', total: 20000, pos_shift_id: shifts[0].id, items: [{ sku: 'VOID', name: 'Excluded voided receipt', category: 'Not posted', production_center: 'Bar', qty: 50, amount: 20000 }] },
];
const salesDetail = {
  departments: [
    { department: 'Bar', qty: 6, revenue: 2800 },
    { department: 'Kitchen', qty: 5, revenue: 5260 },
  ],
  daily: [
    { business_date: '2026-10-04', revenue: 3850 },
    { business_date: '2026-10-12', revenue: 2460 },
    { business_date: '2026-10-25', revenue: 1750 },
  ],
  payments: [{ method: 'Cash', transactions: 2, amount: 4210 }, { method: 'M-Pesa', transactions: 3, amount: 3850 }],
  discounts: [{ discount: 'Member offer', transactions: 1, amount: 150 }],
  voids: [{ reason: 'Training test', transactions: 1, amount: 20000 }],
  refunds: [{ method: 'Cash', transactions: 1, amount: 300 }],
};
const managementReport = { sales: { pos_gross: 8060, pos_net: 7760, pos_tax: 600, discounts: 150, refunds: 300, voids: 20000 } };
const definitions = [
  buildSalesSummaryDefinition({ report: managementReport, sales: salesDetail, ...common }),
  buildSalesReportDefinition({ report: managementReport, sales: salesDetail, ...common }),
  buildStockControlDefinition({
    products: [
      { sku: 'BAR-001', name: 'Kahawa House Blend', category: 'Bar', location: 'Main Store', unit: 'kg', current_stock: 4.5, min_stock: 6, expiry_date: '2026-12-15', cost_price: 820 },
      { sku: 'KIT-001', name: 'Coastal Catch Fillet', category: 'Kitchen', location: 'Cold Room', unit: 'kg', current_stock: 12, min_stock: 5, expiry_date: '2026-11-09', cost_price: 1450 },
      { sku: 'KIT-002', name: 'Coconut Milk', category: 'Kitchen', location: 'Dry Store', unit: 'tin', current_stock: 0, min_stock: 8, expiry_date: '', cost_price: 220 },
    ],
    movements: [
      { created_at: '2026-10-25T09:20:00+03:00', type: 'issue', qty: -2, reason: 'Kitchen requisition', source_document: 'REQ-SAMPLE-01', product: { name: 'Coastal Catch Fillet', category: 'Kitchen', location: 'Cold Room', unit: 'kg' }, user_profile: { full_name: 'Sample Storekeeper' } },
      { created_at: '2026-10-24T14:15:00+03:00', type: 'receive', qty: 10, reason: 'Purchase receipt', source_document: 'GRN-SAMPLE-09', product: { name: 'Kahawa House Blend', category: 'Bar', location: 'Main Store', unit: 'kg' }, user_profile: { full_name: 'Sample Receiver' } },
    ],
    category: 'all', location: 'all', showCost: true, ...common,
  }),
  buildMonthlySalesByItemDefinition({ receipts, shifts, ...common }),
  buildMonthlySalesByCategoryDefinition({ receipts, shifts, ...common }),
  buildMonthlySalesByShiftDefinition({ receipts, shifts, ...common }),
  buildSalesByPaymentTypeDefinition({ payments: salesDetail.payments, ...common }),
];

await mkdir(OUTPUT, { recursive: true });
const manifest = [];
for (const definition of definitions) {
  for (const format of ['pdf', 'xlsx']) {
    const blob = format === 'pdf'
      ? await createPdfBlob(definition, { theme: THEME, fontBase64 })
      : await createExcelBlob(definition, { theme: THEME });
    const filename = reportFilename(definition, format);
    const outputPath = join(OUTPUT, filename);
    await writeFile(outputPath, Buffer.from(await blob.arrayBuffer()));
    manifest.push({ file: filename, bytes: (await stat(outputPath)).size, report: definition.title, format, rows: definition.rowCount, synthetic: true });
    console.log(`Generated ${format.toUpperCase()} ${filename} (${definition.rowCount} report rows)`);
  }
}
await writeFile(join(OUTPUT, 'manifest.json'), `${JSON.stringify({ note: 'Synthetic test fixtures only; no production data.', reports: manifest }, null, 2)}\n`);
console.log(`Saved ${manifest.length} sample documents to ${OUTPUT}`);
