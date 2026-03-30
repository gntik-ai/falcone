import pg from 'pg';
import { Kafka } from 'kafkajs';
import { config } from '../src/config.mjs';
import { fetchEnabledCapabilities } from '../src/capability-manifest-client.mjs';
import { getCurrentSpec, insertNewSpec } from '../src/spec-version-repo.mjs';
import { markStaleSdkPackages } from '../src/sdk-package-repo.mjs';
import { assembleSpec, computeChangeType } from '../src/spec-assembler.mjs';
import { emitSpecUpdated } from '../src/spec-audit.mjs';

export async function main(params, dependencies = {}) {
  const pool = dependencies.pool ?? new pg.Pool({ connectionString: config.pgConnectionString });
  const kafka = dependencies.kafka ?? new Kafka({ brokers: config.kafkaBrokers, clientId: config.kafkaClientId });
  const fetchCapabilities = dependencies.fetchEnabledCapabilities ?? fetchEnabledCapabilities;

  const enabledCapabilities = await fetchCapabilities(params.workspaceId, params.authToken);
  const current = await getCurrentSpec(pool, params.workspaceId);
  const previousVersion = current?.specVersion ?? '0.0.0';
  const previousTags = current?.capabilityTags ?? [];
  const assembled = assembleSpec({
    enabledCapabilities,
    workspaceBaseUrl: params.workspaceBaseUrl,
    previousSpecVersion: previousVersion,
    previousCapabilityTags: previousTags
  });

  if (current && current.contentHash === assembled.contentHash) {
    return { statusCode: 200, body: { message: 'no-op: spec unchanged' } };
  }

  await insertNewSpec(pool, {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    ...assembled
  });

  await markStaleSdkPackages(pool, params.workspaceId, assembled.specVersion);

  await emitSpecUpdated(kafka, {
    workspaceId: params.workspaceId,
    tenantId: params.tenantId,
    specVersion: assembled.specVersion,
    previousSpecVersion: previousVersion,
    contentHash: assembled.contentHash,
    capabilityTags: assembled.capabilityTags,
    changeType: computeChangeType(previousTags, assembled.capabilityTags)
  });

  return { statusCode: 200, body: { specVersion: assembled.specVersion } };
}
