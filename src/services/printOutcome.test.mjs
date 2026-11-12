import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAgentPrintOutcome,
  durableJobStatus,
  outcomeAffectsConnection,
  printOutcomeMessage,
} from './printOutcomeCore.js';

test('a successful agent response is printed', () => {
  assert.equal(classifyAgentPrintOutcome({ ok: true }), 'printed');
  assert.equal(durableJobStatus('printed'), 'printed');
});

test('"may already have printed" is uncertain, never failed', () => {
  const uncertain = { ok: false, code: 'PRINT_OUTCOME_UNCERTAIN', status: 'uncertain' };
  assert.equal(classifyAgentPrintOutcome(uncertain), 'uncertain');
  assert.equal(classifyAgentPrintOutcome({ ok: false, status: 'uncertain' }), 'uncertain');
  assert.equal(durableJobStatus('uncertain'), 'uncertain');
  assert.equal(outcomeAffectsConnection('uncertain'), false, 'the printer clearly received bytes');
  assert.match(printOutcomeMessage('uncertain'), /Check the paper/);
});

test('a duplicate still held by the agent is pending, not a failure', () => {
  const duplicate = { ok: false, code: 'PRINT_JOB_IN_PROGRESS', status: 'printing' };
  assert.equal(classifyAgentPrintOutcome(duplicate), 'pending');
  assert.equal(classifyAgentPrintOutcome({ ok: false, status: 'queued' }), 'pending');
  assert.equal(durableJobStatus('pending'), 'printing', 'the row must stay in progress');
  assert.equal(outcomeAffectsConnection('pending'), false);
});

test('a real transport failure stays failed and may mark the printer offline', () => {
  assert.equal(classifyAgentPrintOutcome({ ok: false, code: 'LOCAL_AGENT_TIMEOUT' }), 'failed');
  assert.equal(classifyAgentPrintOutcome({ ok: false, code: 'PRINTER_UNREACHABLE' }), 'failed');
  assert.equal(classifyAgentPrintOutcome({ ok: false, friendlyError: 'nope' }), 'failed');
  assert.equal(classifyAgentPrintOutcome(), 'failed');
  assert.equal(durableJobStatus('failed'), 'failed');
  assert.equal(outcomeAffectsConnection('failed'), true);
});
