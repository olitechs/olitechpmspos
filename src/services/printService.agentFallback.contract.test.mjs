import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('the print service routes through the pure agent-fallback and retry helpers', async () => {
  const service = await read('./printService.js');
  assert.match(service, /agentBaseCandidates, AGENT_ORIGIN_BLOCKED_CODE, AGENT_UNAVAILABLE_CODE, describeAgentFailure, probeAgentReachable/);
  assert.match(service, /import \{ pickRetryPrinter \} from '@\/services\/printRetryCore'/);
  assert.match(service, /const bases = agentBaseCandidates\(printer\.agent_url \|\| printer\.agentUrl\)/);
  assert.match(service, /for \(const base of bases\) \{/);
  assert.match(service, /if \(await probeAgentReachable\(base\)\)/);
  assert.match(service, /return describeAgentFailure\(\{ origin, originReachable: true \}\)/);
});

test('an origin block is never written back as a dead printer', async () => {
  const service = await read('./printService.js');
  assert.match(service, /outcomeAffectsConnection\(outcome\) && code !== AGENT_ORIGIN_BLOCKED_CODE/);
});

test('retry selection and its message are honest about offline and unassigned jobs', async () => {
  const service = await read('./printService.js');
  assert.match(service, /return pickRetryPrinter\(\{ job, printers, assignments \}\)/);
  assert.match(service, /Assign a printer under Settings → Printers, then retry\./);
  assert.doesNotMatch(service, /No available printer is assigned to \$\{job\.assignment_type/);
});

test('the payment toast shows the printer failure reason instead of hiding it', async () => {
  const bill = await read('../components/pos/BillPayment.jsx');
  assert.match(bill, /const reason = result\.friendlyError \|\| result\.summary\?\.message/);
  assert.match(bill, /Payment completed, but the receipt did not print\. \$\{reason\}/);
});
