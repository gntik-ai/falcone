import { collectGatewayPolicyViolations } from './lib/gateway-policy.mjs';

const violations = collectGatewayPolicyViolations();

if (violations.length > 0) {
  console.error('Gateway policy validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Gateway policy contracts and APISIX policy declarations are consistent.');
