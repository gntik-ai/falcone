import { endpoints, responseFor, variants } from './fixtures/shell'
import type { EndpointScenario, ParityEndpoint, Role } from './manifest'

export function createParityNetwork(role: Role) {
  const registered: Record<string, ParityEndpoint> = {}
  let selected: Record<string, EndpointScenario> = {}
  const attempts: Record<string, number> = {}
  return {
    registerEndpoints(value: Record<string, ParityEndpoint>) {
      const all: Record<string, { method: string; path: string }> = { ...endpoints, ...registered }
      for (const [name, endpoint] of Object.entries(value)) {
        if (name in all || Object.values(all).some((other) => other.method === endpoint.method && other.path === endpoint.path)) throw new Error(`Duplicate endpoint ${name}`)
        all[name] = endpoint
      }
      Object.assign(registered, value)
    },
    setVariants(value: Record<string, EndpointScenario>) {
      for (const [name, scenario] of Object.entries(value)) {
        const steps = typeof scenario === 'string' ? [scenario] : scenario.sequence ?? [scenario.variant ?? 'success']
        if (!steps.length || steps.some((step) => !variants.includes(step))) throw new Error(`Unknown variant for ${name}`)
        if (typeof scenario !== 'string' && scenario.delayMs !== undefined && (!Number.isFinite(scenario.delayMs) || scenario.delayMs < 0)) throw new Error(`Invalid delay for ${name}`)
      }
      selected = value
      for (const name of Object.keys(attempts)) delete attempts[name]
    },
    async respond(method: string, path: string) {
      const all: Record<string, { method: string; path: string }> = { ...endpoints, ...registered }
      const name = Object.keys(all).find((key) => all[key].method === method && all[key].path === path)
      if (!name) return null
      const scenario = selected[name] ?? 'success'
      const steps = typeof scenario === 'string' ? [scenario] : scenario.sequence ?? [scenario.variant ?? 'success']
      const attempt = attempts[name] ?? 0
      attempts[name] = attempt + 1
      const variant = steps[Math.min(attempt, steps.length - 1)]
      if (typeof scenario !== 'string' && scenario.delayMs) await new Promise((done) => setTimeout(done, scenario.delayMs))
      if (!(name in registered)) return responseFor(name, variant, role)
      if (variant === 'network') return { network: true }
      if (variant !== 'success' && variant !== 'empty') return { status: Number(variant), body: { code: `HTTP_${variant}`, message: 'synthetic-error' } }
      return { status: 200, body: variant === 'empty' ? registered[name].fixtures.empty ?? {} : registered[name].fixtures.success }
    },
  }
}
