import { buildSchema, validate, parse } from 'graphql';
import { describe, expect, it } from 'vitest';
import { graphqlSDL, validateOrderResponse, validateOrderWebhook, validatePaymentEvent } from '../src/contracts';

describe('JSON Schema contracts', () => {
  it('order webhook: accepts the documented shape, rejects numeric price and bad currency', () => {
    expect(validateOrderWebhook({ id: '1', email: 'a@b.co', total_price: '10.00', currency: 'USD' })).toBe(true);
    expect(validateOrderWebhook({ id: '1', email: 'a@b.co', total_price: 10, currency: 'USD' })).toBe(false);
    expect(validateOrderWebhook({ id: '1', email: 'a@b.co', total_price: '10.00', currency: 'usd' })).toBe(false);
  });
  it('payment event: unknown event types are rejected', () => {
    expect(validatePaymentEvent({ id: 'evt_1', type: 'invoice.paid', data: { object: { metadata: { order_id: 'o' } } } })).toBe(false);
  });
  it('order response: no undocumented fields may leak', () => {
    expect(validateOrderResponse({ id: 'o', email: 'e', totalCents: 1, currency: 'USD', status: 'paid', internalNote: 'x' })).toBe(false);
  });
});
describe('GraphQL contract', () => {
  const schema = buildSchema(graphqlSDL);
  it('the queries used by clients still validate against the schema', () => {
    for (const q of ['query($id:ID!){order(id:$id){id status totalCents crmContactId}}', '{orders(status: paid){id email}}'])
      expect(validate(schema, parse(q))).toEqual([]);
  });
});
