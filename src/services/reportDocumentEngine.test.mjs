import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReportDefinition } from './reportDefinitions.js';
import { createExcelBlob, createPdfBlob, reportFilename } from './reportDocumentEngine.js';
import { readCoastalLinenDocumentTheme } from '../../scripts/reportTheme.mjs';

const THEME = await readCoastalLinenDocumentTheme();
const FONT_PATH = fileURLToPath(new URL('../../public/fonts/olitechs-report-sans.ttf', import.meta.url));
const fontBase64 = (await readFile(FONT_PATH)).toString('base64');
const ExcelJS = (await import('exceljs')).default;

function makeDefinition(rowCount) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    business_date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
    sku: `SYN-${String(index + 1).padStart(4, '0')}`,
    description: index === 0 ? 'Café M-Pesa · Chai — synthetic long description '.repeat(8) : `Synthetic report row ${index + 1}`,
    department: index % 2 ? 'Kitchen' : 'Bar',
    quantity: (index % 5) + 1,
    revenue: ((index % 7) + 1) * 125.5,
    status: index % 10 ? 'Posted' : 'Review',
    untrusted_note: index === 0 ? '=HYPERLINK("x","x")' : 'Synthetic only',
  }));
  return createReportDefinition({
    key: `synthetic-scale-${rowCount}`,
    title: 'Synthetic Sales & Stock Report',
    subtitle: 'Generated test data only · not production records',
    propertyName: 'Sample Coastal Linen Property',
    period: { from: '2026-10-01', to: '2026-10-31' },
    filters: { period: 'October 2026', department: ['Bar', 'Kitchen'], status: 'Posted' },
    generatedBy: 'Synthetic Report Test',
    generatedAt: '2026-10-31T12:00:00.000Z',
    summary: [{ label: 'Synthetic net sales', value: rows.reduce((sum, row) => sum + row.revenue, 0), format: 'currency' }, { label: 'Rows', value: rowCount, format: 'number' }],
    sections: [{
      name: 'synthetic-detail', title: 'Synthetic Transaction Detail',
      columns: [
        { key: 'business_date', label: 'Business date', type: 'date', format: 'date', width: 18 },
        { key: 'sku', label: 'SKU', type: 'text', width: 15 },
        { key: 'description', label: 'Item / description', type: 'text', width: 40 },
        { key: 'department', label: 'Department', type: 'text', width: 20 },
        { key: 'quantity', label: 'Quantity', type: 'number', format: 'quantity', width: 15, align: 'right', total: 'sum' },
        { key: 'revenue', label: 'Net revenue', type: 'number', format: 'currency', width: 20, align: 'right', total: 'sum' },
        { key: 'status', label: 'Status', type: 'text', width: 18 },
        { key: 'untrusted_note', label: 'Source note', type: 'text', width: 35 },
      ],
      rows,
    }],
    notes: ['Synthetic-only validation fixture; long text, Unicode, and page-break behavior are intentional.'],
  });
}

test('generated PDFs use landscape for wide tables, embed Unicode text, repeat headers, and number pages at 1/50/500 rows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'olitechs-report-pdf-'));
  try {
    for (const count of [1, 50, 500]) {
      const blob = await createPdfBlob(makeDefinition(count), { theme: THEME, fontBase64 });
      assert.equal(blob.type, 'application/pdf');
      const bytes = Buffer.from(await blob.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
      const filePath = join(directory, `synthetic-${count}.pdf`);
      await writeFile(filePath, bytes);
      const info = execFileSync('pdfinfo', [filePath], { encoding: 'utf8' });
      const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      assert.ok(pages >= 1, `Expected a page count for ${count} rows`);
      if (count >= 50) assert.ok(pages > 1, `${count} rows should paginate`);
      if (count === 500) assert.ok(pages >= 5, '500 rows should span multiple pages');
      const text = execFileSync('pdftotext', ['-layout', filePath, '-'], { encoding: 'utf8' });
      assert.match(text, /Synthetic Sales & Stock Report/);
      assert.match(text, /Page 1 of/);
      assert.match(text, /Synthetic Transaction Detail/);
      assert.doesNotMatch(text, /No transaction data for the selected filters/);
      assert.doesNotMatch(text, /\b(?:Dashboard|Sidebar|Download PDF|Export Excel|scrollbars)\b/);
      assert.match(text, /Caf[eé]/);
      assert.match(text, /KES/);
      assert.match(text, /Business/);
      assert.match(text, /date/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('generated Excel uses a combined branded summary, formulas, dates, safe text, and wide-sheet layout', async () => {
  const definition = makeDefinition(500);
  assert.equal(reportFilename(definition, 'xlsx'), 'OliTechs_Synthetic-Sales-Stock-Report_2026-10-01-to-2026-10-31.xlsx');
  const blob = await createExcelBlob(definition, { theme: THEME });
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()));
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ['Summary', 'synthetic-detail']);
  const summary = workbook.getWorksheet('Summary');
  assert.equal(summary.getCell('A1').value, 'Synthetic Sales & Stock Report');
  assert.equal(summary.getCell('A3').value, 'Report');
  assert.equal(summary.getCell('A4').value, 'Business');
  assert.equal(summary.getCell('B8').value, 500);
  const detail = workbook.getWorksheet('synthetic-detail');
  assert.equal(detail.pageSetup.orientation, 'landscape');
  assert.equal(detail.views[0].ySplit, 6);
  assert.equal(detail.getCell('A7').value instanceof Date, true);
  assert.equal(detail.getCell('H7').value, "'=HYPERLINK(\"x\",\"x\")");
  assert.match(detail.getCell('F7').numFmt, /KES/);
  assert.equal(detail.getCell('F507').value.formula, 'SUM(F7:F506)');
  // Header row uses the current brand navy token --deep-lagoon (#101A35),
  // enforced by tools/design-system/check-coastal-linen.mjs.
  assert.equal(detail.getCell('A6').fill.fgColor.argb, 'FF101A35');
  assert.equal(detail.views[0].state, 'frozen');
  assert.equal(detail.pageSetup.printTitlesRow, '1:6');
});
