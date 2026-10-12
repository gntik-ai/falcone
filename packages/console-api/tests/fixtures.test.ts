import { it } from 'vitest'
import { fixtureCases } from './cases/fixtures.mjs'

for (const [name, run] of fixtureCases) it(name, run)
