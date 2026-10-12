import { it } from 'vitest'
import { httpCases } from './cases/http.mjs'

for (const [name, run] of httpCases) it(name, run)
