/** Local demo: starts the mock CRM, completes the OAuth2 PKCE flow, then starts the gateway. Secrets are demo-only. */
import type { AddressInfo } from 'node:net';
import { createMockCrm, MOCK_CLIENT } from '../mock/crm-server';
import { createGateway } from './app';
import { CrmClient } from './crm';
import { authorizeUrl, OAuthClient, pkcePair } from './oauth';

export async function startStack(gatewayPort = 0, crmPort = 0) {
  const crm = createMockCrm();
  await new Promise<void>((r) => crm.server.listen(crmPort, '127.0.0.1', r));
  const crmBase = `http://127.0.0.1:${(crm.server.address() as AddressInfo).port}`;
  const oauth = new OAuthClient(crmBase, MOCK_CLIENT.id, MOCK_CLIENT.secret);
  const redirect = 'http://127.0.0.1/callback';
  const { verifier, challenge } = pkcePair();
  const r = await fetch(authorizeUrl(crmBase, MOCK_CLIENT.id, redirect, challenge, 'st8'), { redirect: 'manual' });
  const code = new URL(r.headers.get('location')!).searchParams.get('code')!;
  await oauth.exchangeCode(code, verifier, redirect);
  const crmClient = new CrmClient(crmBase, oauth);
  const gw = createGateway({ paymentSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? 'whsec_demo', orderSecret: process.env.ORDER_WEBHOOK_SECRET ?? 'shop_demo', crm: crmClient, log: (m) => process.env.QUIET || console.log(m) });
  await new Promise<void>((r) => gw.server.listen(gatewayPort, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(gw.server.address() as AddressInfo).port}`;
  return { base, crmBase, crm, gw, oauth, crmClient, close: () => { gw.server.close(); crm.server.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startStack(Number(process.env.PORT ?? 3000), 3001);
  console.log(`gateway ${s.base}  mock CRM ${s.crmBase}`);
}
