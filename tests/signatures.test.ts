import { describe, expect, it } from 'vitest';
import { signShopifyStyle, signStripeStyle, verifyShopifyStyle, verifyStripeStyle } from '../src/signatures';

const body = '{"id":"evt_1"}', secret = 'whsec_test';
describe('stripe-style signature', () => {
  it('accepts a valid signature', () => expect(verifyStripeStyle(body, signStripeStyle(body, secret), secret)).toEqual({ ok: true }));
  it('rejects a tampered body', () => expect(verifyStripeStyle(body + ' ', signStripeStyle(body, secret), secret)).toEqual({ ok: false, reason: 'mismatch' }));
  it('rejects the wrong secret', () => expect(verifyStripeStyle(body, signStripeStyle(body, 'other'), secret)).toMatchObject({ reason: 'mismatch' }));
  it('rejects a replay outside the 5 min tolerance', () => {
    const t = 1_000_000;
    expect(verifyStripeStyle(body, signStripeStyle(body, secret, t), secret, 300, t + 301)).toMatchObject({ reason: 'stale' });
  });
  it('accepts any of several v1 signatures (secret rotation)', () => {
    const t = Math.floor(Date.now() / 1000);
    const oldSig = signStripeStyle(body, 'old', t).split('v1=')[1];
    const header = `t=${t},v1=${oldSig},${signStripeStyle(body, secret, t).split(',')[1]}`;
    expect(verifyStripeStyle(body, header, secret).ok).toBe(true);
  });
  it('reports missing and malformed headers', () => {
    expect(verifyStripeStyle(body, undefined, secret)).toMatchObject({ reason: 'missing' });
    expect(verifyStripeStyle(body, 'garbage', secret)).toMatchObject({ reason: 'malformed' });
  });
});
describe('shopify-style signature', () => {
  it('accepts valid and rejects tampered', () => {
    expect(verifyShopifyStyle(body, signShopifyStyle(body, secret), secret).ok).toBe(true);
    expect(verifyShopifyStyle('{"id":"evt_2"}', signShopifyStyle(body, secret), secret).ok).toBe(false);
  });
  it('signs unicode bodies byte-exactly', () => {
    const he = '{"note":"הזמנה"}';
    expect(verifyShopifyStyle(he, signShopifyStyle(he, secret), secret).ok).toBe(true);
  });
});
