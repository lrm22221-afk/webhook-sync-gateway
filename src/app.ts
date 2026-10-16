import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buildSchema, graphql } from 'graphql';
import { graphqlSDL, validateOrderResponse, validateOrderWebhook, validatePaymentEvent } from './contracts';
import type { CrmClient } from './crm';
import { verifyShopifyStyle, verifyStripeStyle } from './signatures';
import { Store, type Order } from './store';

export interface GatewayConfig { paymentSecret: string; orderSecret: string; crm: CrmClient; store?: Store; log?: (m: string) => void }

const readRaw = (req: IncomingMessage) => new Promise<string>((res, rej) => {
  let b = ''; req.setEncoding('utf8'); req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => res(b)); req.on('error', rej);
});
const send = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

export function createGateway(cfg: GatewayConfig) {
  const store = cfg.store ?? new Store();
  const log = cfg.log ?? (() => {});
  const schema = buildSchema(graphqlSDL);
  const root = {
    order: ({ id }: { id: string }) => store.orders.get(id) ?? null,
    orders: ({ status }: { status?: string }) => [...store.orders.values()].filter((o) => !status || o.status === status),
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'POST' && url.pathname === '/webhooks/orders') {
        const raw = await readRaw(req);
        const v = verifyShopifyStyle(raw, req.headers['x-shop-hmac-sha256'] as string | undefined, cfg.orderSecret);
        if (!v.ok) return send(res, 401, { error: `signature ${v.reason}` });
        const eventId = req.headers['x-shop-event-id'] as string | undefined;
        if (!eventId) return send(res, 400, { error: 'missing event id' });
        const body: unknown = JSON.parse(raw);
        if (!validateOrderWebhook(body)) return send(res, 422, { error: 'contract', details: validateOrderWebhook.errors });
        if (!store.markEvent(`order:${eventId}`)) return send(res, 200, { duplicate: true });
        const order: Order = { id: body.id, email: body.email.toLowerCase(), totalCents: Math.round(parseFloat(body.total_price) * 100), currency: body.currency, status: 'pending' };
        store.orders.set(order.id, { ...store.orders.get(order.id), ...order });
        log(`order ${order.id} stored`);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/webhooks/payments') {
        const raw = await readRaw(req);
        const v = verifyStripeStyle(raw, req.headers['x-pay-signature'] as string | undefined, cfg.paymentSecret);
        if (!v.ok) return send(res, 401, { error: `signature ${v.reason}` });
        const evt: unknown = JSON.parse(raw);
        if (!validatePaymentEvent(evt)) return send(res, 422, { error: 'contract', details: validatePaymentEvent.errors });
        if (!store.markEvent(`pay:${evt.id}`)) return send(res, 200, { duplicate: true });
        const order = store.orders.get(evt.data.object.metadata.order_id);
        if (!order) { store.seenEvents.delete(`pay:${evt.id}`); return send(res, 409, { error: 'unknown order, retry later' }); }
        if (evt.type === 'payment_intent.succeeded') {
          order.status = 'paid';
          try {
            order.crmContactId = (await cfg.crm.upsertContact(order.email, 'customer')).id;
          } catch (e) {
            store.seenEvents.delete(`pay:${evt.id}`); // let the provider retry the whole event
            log(`crm sync failed: ${(e as Error).message}`);
            return send(res, 502, { error: 'crm unavailable' });
          }
        } else order.status = 'refunded';
        return send(res, 200, { ok: true, status: order.status });
      }
      const m = url.pathname.match(/^\/orders\/([^/]+)$/);
      if (req.method === 'GET' && m) {
        const o = store.orders.get(decodeURIComponent(m[1]));
        if (!o) return send(res, 404, { error: 'not found' });
        if (!validateOrderResponse(o)) return send(res, 500, { error: 'response contract violated' });
        return send(res, 200, o);
      }
      if (req.method === 'POST' && url.pathname === '/graphql') {
        const { query, variables } = JSON.parse(await readRaw(req));
        return send(res, 200, await graphql({ schema, source: query, rootValue: root, variableValues: variables }));
      }
      if (url.pathname === '/health') return send(res, 200, { ok: true });
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, e instanceof SyntaxError ? 400 : 500, { error: e instanceof SyntaxError ? 'invalid json' : 'internal' });
    }
  });
  return { server, store };
}
