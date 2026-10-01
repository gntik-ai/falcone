import { collectDeploymentChartViolations, readRootChart, readRootValues, readWrapperChart } from './lib/deployment-chart.mjs';
import { deepMerge, readDeploymentTopology } from './lib/deployment-topology.mjs';
import { readYaml } from './lib/quality-gates.mjs';

let values = readRootValues();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  if (args[index] !== '--values' || !args[index + 1] || args[index + 1].startsWith('--')) {
    console.error('Usage: node scripts/validate-deployment-chart.mjs [--values path ...]');
    process.exit(1);
  }
  values = deepMerge(values, readYaml(args[index + 1]));
}

const violations = collectDeploymentChartViolations(
  readRootChart(),
  values,
  readDeploymentTopology(),
  readWrapperChart()
);

if (violations.length > 0) {
  console.error('Deployment chart validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Deployment chart dependencies, values layers, and packaging guidance are internally consistent.');
