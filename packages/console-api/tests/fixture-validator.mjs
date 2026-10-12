/** Credential hygiene for synthetic test data; never inspect real session storage. */
export function assertSyntheticFixture(value, key = '', path = '$') {
  if (typeof value === 'string') {
    if (value.startsWith('eyJ')) throw new Error(`JWT-shaped string at ${path}`)
    if (key === 'tokenType') {
      if (value !== 'Bearer') throw new Error(`Invalid tokenType at ${path}`)
    } else if (/token|password|secret|credential|apikey/i.test(key)
      && !/(Ttl|MaxAge|ExpiresAt|ExpiresIn)$/.test(key)
      && !value.startsWith('synthetic-')) {
      throw new Error(`Non-synthetic credential at ${path}`)
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertSyntheticFixture(item, key, `${path}[${index}]`))
  } else if (value && typeof value === 'object') {
    for (const [childKey, item] of Object.entries(value)) {
      assertSyntheticFixture(item, childKey, `${path}.${childKey}`)
    }
  }
}
