import { Ajv } from 'ajv';
import { readFileSync } from 'node:fs';
const load = (f: string) => JSON.parse(readFileSync(new URL(`../contracts/${f}`, import.meta.url), 'utf8'));
export const ajv = new Ajv({ allErrors: true });
export interface OrderWebhook { id: string; email: string; total_price: string; currency: string }
export interface PaymentEvent { id: string; type: 'payment_intent.succeeded' | 'charge.refunded'; data: { object: { metadata: { order_id: string } } } }
export const validateOrderWebhook = ajv.compile<OrderWebhook>(load('order-webhook.schema.json'));
export const validatePaymentEvent = ajv.compile<PaymentEvent>(load('payment-event.schema.json'));
export const validateOrderResponse = ajv.compile(load('order-response.schema.json'));
export const graphqlSDL = readFileSync(new URL('../contracts/schema.graphql', import.meta.url), 'utf8');
