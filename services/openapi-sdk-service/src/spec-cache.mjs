import { createHash } from 'node:crypto';

export function computeContentHash(jsonString) {
  return `sha256:${createHash('sha256').update(jsonString).digest('hex')}`;
}

export function etagFromHash(contentHash) {
  return `\"${contentHash}\"`;
}

export function isEtagMatch(requestIfNoneMatch, contentHash) {
  if (!requestIfNoneMatch || requestIfNoneMatch === '*') return false;
  return requestIfNoneMatch.trim() === etagFromHash(contentHash);
}
