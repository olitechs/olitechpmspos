import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEscPosPayload, finishPrintJob, normalizePrintSettings } from './escposJob.js';

test('default job ending feeds two lines and 100 dots then sends one GS V 66 n cut', () => {
  assert.equal(finishPrintJob(), String.fromCharCode(27,100,2,27,74,100,29,86,66,0));
  const payload = buildEscPosPayload('FOOTER');
  assert.ok(payload.startsWith(String.fromCharCode(27,64)));
  assert.ok(payload.endsWith(finishPrintJob()));
  assert.equal(payload.split(String.fromCharCode(29,86)).length - 1, 1);
});

test('line feed minimum is two and byte-valued settings are clamped', () => {
  const settings = normalizePrintSettings({ feedLinesBeforeCut:1, feedDotsBeforeCut:300, extraFeedAfterCut:-2 });
  assert.equal(settings.feedLinesBeforeCut, 2);
  assert.equal(settings.feedDotsBeforeCut, 255);
  assert.equal(settings.extraFeedAfterCut, 0);
});

test('all configured cutter commands are emitted exactly once', () => {
  const commands = [
    ['gs_v_66', [29,86,66,0]],
    ['gs_v_1', [29,86,1]],
    ['gs_v_0', [29,86,0]],
    ['esc_i', [27,105]],
    ['esc_m', [27,109]],
    ['none', []],
  ];
  for (const [cutCommand, expected] of commands) {
    const ending = finishPrintJob({ cutCommand });
    const actual = Array.from(ending.slice(6), character => character.charCodeAt(0));
    assert.deepEqual(actual, expected);
  }
});

test('optional post-cut feed defaults to zero', () => {
  assert.equal(finishPrintJob().endsWith(String.fromCharCode(27,74,0)), false);
  assert.ok(finishPrintJob({ extraFeedAfterCut:25 }).endsWith(String.fromCharCode(27,74,25)));
});
