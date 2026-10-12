import { it } from 'vitest'
import { coreCases } from './cases/core.mjs'

for (const [name, run] of coreCases) it(name, run)
