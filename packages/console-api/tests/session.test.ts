// @vitest-environment jsdom
import { it } from 'vitest'
import { sessionCases } from './cases/session.mjs'

for (const [name, run] of sessionCases) it(name, run)
