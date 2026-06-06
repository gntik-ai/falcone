import { config } from '../src/config.mjs';
import { getCurrentSpec } from '../src/spec-version-repo.mjs';
import { upsertSdkPackage, updateSdkPackageStatus, getSdkPackage } from '../src/sdk-package-repo.mjs';
import { emitSdkGenerationCompleted } from '../src/spec-audit.mjs';

const SUPPORTED_LANGUAGES = new Set(['typescript', 'python']);

function extractWorkspaceId(pathname = '') {
  const match = pathname.match(/\/v1\/workspaces\/([^/]+)\/sdks/);
  return match?.[1] ?? null;
}

function extractLanguage(pathname = '') {
  const match = pathname.match(/\/sdks\/([^/]+)\/status/);
  return match?.[1] ?? null;
}

function parseBody(params) {
  if (typeof params.__ow_body === 'string') return JSON.parse(params.__ow_body || '{}');
  return params.__ow_body ?? {};
}

async function handleStatusCheck(params, pool) {
  const headers = params.__ow_headers ?? {};
  const tenantId = headers['x-auth-tenant-id'] ?? headers['x-tenant-id'];

  if (!tenantId) {
    return { statusCode: 401, body: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
  }

  const workspaceId = extractWorkspaceId(params.__ow_path);
  const language = extractLanguage(params.__ow_path);

  if (!SUPPORTED_LANGUAGES.has(language)) {
    return { statusCode: 404, body: { code: 'SDK_NOT_FOUND', message: 'Unknown SDK language' } };
  }

  const pkg = await getSdkPackage(pool, workspaceId, language, tenantId);
  if (!pkg) {
    return { statusCode: 404, body: { code: 'SDK_NOT_FOUND', message: 'No SDK package found' } };
  }

  return {
    statusCode: 200,
    body: {
      packageId: pkg.id,
      language: pkg.language,
      specVersion: pkg.specVersion,
      status: pkg.status,
      downloadUrl: pkg.downloadUrl,
      urlExpiresAt: pkg.urlExpiresAt,
      errorMessage: pkg.errorMessage
    }
  };
}

async function handleGenerateRequest(params, pool, kafka, dependencies = {}) {
  const body = parseBody(params);
  const language = body.language;
  const workspaceId = extractWorkspaceId(params.__ow_path);
  const tenantId = (params.__ow_headers ?? {})['x-auth-tenant-id'] ?? (params.__ow_headers ?? {})['x-tenant-id'];

  if (!tenantId) {
    return { statusCode: 401, body: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
  }

  if (!SUPPORTED_LANGUAGES.has(language)) {
    return { statusCode: 400, body: { code: 'INVALID_LANGUAGE', message: 'Language must be typescript or python' } };
  }

  const spec = await getCurrentSpec(pool, workspaceId);
  if (!spec) {
    return { statusCode: 404, body: { code: 'SPEC_NOT_FOUND', message: 'No current spec found' } };
  }

  if (spec.tenantId !== tenantId) {
    return { statusCode: 403, body: { code: 'FORBIDDEN', message: 'Workspace tenant mismatch' } };
  }

  const pkg = await upsertSdkPackage(pool, { tenantId, workspaceId, language, specVersion: spec.specVersion });
  if (pkg.status === 'ready' && pkg.downloadUrl) {
    return {
      statusCode: 200,
      body: {
        packageId: pkg.id,
        language,
        specVersion: spec.specVersion,
        status: pkg.status,
        downloadUrl: pkg.downloadUrl,
        urlExpiresAt: pkg.urlExpiresAt,
        errorMessage: pkg.errorMessage
      }
    };
  }

  await updateSdkPackageStatus(pool, pkg.id, { status: 'building' });

  try {
    const builder = dependencies.buildSdk ?? (await import('../src/sdk-builder.mjs')).buildSdk;
    const storage = dependencies.uploadSdkArtefact ?? (await import('../src/sdk-storage.mjs')).uploadSdkArtefact;
    const built = await builder(spec.formatJson, language, workspaceId, spec.specVersion);
    const uploaded = await storage({ ...built, workspaceId, language, specVersion: spec.specVersion });
    await updateSdkPackageStatus(pool, pkg.id, { status: 'ready', downloadUrl: uploaded.downloadUrl, urlExpiresAt: uploaded.urlExpiresAt });
    await emitSdkGenerationCompleted(kafka, { workspaceId, tenantId, language, specVersion: spec.specVersion, status: 'ready', errorMessage: null });
  } catch (error) {
    await updateSdkPackageStatus(pool, pkg.id, { status: 'failed', errorMessage: error.message });
    await emitSdkGenerationCompleted(kafka, { workspaceId, tenantId, language, specVersion: spec.specVersion, status: 'failed', errorMessage: error.message });
    return { statusCode: 500, body: { code: 'SDK_GENERATION_FAILED', message: error.message } };
  }

  return {
    statusCode: 202,
    body: {
      packageId: pkg.id,
      language,
      specVersion: spec.specVersion,
      status: 'pending',
      statusUrl: `/v1/workspaces/${workspaceId}/sdks/${language}/status`
    }
  };
}

export async function main(params, dependencies = {}) {
  let pool = dependencies.pool;
  let kafka = dependencies.kafka;

  if (!pool) {
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: config.pgConnectionString });
  }

  if (!kafka) {
    const { Kafka } = await import('kafkajs');
    kafka = new Kafka({ brokers: config.kafkaBrokers, clientId: config.kafkaClientId });
  }

  const method = params.__ow_method?.toUpperCase();
  if (method === 'GET') return handleStatusCheck(params, pool);
  if (method === 'POST') return handleGenerateRequest(params, pool, kafka, dependencies);
  return { statusCode: 405, body: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported method' } };
}
