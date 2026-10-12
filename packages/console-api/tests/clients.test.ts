// @vitest-environment jsdom
import { it } from 'vitest'
import { clientCases } from './cases/clients.mjs'

for (const [name, run] of clientCases) it(name, run)
