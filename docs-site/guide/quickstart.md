# Quickstart: a TODO app in React

This guide builds a small **TODO list** React app on top of In Falcone. You will:

1. Provision a tenant, a workspace and a `todos` collection.
2. Mint an **anon API key** to use from the browser.
3. Wire a React frontend to the **data API** through the gateway.
4. (Bonus) make the list **realtime** with Server-Sent Events.

> [!NOTE]
> This assumes a running platform — either the [docker-compose stack](/guide/installation#docker-compose-local) or a [cluster install](/guide/installation#kubernetes). We'll call the gateway `https://api.example.test`; replace it with your `publicSurface.hostnames.api`.

## 1. Provision (control plane)

Provisioning uses the **`structural_admin`** routes, authenticated with an admin Bearer token from Keycloak. You can do all of this from the [web console](/guide/what-is-falcone#a-guided-tour-of-a-real-deployment) (Tenants → create, then Database → create collection, then Service Accounts → create key) — or via the API:

```bash
export API=https://api.example.test
export ADMIN="Bearer $(your-keycloak-token)"

# Create a tenant
curl -sX POST $API/v1/tenants -H "authorization: $ADMIN" \
  -H 'content-type: application/json' \
  -d '{"name":"Acme","slug":"acme"}'

# Create a workspace inside it
curl -sX POST $API/v1/workspaces -H "authorization: $ADMIN" \
  -H 'content-type: application/json' \
  -d '{"tenantSlug":"acme","name":"todo-app"}'

# Define the `todos` collection (schema)
curl -sX POST $API/v1/schemas -H "authorization: $ADMIN" \
  -H 'content-type: application/json' \
  -d '{
        "collection":"todos",
        "fields":[
          {"name":"title","type":"text"},
          {"name":"done","type":"boolean","default":false}
        ]
      }'
```

### Mint an anon API key

The **anon key** (`flc_anon_…`) is a low-privilege, read-mostly credential safe to ship in a frontend. The gateway routes requests by the `apikey` header, and the executor binds the key to a **non-`BYPASSRLS` database role**, so PostgreSQL Row-Level Security still scopes every query to this tenant.

```bash
curl -sX POST $API/v1/api-keys -H "authorization: $ADMIN" \
  -H 'content-type: application/json' \
  -d '{"workspace":"todo-app","type":"anon"}'
# → { "id": "...", "key": "flc_anon_XXXXXXXXXXXXXXXX", "type": "anon" }
```

Copy the returned `key`. (For privileged server-side work you'd mint a `service` key — `flc_service_…` — instead, and **never** expose it to the browser.)

> [!IMPORTANT]
> Authenticate data-plane calls with the **`apikey` header** — `apikey: flc_anon_…` — not `Authorization`. The gateway routes anon/service traffic by that header.

## 2. Create the React app

```bash
npm create vite@latest todo-app -- --template react
cd todo-app
npm install
```

Add the key to `.env.local` (Vite exposes `VITE_*` to the client):

```ini
VITE_FALCONE_API=https://api.example.test
VITE_FALCONE_ANON_KEY=flc_anon_XXXXXXXXXXXXXXXX
```

### A tiny data-API client

The data API is REST over the `todos` collection:

| Action | Request |
| --- | --- |
| List | `GET /v1/collections/todos/documents` |
| Create | `POST /v1/collections/todos/documents` (document as JSON body) |
| Update | `PUT /v1/collections/todos/documents/{id}` |
| Delete | `DELETE /v1/collections/todos/documents/{id}` |
| Filter | `GET /v1/collections/todos/documents?done=eq.false&order=created_at.desc` |

`src/falcone.js`:

```js
const BASE = import.meta.env.VITE_FALCONE_API
const KEY = import.meta.env.VITE_FALCONE_ANON_KEY

async function call(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      // The gateway routes anon/service traffic by the `apikey` header.
      apikey: KEY,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`Falcone ${res.status}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

export const todos = {
  list: () => call('/v1/collections/todos/documents?order=created_at.desc'),
  create: (title) =>
    call('/v1/collections/todos/documents', {
      method: 'POST',
      body: JSON.stringify({ title, done: false }),
    }),
  toggle: (id, done) =>
    call(`/v1/collections/todos/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ done }),
    }),
  remove: (id) =>
    call(`/v1/collections/todos/documents/${id}`, { method: 'DELETE' }),
}
```

### The component

`src/App.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { todos } from './falcone'

export default function App() {
  const [items, setItems] = useState([])
  const [title, setTitle] = useState('')

  const refresh = () => todos.list().then((r) => setItems(r.data ?? r))
  useEffect(() => { refresh() }, [])

  async function add(e) {
    e.preventDefault()
    if (!title.trim()) return
    await todos.create(title.trim())
    setTitle('')
    refresh()
  }

  return (
    <main style={{ maxWidth: 480, margin: '3rem auto', fontFamily: 'system-ui' }}>
      <h1>TODO</h1>
      <form onSubmit={add} style={{ display: 'flex', gap: 8 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)}
               placeholder="What needs doing?" style={{ flex: 1 }} />
        <button>Add</button>
      </form>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((t) => (
          <li key={t.id} style={{ display: 'flex', gap: 8, padding: '6px 0' }}>
            <input type="checkbox" checked={!!t.done}
                   onChange={() => todos.toggle(t.id, !t.done).then(refresh)} />
            <span style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none' }}>
              {t.title}
            </span>
            <button onClick={() => todos.remove(t.id).then(refresh)}>✕</button>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

Run it:

```bash
npm run dev
```

You now have a working multi-tenant TODO app. Every request carries the anon key; the platform resolves the tenant **from the key**, and RLS guarantees you only ever see Acme's todos.

## 3. (Bonus) Make it realtime

Instead of polling with `refresh()`, subscribe to live changes over **Server-Sent Events**. Because a browser `EventSource` cannot set headers, realtime routes accept the anon key as a `?apikey=` query parameter (read-only, low-privilege by design):

```js
export function subscribeTodos(onChange) {
  const url = new URL(`${BASE}/v1/events/subscribe`)
  url.searchParams.set('collection', 'todos')
  url.searchParams.set('apikey', KEY)
  const es = new EventSource(url)
  es.onmessage = (e) => onChange(JSON.parse(e.data))
  return () => es.close()
}
```

```jsx
useEffect(() => {
  refresh()
  return subscribeTodos(() => refresh())   // re-fetch whenever this tenant's todos change
}, [])
```

Changes made by *this tenant* — from another browser tab, a teammate, or a server-side `service` key — now appear instantly. Other tenants' changes never arrive: the realtime pipeline matches on the verified tenant inside the source (a consumer-side `tenantId` filter on the document store's Postgres logical-replication stream). See [Realtime Subscriptions](/api/realtime) for the full model.

## Where to go next

- [Data API reference](/api/postgresql) — filtering, ordering, keyset pagination.
- [Gateway & keys](/api/gateway) — anon vs service keys, JWT issuance, rate limiting.
- [Security model](/architecture/security) — how tenant isolation is enforced end-to-end.
