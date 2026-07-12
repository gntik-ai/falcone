import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectServiceCatalogViolations,
  readServiceCatalog,
  REQUIRED_NON_RELEASE_CANDIDATES,
  REQUIRED_RELEASE_IMAGES
} from '../../scripts/lib/service-catalog.mjs';

test('repository layout catalog matches release matrix and moved service roots', () => {
  assert.deepEqual(collectServiceCatalogViolations(readServiceCatalog()), []);
});

test('repository layout catalog encodes the issue 900 release and non-release service scenario', () => {
  const catalog = readServiceCatalog();
  const releases = catalog.services.filter((service) => service.release === true);
  assert.deepEqual(
    releases.map((service) => service.imageIdentity).sort(),
    REQUIRED_RELEASE_IMAGES.toSorted()
  );
  for (const service of releases) {
    assert.equal(service.source, `apps/${service.id}`);
    assert.equal(service.dockerfile, `${service.source}/Dockerfile`);
    assert.equal(service.chart.alias.length > 0, true);
    assert.equal(service.chart.valueKey.length > 0, true);
    assert.equal(Array.isArray(service.directDependencies), true);
    assert.equal(service.interServiceCalls.length > 0, true);
  }

  const nonRelease = new Map(catalog.services.filter((service) => service.release === false).map((service) => [service.id, service]));
  for (const id of REQUIRED_NON_RELEASE_CANDIDATES) {
    const service = nonRelease.get(id);
    assert.equal(service?.status, 'non_release_candidate');
    assert.equal(service?.evidenceOnly, true);
    assert.equal(service?.imageIdentity, undefined);
    assert.equal(service?.chart, undefined);
  }
});
