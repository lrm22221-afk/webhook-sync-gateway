import { signShopifyStyle, signStripeStyle } from '../src/signatures';
export const PAY = 'whsec_demo', SHOP = 'shop_demo';
let n = 0;
export const orderBody = (id = `o_${++n}`, extra: Record<string, unknown> = {}) => JSON.stringify({ id, email: `Buyer${n}@Example.com`, total_price: '42.50', currency: 'USD', ...extra });
export const postOrder = (base: string, raw: string, eventId = `e_${++n}`, secret = SHOP) =>
  fetch(`${base}/webhooks/orders`, { method: 'POST', body: raw, headers: { 'x-shop-hmac-sha256': signShopifyStyle(raw, secret), 'x-shop-event-id': eventId } });
export const payEvent = (orderId: string, type = 'payment_intent.succeeded', id = `evt_${++n}`) => JSON.stringify({ id, type, data: { object: { metadata: { order_id: orderId } } } });
export const postPay = (base: string, raw: string, header = signStripeStyle(raw, PAY)) =>
  fetch(`${base}/webhooks/payments`, { method: 'POST', body: raw, headers: { 'x-pay-signature': header } });
