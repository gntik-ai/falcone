import { createReadStream } from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.mjs';

function createClient() {
  return new S3Client({
    endpoint: config.s3Endpoint,
    region: 'auto',
    forcePathStyle: true,
    credentials: config.s3AccessKey && config.s3SecretKey ? {
      accessKeyId: config.s3AccessKey,
      secretAccessKey: config.s3SecretKey
    } : undefined
  });
}

export function buildSdkObjectKey({ workspaceId, language, specVersion, archiveType }) {
  return `sdks/${workspaceId}/${language}/${specVersion}/workspace-sdk.${archiveType === 'zip' ? 'zip' : 'tar.gz'}`;
}

export async function uploadSdkArtefact({ archivePath, archiveType, workspaceId, language, specVersion }, dependencies = {}) {
  const client = dependencies.client ?? createClient();
  const signedUrl = dependencies.getSignedUrl ?? getSignedUrl;
  const key = buildSdkObjectKey({ workspaceId, language, specVersion, archiveType });
  const contentType = archiveType === 'zip' ? 'application/zip' : 'application/gzip';

  await client.send(new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    Body: createReadStream(archivePath),
    ContentType: contentType
  }));

  const expiresIn = config.s3PresignedUrlTtlSeconds;
  const downloadUrl = await signedUrl(client, new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }), { expiresIn });
  return {
    downloadUrl,
    urlExpiresAt: new Date(Date.now() + expiresIn * 1000)
  };
}
