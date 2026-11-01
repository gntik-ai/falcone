import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const contractUrl = new URL('../../docs/contracts/platform-service-identity.md', import.meta.url)
const now = 1800000100 // Fixed example verification time, in Unix seconds.
const callers = {
  controller: 'example-controller',
  dispatcher: 'example-dispatcher',
  'build-orchestration': 'example-build-orchestration',
}
const audiences = {
  worker: 'urn:example:worker',
  compiler: 'urn:example:compiler',
  'falcone-internal': 'urn:example:falcone-internal',
  'oci-shim': 'urn:example:oci-shim',
  'image-intake': 'urn:example:image-intake',
  'image-assembler': 'urn:example:image-assembler',
}
// Independent, explicit v1 permissions; never derive expected grants from the document.
const allowed = [
  ['controller', 'urn:example:falcone-internal', 'desired-state', 'bound-preprovisioned'],
  ['controller', 'urn:example:falcone-internal', 'demand', 'bound-preprovisioned'],
  ['controller', 'urn:example:falcone-internal', 'status', 'bound-preprovisioned'],
  ['controller', 'urn:example:falcone-internal', 'audit', 'bound-preprovisioned'],
  ['dispatcher', 'urn:example:worker', 'execute', 'bound-execution'],
  ['dispatcher', 'urn:example:worker', 'cancel', 'bound-execution'],
  ['dispatcher', 'urn:example:oci-shim', 'execute', 'bound-oci'],
  ['dispatcher', 'urn:example:oci-shim', 'cancel', 'bound-oci'],
  ['build-orchestration', 'urn:example:compiler', 'build', 'bound-build'],
  ['build-orchestration', 'urn:example:compiler', 'validate', 'bound-build'],
  ['build-orchestration', 'urn:example:image-intake', 'verify', 'bound-build'],
  ['build-orchestration', 'urn:example:image-assembler', 'build', 'bound-build'],
]
const rules = {
  signature: 'Every callee MUST verify the JWS signature against the allow-listed issuer JWKS before trusting any claim; unsigned or signature-invalid tokens MUST be rejected.',
  jwks: 'Unknown kid MUST fail closed, including after a refetch without a matching key; allow at most one unknown-kid refetch per issuer per 30 seconds. JWKS unreachable MUST fail closed.',
  issuer: 'Issuer and realm MUST be explicitly allow-listed by the Falcone realm policy; wildcards, discovery from untrusted token URLs and implicit tenant-realm trust are forbidden.',
  authorization: 'Default deny: reject every caller, audience, operation or namespace binding not explicitly allowed below. No caller may create namespaces.',
  namespaces: 'Controller reads desired-state and demand and submits status and audit only in its bound preprovisioned namespaces. Dispatcher calls oci-shim only in its bound OCI namespaces. Bindings MUST be checked against trusted configuration, never token-supplied namespace claims.',
  custody: 'Client secrets MUST come from OpenBao via existing External Secrets, be referenced only by Secret name and a read-only mount path, and never be logged. No secret values belong in this contract.',
  keys: 'Worker and compiler MUST hold public verification keys only. Apart from its per-pod identity, oci-shim MUST hold public verification keys only.',
  shim: 'Dispatcher to oci-shim MUST use mutually authenticated TLS. The shim per-pod identity (certificate or projected token) MUST be mounted only in the shim container; dispatcher MUST verify it before sending any credential or request.',
  tenant: 'The tenant container MUST hold no token or identity material.',
  storage: 'Image-intake and image-assembler MUST reach only the host storage API, using a build credential. Build credential issuance and execution credentials are outside this contract.',
}

function section(text, label) {
  const start = `<!-- service-identity:${label}:start -->`
  const end = `<!-- service-identity:${label}:end -->`
  assert.equal(text.split(start).length, 2, `exactly one ${label} start marker`)
  assert.equal(text.split(end).length, 2, `exactly one ${label} end marker`)
  const from = text.indexOf(start) + start.length
  assert.ok(text.indexOf(end) > from, `${label} marker order`)
  return text.slice(from, text.indexOf(end)).trim()
}

function table(text, label, headers) {
  const lines = section(text, label).split('\n')
  const cells = (line) => {
    assert.match(line, /^\|.*\|$/, `${label} table row`)
    const values = line.slice(1, -1).split('|').map((value) => value.trim().replace(/^`([^`]+)`$/, '$1'))
    assert.equal(values.length, headers.length, `${label} column count`)
    assert.ok(values.every(Boolean), `${label} has no empty cells`)
    return values
  }
  assert.ok(lines.length >= 3, `${label} has data rows`)
  assert.deepEqual(cells(lines[0]), headers, `${label} headers`)
  assert.ok(cells(lines[1]).every((cell) => /^-{3,}$/.test(cell)), `${label} separator`)
  return lines.slice(2).map(cells)
}

function record(rows) {
  assert.equal(new Set(rows.map(([key]) => key)).size, rows.length, 'no duplicate keys')
  return Object.fromEntries(rows)
}

function jsonBlock(text, label) {
  const match = /^```json\n([\s\S]+)\n```$/.exec(section(text, label))
  assert.ok(match, `${label} must be one fenced JSON block`)
  const value = JSON.parse(match[1])
  // Tokenize strings before looking for object keys, so escaped quotes cannot hide duplicates.
  const tokens = match[1].match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)
  const keys = tokens.filter((token, index) => tokens[index + 1] === ':').map(JSON.parse)
  assert.equal(new Set(keys).size, keys.length, `${label} has no duplicate JSON keys`)
  return value
}

function validateClaims(claims, callee, policy, verificationTime = now) {
  // These are decoded examples, not signed tokens. alg represents the protected JWS header.
  assert.deepEqual(Object.keys(claims).sort(), ['alg', 'aud', 'azp', 'exp', 'iat', 'iss'])
  assert.ok(policy.algorithms.split(', ').includes(claims.alg), 'allowed protected algorithm')
  assert.equal(claims.iss, policy.issuer, 'allow-listed issuer')
  assert.equal(typeof claims.aud, 'string', 'single-valued audience')
  assert.equal(claims.aud, audiences[callee], 'callee-specific audience')
  assert.ok(Object.values(callers).includes(claims.azp), 'listed authorized party')
  const caller = Object.keys(callers).find((name) => callers[name] === claims.azp)
  assert.ok(allowed.some(([name, audience]) => name === caller && audience === claims.aud), 'caller may address callee')
  assert.ok(Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp), 'integer time claims')
  assert.ok(claims.exp > claims.iat, 'positive lifetime')
  assert.ok(claims.exp - claims.iat <= Number(policy['max-lifetime-seconds']), 'bounded lifetime')
  const skew = Number(policy['max-skew-seconds'])
  assert.ok(claims.iat <= verificationTime + skew, 'not issued in the future')
  assert.ok(claims.exp > verificationTime - skew, 'not expired')
}

function validateContract(text) {
  const privateHeaderPattern = ['-----BEGIN ', '(?:[A-Z0-9]+ )*', 'PRIVATE', ' KEY-----'].join('')
  assert.doesNotMatch(text, new RegExp(privateHeaderPattern), 'no PEM private keys')
  for (const candidate of text.matchAll(/\b([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g)) {
    const decodedHeader = Buffer.from(candidate[1], 'base64url').toString('utf8').trimStart()
    assert.ok(!decodedHeader.startsWith('{'), 'no serialized JWTs')
  }

  const metadata = record(table(text, 'metadata', ['Field', 'Value']))
  assert.deepEqual(metadata, { id: 'ctr-platform-service-identity', version: '1' })
  const parsedCallers = record(table(text, 'callers', ['Caller', 'Placeholder Keycloak client id']))
  assert.deepEqual(parsedCallers, callers)
  assert.equal(new Set(Object.values(parsedCallers)).size, 3, 'distinct client ids')
  const parsedAudiences = record(table(text, 'audiences', ['Callee', 'Audience']))
  assert.deepEqual(parsedAudiences, audiences)
  assert.equal(new Set(Object.values(parsedAudiences)).size, 6, 'unique per-callee audiences')

  const policy = record(table(text, 'token-policy', ['Rule', 'Value']))
  assert.deepEqual(Object.keys(policy).sort(), [
    'algorithms', 'audience-shape', 'issuer', 'jwks-ttl-seconds', 'max-lifetime-seconds',
    'max-skew-seconds', 'required-claims', 'unknown-kid-refetch-seconds',
  ])
  assert.deepEqual(policy.algorithms.split(', '), ['RS256', 'ES256'])
  assert.equal(policy['audience-shape'], 'single string matching the receiving callee')
  assert.equal(policy['required-claims'], 'iss, aud, azp, exp, iat')
  assert.equal(policy.issuer, 'https://identity.example.invalid/realms/platform-example')
  assert.ok(!policy.issuer.includes('*'), 'non-wildcard issuer allow-list')
  for (const [key, maximum] of [
    ['max-lifetime-seconds', 300], ['max-skew-seconds', 30], ['jwks-ttl-seconds', 600],
  ]) {
    assert.match(policy[key], /^(0|[1-9]\d*)$/, `${key} is an integer`)
    assert.ok(Number(policy[key]) <= maximum, `${key} upper bound`)
    assert.equal(Number(policy[key]), maximum, `${key} frozen v1 value`)
  }
  assert.equal(policy['unknown-kid-refetch-seconds'], '30')
  for (const [label, rule] of Object.entries(rules)) assert.equal(section(text, label), rule)

  const grants = table(text, 'permissions', ['Caller', 'Audience', 'Operation', 'Namespace scope'])
  assert.deepEqual(grants.map(JSON.stringify).sort(), allowed.map(JSON.stringify).sort(), 'exact v1 grants and scopes')
  for (const callee of Object.keys(audiences)) {
    validateClaims(jsonBlock(text, `claims-${callee}`), callee, policy)
  }
  return policy
}

test('platform service identity v1 publishes the complete binding contract and valid claim examples', () => {
  validateContract(readFileSync(contractUrl, 'utf8'))
})

function replaceSection(text, label, transform) {
  const before = section(text, label)
  const after = transform(before)
  assert.notEqual(after, before, `${label} fixture must actually change the contract`)
  return text.replace(before, after)
}

function rejectsContractMutation(label, transform, expectedError) {
  const text = readFileSync(contractUrl, 'utf8')
  validateContract(text)
  const mutated = replaceSection(text, label, transform)
  assert.throws(() => validateContract(mutated), expectedError)
}

test('contract rejects a missing version or changed identity', () => {
  rejectsContractMutation('metadata', (value) => value.replace('| version | 1 |', ''), /deep-equal/)
  rejectsContractMutation('metadata', (value) => value.replace('ctr-platform-service-identity', 'other-contract'), /deep-equal/)
  rejectsContractMutation('metadata', (value) => value.replace('| version | 1 |', '| version | 2 |'), /deep-equal/)
})

test('contract rejects duplicate clients, missing OCI callees and shared audiences', () => {
  rejectsContractMutation('callers', (value) => value.replace('example-controller', 'example-dispatcher'), /deep-equal/)
  rejectsContractMutation('audiences', (value) => value.replace('urn:example:compiler', 'urn:example:worker'), /deep-equal/)
  for (const callee of ['oci-shim', 'image-intake', 'image-assembler']) {
    rejectsContractMutation('audiences', (value) => value.split('\n').filter((line) => !line.startsWith(`| ${callee} |`)).join('\n'), /deep-equal/)
  }
})

test('all labelled rules and tables reject missing or duplicate sections and rows', () => {
  const text = readFileSync(contractUrl, 'utf8')
  validateContract(text)
  const labels = [
    ...Object.keys(rules), 'metadata', 'callers', 'audiences', 'token-policy', 'permissions',
    ...Object.keys(audiences).map((callee) => `claims-${callee}`),
  ]
  for (const label of labels) {
    const start = `<!-- service-identity:${label}:start -->`
    const end = `<!-- service-identity:${label}:end -->`
    assert.throws(() => validateContract(text.replace(start, '')), /start marker/)
    assert.throws(() => validateContract(text.replace(end, '')), /end marker/)
    assert.throws(() => validateContract(`${text}\n${start}\n${section(text, label)}\n${end}`), /start marker/)
  }
  for (const label of Object.keys(rules)) {
    rejectsContractMutation(label, () => '', /strictly equal/)
  }
  for (const label of ['metadata', 'callers', 'audiences', 'token-policy', 'permissions']) {
    const rows = section(text, label).split('\n').slice(2)
    for (const row of rows) {
      rejectsContractMutation(label, (value) => value.replace(`\n${row}`, ''), /AssertionError/)
      rejectsContractMutation(label, (value) => `${value}\n${row}`, /AssertionError/)
    }
  }
})

test('contract rejects weakened algorithm, lifetime, skew and issuer or JWKS policy', () => {
  const changes = [
    ['RS256, ES256', 'RS256, ES256, HS256'],
    ['max-lifetime-seconds | 300', 'max-lifetime-seconds | 3600'],
    ['max-skew-seconds | 30', 'max-skew-seconds | 31'],
    ['jwks-ttl-seconds | 600', 'jwks-ttl-seconds | 601'],
    ['unknown-kid-refetch-seconds | 30', 'unknown-kid-refetch-seconds | 1'],
    ['https://identity.example.invalid/realms/platform-example', 'https://identity.example.invalid/realms/*'],
    ['required-claims | iss, aud, azp, exp, iat', 'required-claims | iss, aud, azp, iat'],
  ]
  for (const [before, after] of changes) {
    rejectsContractMutation('token-policy', (value) => value.replace(before, after), /AssertionError/)
  }
  for (const key of ['max-lifetime-seconds', 'max-skew-seconds', 'jwks-ttl-seconds', 'unknown-kid-refetch-seconds']) {
    for (const value of ['', '-1', 'NaN', 'Infinity', '1.5', '300seconds', '0300']) {
      rejectsContractMutation('token-policy', (block) => block.replace(new RegExp(`(${key} \\| )\\d+`), `$1${value}`), /AssertionError/)
    }
  }
})

test('decoded claims reject each invalid token pattern at the receiving callee', () => {
  const text = readFileSync(contractUrl, 'utf8')
  const policy = validateContract(text)
  const valid = jsonBlock(text, 'claims-worker')
  const invalid = [
    ['expired', { iat: 1799999600, exp: 1799999900 }, /not expired/],
    ['wrong audience', { aud: 'urn:example:compiler' }, /callee-specific audience/],
    ['multiple audiences', { aud: ['urn:example:worker', 'urn:example:compiler'] }, /single-valued audience/],
    ['single audience array', { aud: ['urn:example:worker'] }, /single-valued audience/],
    ['untrusted issuer', { iss: 'https://untrusted.example.invalid/realms/other' }, /allow-listed issuer/],
    ['symmetric algorithm', { alg: 'HS256' }, /allowed protected algorithm/],
    ['unsigned token', { alg: 'none' }, /allowed protected algorithm/],
    ['unlisted client', { azp: 'example-unlisted' }, /listed authorized party/],
    ['listed but unauthorized client', { azp: 'example-controller' }, /caller may address callee/],
    ['excess lifetime', { exp: 1800003600 }, /bounded lifetime/],
    ['future issuance', { iat: 1800000200 }, /not issued in the future/],
    ['nonpositive lifetime', { exp: 1800000000 }, /positive lifetime/],
    ['string expiry', { exp: '1800000300' }, /integer time claims/],
    ['fractional issuance', { iat: 1800000000.5 }, /integer time claims/],
  ]
  for (const [name, changes, expectedError] of invalid) {
    assert.throws(() => validateClaims({ ...valid, ...changes }, 'worker', policy), expectedError, name)
  }
  for (const key of ['alg', 'iss', 'aud', 'azp', 'exp', 'iat']) {
    const missing = { ...valid }
    delete missing[key]
    assert.throws(() => validateClaims(missing, 'worker', policy), /deep-equal/, `missing ${key}`)
  }
  // Literal boundary examples establish the meaning of the 30-second clock tolerance.
  validateClaims({ ...valid, iat: 1799999830, exp: 1800000130 }, 'worker', policy, 1800000159)
  assert.throws(() => validateClaims({ ...valid, iat: 1799999830, exp: 1800000130 }, 'worker', policy, 1800000160), /not expired/)
  validateClaims({ ...valid, iat: 1800000130, exp: 1800000300 }, 'worker', policy)
  assert.throws(() => validateClaims({ ...valid, iat: 1800000131, exp: 1800000300 }, 'worker', policy), /not issued in the future/)
})

test('claim examples reject duplicate JSON properties and missing fences', () => {
  rejectsContractMutation('claims-worker', (value) => value.replace('"exp": 1800000300', '"exp": 1800000001, "exp": 1800000300'), /no duplicate JSON keys/)
  rejectsContractMutation('claims-worker', (value) => value.replace('```json', ''), /one fenced JSON block/)
  rejectsContractMutation('claims-worker', (value) => value.replace('1800000300', '1800003600'), /bounded lifetime/)
})

test('authorization is default deny and rejects extra caller, audience or operation grants', () => {
  const forbidden = [
    '| dispatcher | urn:example:compiler | build | bound-build |',
    '| controller | urn:example:worker | execute | bound-preprovisioned |',
    '| dispatcher | urn:example:image-assembler | build | bound-oci |',
    '| controller | urn:example:falcone-internal | namespace-create | bound-preprovisioned |',
  ]
  for (const row of forbidden) {
    rejectsContractMutation('permissions', (value) => `${value}\n${row}`, /exact v1 grants and scopes/)
  }
  rejectsContractMutation('authorization', () => 'Allow every authenticated caller.', /strictly equal/)
})

test('every controller and dispatcher OCI grant rejects unbound namespace scopes and namespace creation', () => {
  const text = readFileSync(contractUrl, 'utf8')
  const rows = table(text, 'permissions', ['Caller', 'Audience', 'Operation', 'Namespace scope'])
  for (const [caller, audience, operation, scope] of rows) {
    if (caller !== 'controller' && !(caller === 'dispatcher' && audience === 'urn:example:oci-shim')) continue
    const row = `| ${caller} | ${audience} | ${operation} | ${scope} |`
    for (const replacement of ['*', 'cluster', '', 'namespace-create']) {
      const weakened = `| ${caller} | ${audience} | ${operation} | ${replacement} |`
      rejectsContractMutation('permissions', (value) => value.replace(row, weakened), /AssertionError/)
    }
    rejectsContractMutation('permissions', (value) => value.replace(row, `| ${caller} | ${audience} | namespace-create | ${scope} |`), /exact v1 grants and scopes/)
  }
})

test('custody rejects embedded private keys or serialized JWTs anywhere in the contract', () => {
  const text = readFileSync(contractUrl, 'utf8')
  validateContract(text)
  for (const kind of ['PRIVATE', 'RSA PRIVATE', 'EC PRIVATE', 'ENCRYPTED PRIVATE']) {
    const header = ['-----BEGIN', `${kind} KEY-----`].join(' ')
    assert.throws(() => validateContract(`${text}\n${header}`), /no PEM private keys/)
  }
  for (const prefix of ['', ' \n']) {
    const token = [
      Buffer.from(prefix + JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'example-placeholder' })).toString('base64url'),
      Buffer.from('example-placeholder-signature').toString('base64url'),
    ].join('.')
    assert.throws(() => validateContract(`${text}\n${token}`), /no serialized JWTs/)
  }
})
