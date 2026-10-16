/** Starts the stack on fixed ports, signs webhook bodies in a pre-request script, runs the Postman collection via Newman. */
import newman from 'newman';
import { startStack } from '../src/main';

process.env.QUIET = '1';
const s = await startStack(3100, 3101);
newman.run({
  collection: 'postman/gateway.postman_collection.json',
  envVar: [{ key: 'base', value: s.base }, { key: 'paySecret', value: 'whsec_demo' }, { key: 'shopSecret', value: 'shop_demo' }],
  reporters: ['cli', 'json'],
  reporter: { json: { export: 'newman-report/report.json' } },
}, (err, summary) => {
  s.close();
  const failed = err || summary.run.failures.length > 0;
  process.exit(failed ? 1 : 0);
});
