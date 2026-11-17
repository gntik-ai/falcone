import type { FunctionAction } from './api'

// The serverless-function entries of the legacy snippet catalog (lib/snippets/snippet-catalog.ts:99-130).
// Placeholders keep the legacy text; the endpoint is the function's public URL and is never inferred.
const templates = [
  { id: 'curl', label: 'curl', language: 'bash', code: 'curl -X POST "{URL}" -H "Content-Type: application/json" -H "Authorization: Bearer <API_TOKEN>" -d \'{"ping":true}\'', note: true },
  { id: 'node', label: 'node', language: 'js', code: "const response = await fetch('{URL}', {\n  method: 'POST',\n  headers: {\n    'content-type': 'application/json',\n    authorization: 'Bearer <API_TOKEN>'\n  },\n  body: JSON.stringify({ ping: true })\n})\n\nconsole.log(await response.json())", note: false },
  { id: 'python', label: 'python', language: 'python', code: "import requests\n\nresponse = requests.post(\n    '{URL}',\n    headers={\n        'content-type': 'application/json',\n        'authorization': 'Bearer <API_TOKEN>'\n    },\n    json={'ping': True}\n)\n\nprint(response.json())", note: false },
] as const

const STATE_WARNING = new Set(['provisioning', 'pending', 'error', 'degraded', 'failed'])

export interface Snippet { id: string; label: 'curl' | 'node' | 'python'; language: string; code: string; notes: ('curl' | 'external' | 'missing')[]; state: string | null }

export function functionSnippets(action: FunctionAction): Snippet[] {
  const url = action.httpExposure?.publicUrl ?? null
  const state = action.provisioning?.state ?? action.status ?? null
  return templates.map((template) => ({
    id: template.id,
    label: template.id,
    language: template.language,
    code: template.code.replace('{URL}', () => url ?? '<RESOURCE_EXTRA_B>'),
    notes: [
      ...(template.note ? ['curl' as const] : []),
      ...(action.httpExposure?.enabled === true ? [] : ['external' as const]),
      ...(url === null ? ['missing' as const] : []),
    ],
    state: state && STATE_WARNING.has(state.toLowerCase()) ? state : null,
  }))
}
