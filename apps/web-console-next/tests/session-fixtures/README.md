# Page session fixtures

The CSP spec (`tests/csp/assets.spec.mjs`) renders every concrete app route with a
synthetic session. Every request that no fixture answers aborts and fails the spec as
`unmatched`.

Each migrated page that calls the API adds one file here, `<page-id>.mjs`. It default-exports
an array of entries:

```js
export default [
  { method: 'GET', path: '/v1/example', json: { items: [] } },
  { method: 'POST', path: '/v1/example-query', respond: (request) => ({ items: [] }) },
];
```

Use synthetic data only: no real tenants, users or secrets.

- Entries match on the method and the URL path.
- `respond` receives the Playwright request, so it can branch on the body.
- Several pages may share an endpoint. Entries for the same method and path are tried in
  file-name order, and a `respond` that returns `undefined` passes the request to the next
  entry. When an endpoint is shared, use `respond` and answer only your page's requests.
- Two static `json` entries for the same method and path are an error that names both files.
- A request that no entry answers aborts and is reported unmatched.

Do not edit `tests/browser-session.mjs` or the CSP spec to add a page's endpoints.
