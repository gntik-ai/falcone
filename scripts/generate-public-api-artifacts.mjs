import { writeFileSync } from 'node:fs';
import { OPENAPI_PATH, readJson } from './lib/quality-gates.mjs';
import { mergeFunctionsFamilySource } from './lib/functions-family-source.mjs';
import {
  PUBLIC_API_FAMILY_DIR,
  readPublicApiTaxonomy,
  writeGeneratedFamilyDocuments,
  writeGeneratedPublicApiDocs,
  writeGeneratedRouteCatalog
} from './lib/public-api.mjs';

const document = mergeFunctionsFamilySource(
  readJson(OPENAPI_PATH),
  readJson(`${PUBLIC_API_FAMILY_DIR}/functions.openapi.json`),
  readPublicApiTaxonomy().release.openapi_semver,
);
writeFileSync(OPENAPI_PATH, `${JSON.stringify(document, null, 2)}\n`);
writeGeneratedFamilyDocuments(document);
writeGeneratedRouteCatalog(document);
writeGeneratedPublicApiDocs(document);

console.log('Generated public API family contracts, route catalog, and published docs.');
