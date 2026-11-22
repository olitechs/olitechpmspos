import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInviteCorsHeaders, isAllowedInviteOrigin } from './cors.mjs';

const appUrl = 'https://app.olitechs.co.ke';

test('allows the configured production application origin', () => {
  assert.equal(isAllowedInviteOrigin(appUrl, { appUrl }), true);
  assert.equal(buildInviteCorsHeaders(new Request('https://edge.test', {
    headers: { Origin: appUrl },
  }), { appUrl })['Access-Control-Allow-Origin'], appUrl);
});

test('allows the canonical OliTechs Vercel app and deployment-specific hosts', () => {
  for (const origin of [
    'https://olitechpmspos.vercel.app',
    'https://olitechpmspos-jbcl0zvkk-oli-techs1.vercel.app',
    'https://olitechpmspos-git-main-oli-techs1.vercel.app',
  ]) {
    assert.equal(isAllowedInviteOrigin(origin, { appUrl }), true, origin);
    assert.equal(buildInviteCorsHeaders(new Request('https://edge.test', {
      headers: { Origin: origin },
    }), { appUrl })['Access-Control-Allow-Origin'], origin);
  }
});

test('allows both canonical production domains regardless of www redirect preference', () => {
  for (const origin of ['https://olitechs.co.ke', 'https://www.olitechs.co.ke', 'https://app.olitechs.co.ke']) {
    assert.equal(isAllowedInviteOrigin(origin, { appUrl }), true, origin);
    assert.equal(buildInviteCorsHeaders(new Request('https://edge.test', { headers: { Origin: origin } }), { appUrl })['Access-Control-Allow-Origin'], origin);
  }
});

test('supports explicitly configured additional origins', () => {
  const origin = 'https://admin.olitechs.co.ke';
  assert.equal(isAllowedInviteOrigin(origin, { appUrl, allowedOrigins: origin }), true);
  assert.equal(isAllowedInviteOrigin('https://other.olitechs.co.ke', {
    appUrl, allowedOrigins: origin,
  }), false);
});

test('does not reflect untrusted origins', () => {
  const evil = 'https://olitechpmspos.vercel.app.attacker.example';
  assert.equal(isAllowedInviteOrigin(evil, { appUrl }), false);
  assert.equal(buildInviteCorsHeaders(new Request('https://edge.test', {
    headers: { Origin: evil },
  }), { appUrl })['Access-Control-Allow-Origin'], appUrl);
  assert.equal(isAllowedInviteOrigin('null', { appUrl }), false);
});

test('allows the Supabase client headers used by Edge Function invocation', () => {
  const headers = buildInviteCorsHeaders(new Request('https://edge.test'), { appUrl });
  assert.match(headers['Access-Control-Allow-Headers'], /authorization/i);
  assert.match(headers['Access-Control-Allow-Headers'], /apikey/i);
  assert.match(headers['Access-Control-Allow-Headers'], /x-client-info/i);
  assert.match(headers['Access-Control-Allow-Headers'], /content-type/i);
  assert.match(headers['Access-Control-Allow-Headers'], /x-supabase-api-version/i);
  assert.equal(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
});
