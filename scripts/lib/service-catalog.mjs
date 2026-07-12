import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { parse } from 'yaml';

export const SERVICE_CATALOG_PATH = 'service-catalog.json';
export const RELEASE_WORKFLOW_PATH = '.github/workflows/release-images.yml';

export const REQUIRED_RELEASE_IMAGES = [
  'in-falcone-control-plane',
  'in-falcone-control-plane-executor',
  'in-falcone-web-console',
  'in-falcone-fn-runtime',
  'in-falcone-workflow-worker',
  'in-falcone-mcp-runtime'
];

export const REQUIRED_SHARED_PACKAGES = [
  'adapters',
  'audit',
  'audit-anomaly-handler',
  'backup-status',
  'billing-export',
  'event-gateway',
  'internal-contracts',
  'mongo-cdc-bridge',
  'openapi-sdk-service',
  'pg-cdc-bridge',
  'provisioning-orchestrator',
  'realtime-gateway',
  'scheduling-engine',
  'secret-audit-handler',
  'webhook-engine',
  'workspace-docs-service',
  'mcp-server-sdk'
];

export const REQUIRED_NON_RELEASE_CANDIDATES = [
  'mongo-cdc-bridge',
  'pg-cdc-bridge',
  'realtime-gateway',
  'workspace-docs-service'
];

export const FORBIDDEN_OLD_ROOTS = [
  'deploy/kind/control-plane/',
  'deploy/kind/fn-runtime/',
  'deploy/release/web-console.Dockerfile',
  'services/adapters/',
  'services/audit/',
  'services/audit-anomaly-handler/',
  'services/backup-status/',
  'services/billing-export/',
  'services/event-gateway/',
  'services/gateway-config/',
  'services/internal-contracts/',
  'services/keycloak-config/',
  'services/mongo-cdc-bridge/',
  'services/openapi-sdk-service/',
  'services/pg-cdc-bridge/',
  'services/provisioning-orchestrator/',
  'services/realtime-gateway/',
  'services/scheduling-engine/',
  'services/secret-audit-handler/',
  'services/webhook-engine/',
  'services/workflow-worker/',
  'services/workspace-docs-service/',
  'apps/mcp-server-sdk/',
  'apps/cli/'
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sorted(values) {
  return [...values].sort();
}

function sameSet(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function listTrackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function readReleaseMatrix() {
  const workflow = parse(readFileSync(RELEASE_WORKFLOW_PATH, 'utf8'));
  return workflow?.jobs?.['build-push']?.strategy?.matrix?.include ?? [];
}

function dockerfileParent(path) {
  return dirname(path).replaceAll('\\', '/');
}

function normalizeCopyLines(text) {
  const lines = [];
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!current && !line.trim()) continue;
    if (line.trimEnd().endsWith('\\')) {
      current += `${line.trimEnd().slice(0, -1)} `;
      continue;
    }
    lines.push(`${current}${line}`.trim());
    current = '';
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function splitCopyArgs(line) {
  const match = line.match(/^COPY\s+(.+)$/i);
  if (!match) return [];
  const args = match[1].trim().split(/\s+/);
  if (args.some((arg) => arg.startsWith('--from='))) return [];
  while (args[0]?.startsWith('--')) args.shift();
  if (args.length < 2) return [];
  return args.slice(0, -1);
}

export function isGeneratedBuildArtifact(source, context, entry) {
  return entry?.build_spa === 'true'
    && context === '.'
    && source === `${dockerfileParent(entry.dockerfile)}/dist`;
}

function sourceExistsInContext(source, context, entry) {
  if (source.startsWith('/') || source.includes('*') || source.includes('$')) return true;
  if (isGeneratedBuildArtifact(source, context, entry)) return true;
  return existsSync(normalize(join(context, source)));
}

export function readServiceCatalog() {
  return readJson(SERVICE_CATALOG_PATH);
}

export function collectServiceCatalogViolations(catalog = readServiceCatalog(), matrix = readReleaseMatrix()) {
  const violations = [];
  const services = Array.isArray(catalog?.services) ? catalog.services : [];
  const releaseServices = services.filter((service) => service.release === true);
  const releaseByImage = new Map(releaseServices.map((service) => [service.imageIdentity, service]));
  const matrixImages = matrix.map((entry) => entry.image);

  if (!sameSet(matrixImages, REQUIRED_RELEASE_IMAGES)) {
    violations.push(`release workflow image matrix must remain exactly ${REQUIRED_RELEASE_IMAGES.join(', ')}.`);
  }

  if (!sameSet([...releaseByImage.keys()], matrixImages)) {
    violations.push('service catalog release entries must match the release workflow image matrix exactly.');
  }

  for (const entry of matrix) {
    const service = releaseByImage.get(entry.image);
    if (!service) continue;

    if (service.dockerfile !== entry.dockerfile) {
      violations.push(`catalog dockerfile for ${entry.image} must match release workflow (${entry.dockerfile}).`);
    }

    if (!service.source || !service.source.startsWith('apps/')) {
      violations.push(`${entry.image} source must be under apps/<service>.`);
    }

    if (service.source !== `apps/${service.id}`) {
      violations.push(`${entry.image} source must equal apps/${service.id}.`);
    }

    if (!service.dockerfile || dockerfileParent(service.dockerfile) !== service.source) {
      violations.push(`${entry.image} Dockerfile must be co-located in ${service.source}.`);
    }

    for (const path of [service.source, service.dockerfile]) {
      if (!existsSync(path)) violations.push(`${entry.image} references missing path ${path}.`);
    }

    if (!service.language) violations.push(`${entry.image} must declare a language.`);
    if (!service.chart?.alias || !service.chart?.valueKey) {
      violations.push(`${entry.image} must declare chart alias and valueKey.`);
    }
    if (!Array.isArray(service.directDependencies)) {
      violations.push(`${entry.image} directDependencies must be an array.`);
    }
    if (!Array.isArray(service.interServiceCalls) || service.interServiceCalls.length === 0) {
      violations.push(`${entry.image} interServiceCalls must be a non-empty array.`);
    }
  }

  for (const entry of matrix) {
    const context = entry.context ?? '.';
    const dockerfile = entry.dockerfile;
    if (!dockerfile?.startsWith('apps/')) {
      violations.push(`${entry.image} release Dockerfile must live under apps/: ${dockerfile}`);
      continue;
    }
    if (!existsSync(dockerfile)) continue;
    for (const line of normalizeCopyLines(readFileSync(dockerfile, 'utf8'))) {
      for (const source of splitCopyArgs(line)) {
        if (!sourceExistsInContext(source, context, entry)) {
          violations.push(`${dockerfile} COPY source does not exist in context ${context}: ${source}`);
        }
      }
    }
  }

  for (const packageName of REQUIRED_SHARED_PACKAGES) {
    if (!existsSync(`packages/${packageName}`)) {
      violations.push(`required shared package root packages/${packageName} is missing.`);
    }
  }

  for (const root of ['deploy/gateway-config', 'deploy/keycloak-config', 'tools/falcone-cli']) {
    if (!existsSync(root)) violations.push(`required moved root ${root} is missing.`);
  }

  const trackedFiles = listTrackedFiles().filter((file) => existsSync(file));
  for (const oldRoot of FORBIDDEN_OLD_ROOTS) {
    if (trackedFiles.some((file) => file === oldRoot || file.startsWith(oldRoot))) {
      violations.push(`tracked files must not remain under old root ${oldRoot}.`);
    }
  }

  const nonRelease = new Map(services.filter((service) => service.release === false).map((service) => [service.id, service]));
  for (const id of REQUIRED_NON_RELEASE_CANDIDATES) {
    const service = nonRelease.get(id);
    if (!service) {
      violations.push(`catalog must represent non-release candidate ${id}.`);
      continue;
    }
    if (service.status !== 'non_release_candidate' || service.evidenceOnly !== true) {
      violations.push(`${id} must be explicitly marked as evidence-only non_release_candidate.`);
    }
    if (service.imageIdentity || service.chart) {
      violations.push(`${id} must not claim a release image or chart image value.`);
    }
    if (!service.source?.startsWith('packages/') || !existsSync(service.source)) {
      violations.push(`${id} must reference an existing packages/<name> source.`);
    }
  }

  const legacyConsole = catalog?.legacyNonDeployable?.find((entry) => entry.id === 'console');
  if (!legacyConsole || legacyConsole.source !== 'apps/console' || legacyConsole.status !== 'legacy_non_deployable') {
    violations.push('apps/console must be cataloged as legacy_non_deployable.');
  }

  const routeMap = readJson('apps/control-plane/route-map.runtime.json');
  for (const route of routeMap) {
    if (!route?.module || route.module === 'NONE') continue;
    const modulePath = route.module.startsWith('/repo/') ? route.module.slice('/repo/'.length) : route.module;
    if (!existsSync(modulePath)) {
      violations.push(`route-map runtime module for ${route.method} ${route.path} does not exist: ${route.module}`);
    }
  }

  return violations;
}
