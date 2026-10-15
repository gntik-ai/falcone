import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

const documents = [
  'apps/control-plane-executor/openapi/control-plane.openapi.json',
  'apps/control-plane-executor/openapi/families/iam.openapi.json',
].map(path => JSON.parse(readFileSync(path, 'utf8')));
const usersPath = '/v1/iam/realms/{realmId}/users';
const groupPath = '/v1/iam/realms/{realmId}/groups/{groupId}/members';
const ajv = new Ajv({ strict: false, validateFormats: false });

test('users pages and totals conform to operation-specific schemas in both published documents', async () => {
  for (const document of documents) {
    const schemas = document.components.schemas;
    assert.equal(document.paths[usersPath].get.responses['200'].content['application/json'].schema.$ref,
      '#/components/schemas/IamUserListResponse');
    assert.equal(schemas.IamUserListResponse.properties.page.$ref, '#/components/schemas/IamUserPageInfo');
    assert.ok(schemas.IamUserListResponse.required.includes('total'));
    assert.deepEqual(schemas.IamUserPageInfo.required.toSorted(), ['after', 'size']);
    const validatePage = ajv.compile(schemas.IamUserPageInfo);
    const validateTotal = ajv.compile(schemas.IamUserListResponse.properties.total);
    for (const length of [0, 200, 201]) {
      const response = await LOCAL_HANDLERS.iamListUsers({
        params: { realmId: 'fixture' }, query: { 'page[size]': '200' }, identity: { actorType: 'superadmin' },
        kcAdmin: {
          async listUsers() { return Array.from({ length }, (_, i) => ({ id: `user-${i}` })); },
          async countUsers() { return length; },
          async listUserRealmRoles() { return []; },
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(validatePage(response.body.page), true, ajv.errorsText(validatePage.errors));
      assert.equal(validateTotal(response.body.total), true, ajv.errorsText(validateTotal.errors));
    }
    for (const page of [
      { size: 0, after: null }, { size: 201, after: null }, { size: 2.5, after: null },
      { size: 25 }, { size: 25, after: 'x'.repeat(257) },
    ]) assert.equal(validatePage(page), false);
    for (const total of [-1, 2.5, '450']) assert.equal(validateTotal(total), false);
  }
});

test('group members and shared pagination schemas remain unchanged', () => {
  for (const document of documents) {
    assert.equal(document.paths[groupPath].get.responses['200'].content['application/json'].schema.$ref,
      '#/components/schemas/IamUserCollectionResponse');
    assert.equal(document.components.schemas.IamUserCollectionResponse.properties.page.$ref, '#/components/schemas/PageInfo');
    assert.equal(Object.hasOwn(document.components.schemas.IamUserCollectionResponse.properties, 'total'), false);
  }
});
