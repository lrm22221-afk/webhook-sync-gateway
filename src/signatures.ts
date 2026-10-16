import { createHmac, timingSafeEqual } from 'node:crypto';

const safeEq = (a: string, b: string) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
};

/** Stripe-style header: "t=<unix>,v1=<hex hmac of `${t}.${rawBody}`>". Several v1 entries allowed (secret rotation). */
export function signStripeStyle(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

export function verifyStripeStyle(rawBody: string, header: string | undefined, secret: string, toleranceSec = 300, now = Math.floor(Date.now() / 1000)): VerifyResult {
  if (!header) return { ok: false, reason: 'missing' };
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isInteger(t) || sigs.length === 0) return { ok: false, reason: 'malformed' };
  if (Math.abs(now - t) > toleranceSec) return { ok: false, reason: 'stale' };
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return sigs.some((s) => safeEq(s, expected)) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** Shopify-style header: base64 HMAC-SHA256 of the raw body. */
export function signShopifyStyle(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}
export function verifyShopifyStyle(rawBody: string, header: string | undefined, secret: string): VerifyResult {
  if (!header) return { ok: false, reason: 'missing' };
  return safeEq(header, signShopifyStyle(rawBody, secret)) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
