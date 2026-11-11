import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobClaimer, resolveClaimedJobTarget, claimedJobPayload, CLAIM_RPC, COMPLETE_RPC, TOKEN_CLAIM_RPC, TOKEN_COMPLETE_RPC } from './claim.mjs';

const escpos = () => Buffer.from('OliTechs ticket').toString('base64');

function queuedJob(overrides = {}) {
  return {
    id: 'job-1',
    property_id: 'property-1',
    printer_id: 'printer-1',
    job_type: 'KOT',
    copy_type: null,
    title: 'Kitchen Order',
    status: 'printing',
    attempts: 1,
    payload: { printTarget: { host: '192.168.2.117', port: 9100 }, escposBase64: escpos() },
    ...overrides,
  };
}

function fakeClient({ jobs = [], claimError = null, completeError = null } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === CLAIM_RPC || name === TOKEN_CLAIM_RPC) {
        if (claimError) return { data: null, error: claimError };
        return { data: jobs, error: null };
      }
      if (name === COMPLETE_RPC || name === TOKEN_COMPLETE_RPC) {
        calls.push({ name: 'completed', args });
        return { data: null, error: completeError };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

const acceptOk = async () => ({ ok: true });

test('a claimed job is printed and reported as printed', async () => {
  const client = fakeClient({ jobs: [queuedJob()] });
  const accepted = [];
  const claimer = createJobClaimer({
    client, agentId: 'agent-1', acceptJob: async (job) => { accepted.push(job); return { ok: true }; },
  });

  const summary = await claimer.claimOnce();
  assert.equal(summary.claimed, 1);
  assert.equal(summary.printed, 1);

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].idempotencyKey, 'fnb:job-1', 'a re-claim of the same row must collide, not reprint');
  assert.equal(accepted[0].transport, 'network_ip');
  assert.deepEqual(accepted[0].target, { host: '192.168.2.117', port: 9100 });
  assert.equal(accepted[0].payloadBase64, escpos());

  const claimCall = client.calls.find((call) => call.name === CLAIM_RPC);
  assert.equal(claimCall.args.p_agent_id, 'agent-1');
  assert.equal(claimCall.args.p_limit, 3);

  const completion = client.calls.find((call) => call.name === 'completed');
  assert.equal(completion.args.p_status, 'printed');
  assert.equal(completion.args.p_job_id, 'job-1');
});

test('a job with no printer target is failed with an actionable message', async () => {
  const client = fakeClient({ jobs: [queuedJob({ payload: { escposBase64: escpos() } })] });
  let acceptCalled = false;
  const claimer = createJobClaimer({
    client, agentId: 'agent-1', acceptJob: async () => { acceptCalled = true; return { ok: true }; },
  });

  const summary = await claimer.claimOnce();
  assert.equal(summary.failed, 1);
  assert.equal(acceptCalled, false);
  const completion = client.calls.find((call) => call.name === 'completed');
  assert.equal(completion.args.p_status, 'failed');
  assert.match(completion.args.p_error_message, /no printer address/i);
});

test('a job saved without print data is failed instead of guessing', async () => {
  const client = fakeClient({ jobs: [queuedJob({ payload: { printTarget: { host: '192.168.2.117', port: 9100 } } })] });
  const claimer = createJobClaimer({ client, agentId: 'agent-1', acceptJob: acceptOk });

  const summary = await claimer.claimOnce();
  assert.equal(summary.failed, 1);
  const completion = client.calls.find((call) => call.name === 'completed');
  assert.match(completion.args.p_error_message, /without its print data/i);
});

test('a possibly-printed outcome is reported as uncertain to the cloud queue', async () => {
  const client = fakeClient({ jobs: [queuedJob()] });
  const claimer = createJobClaimer({
    client,
    agentId: 'agent-1',
    acceptJob: async () => ({ ok: false, status: 'uncertain', code: 'PRINT_OUTCOME_UNCERTAIN', message: 'The printer never confirmed it.' }),
  });

  const summary = await claimer.claimOnce();
  assert.equal(summary.uncertain, 1);
  const completion = client.calls.find((call) => call.name === 'completed');
  assert.equal(completion.args.p_status, 'uncertain');
  assert.match(completion.args.p_error_message, /never confirmed/);
});

test('a printer error that may have delivered is treated as uncertain', async () => {
  const client = fakeClient({ jobs: [queuedJob()] });
  const claimer = createJobClaimer({
    client,
    agentId: 'agent-1',
    acceptJob: async () => { const error = new Error('socket closed mid write'); error.code = 'ECONNRESET'; error.delivered = true; throw error; },
  });

  const summary = await claimer.claimOnce();
  assert.equal(summary.uncertain, 1);
  assert.equal(client.calls.find((call) => call.name === 'completed').args.p_status, 'uncertain');
});

test('a job still being printed elsewhere is left alone rather than completed', async () => {
  const client = fakeClient({ jobs: [queuedJob()] });
  const claimer = createJobClaimer({
    client,
    agentId: 'agent-1',
    acceptJob: async () => ({ ok: false, status: 'printing', code: 'PRINT_JOB_IN_PROGRESS' }),
  });

  const summary = await claimer.claimOnce();
  assert.equal(summary.skipped, 1);
  assert.equal(client.calls.some((call) => call.name === 'completed'), false);
});

test('a database without the claim function disables claiming instead of retrying forever', async () => {
  const client = fakeClient({ claimError: { code: 'PGRST202', message: 'Could not find the function public.fn_claim_fnb_print_jobs' } });
  const claimer = createJobClaimer({ client, agentId: 'agent-1', acceptJob: acceptOk });

  const first = await claimer.claimOnce();
  assert.equal(first.disabled, 'RPC_UNAVAILABLE');
  assert.equal(claimer.disabled, 'RPC_UNAVAILABLE');

  const callsBefore = client.calls.length;
  const second = await claimer.claimOnce();
  assert.equal(second.disabled, 'RPC_UNAVAILABLE');
  assert.equal(client.calls.length, callsBefore, 'a disabled claimer must not keep calling the database');
});

test('a completion failure is logged and does not crash the agent', async () => {
  const warnings = [];
  const client = fakeClient({ jobs: [queuedJob()], completeError: { message: 'network down' } });
  const claimer = createJobClaimer({
    client,
    agentId: 'agent-1',
    logger: { warn: (message) => warnings.push(message) },
    acceptJob: acceptOk,
  });

  const summary = await claimer.claimOnce();
  assert.equal(summary.printed, 1);
  assert.ok(warnings.some((message) => /report a claimed print job/.test(message)));
});

test('a paired workstation claims and completes with its own secret, not a service key', async () => {
  const client = fakeClient({ jobs: [queuedJob()] });
  const secret = 'f'.repeat(64);
  const claimer = createJobClaimer({ client, token: secret, acceptJob: acceptOk });

  const summary = await claimer.claimOnce();
  assert.equal(summary.printed, 1);

  const claimCall = client.calls.find((call) => call.name === TOKEN_CLAIM_RPC);
  assert.ok(claimCall, 'the token RPC must be used');
  assert.equal(claimCall.args.p_token, secret);
  assert.equal(claimCall.args.p_agent_id, undefined, 'no service-role agent id is sent');
  assert.equal(claimCall.args.p_property_id, undefined, 'the property comes from the credential, not the caller');

  const completion = client.calls.find((call) => call.name === 'completed');
  assert.equal(completion.args.p_token, secret);
  assert.equal(completion.args.p_status, 'printed');
  assert.equal(completion.args.p_agent_id, undefined);
});

test('a rejected workstation secret disables claiming without a crash loop', async () => {
  const client = fakeClient({ claimError: { code: '42501', message: 'This workstation credential is not recognised or has been revoked.' } });
  const claimer = createJobClaimer({ client, token: 'e'.repeat(64), acceptJob: acceptOk });

  const summary = await claimer.claimOnce();
  assert.equal(summary.claimed, 0);
  assert.equal(claimer.disabled, null, 'a revoked secret is reported, not treated as a missing function');
});

test('no agent credential means claiming stays off', async () => {
  const client = fakeClient({});
  const claimer = createJobClaimer({ client, agentId: '', acceptJob: acceptOk });
  const summary = await claimer.claimOnce();
  assert.equal(summary.disabled, 'NOT_CONFIGURED');
  assert.equal(client.calls.length, 0);
});

test('targets and payloads are validated before they reach a socket', () => {
  assert.deepEqual(resolveClaimedJobTarget(queuedJob()), { transport: 'network_ip', target: { host: '192.168.2.117', port: 9100 } });
  assert.deepEqual(
    resolveClaimedJobTarget({ payload: { printTarget: { windowsPrinterName: 'EPSON TM-T20III' } } }),
    { transport: 'windows_spooler', target: { printerName: 'EPSON TM-T20III' } },
  );
  assert.equal(resolveClaimedJobTarget({ payload: { printTarget: { host: 'not-an-ip', port: 9100 } } }), null);
  assert.equal(resolveClaimedJobTarget({ payload: { printTarget: { host: '192.168.2.117', port: 8080 } } }), null);
  assert.equal(resolveClaimedJobTarget({}), null);

  assert.equal(claimedJobPayload(queuedJob()).toString(), 'OliTechs ticket');
  assert.equal(claimedJobPayload({ payload: { escposBase64: 'not base64 !!' } }), null);
  assert.equal(claimedJobPayload({ payload: {} }), null);
});
