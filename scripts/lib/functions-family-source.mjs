import { mergePublicApiFamilySource } from './public-api-family-source.mjs';

export function mergeFunctionsFamilySource(document, family, version) {
  return mergePublicApiFamilySource(document, family, version, 'functions');
}
