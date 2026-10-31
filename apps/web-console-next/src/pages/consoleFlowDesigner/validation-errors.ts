import type { ValidationError } from './flows'
import { formatMessage } from './messages'

const required: Record<string, string[]> = {
  'FLW-E001': ['nodeId'], 'FLW-E002': ['nodeId'], 'FLW-E003': ['nodeId', 'target'],
  'FLW-E004': ['flowId', 'flowVersion'], 'FLW-E005': ['expression', 'engine'],
  'FLW-E006': ['taskType'], 'FLW-E007': ['schedule'], 'FLW-E008': ['duration', 'nodeId'], 'FLW-E009': ['nodeId'],
}

// Preserve the post-blueprint formatter: structured parameters, safe fallbacks, no server copy.
export function describeFlowValidationError(error: Pick<ValidationError, 'code' | 'nodeId' | 'params'>, locale = 'es'): string {
  if (!Object.hasOwn(required, error.code)) return formatMessage('validationUnknown', {}, locale)
  const params = error.params
  const complete = params && required[error.code].every((name) => typeof params[name] === 'string')
  return formatMessage(`${complete ? 'validationParams' : 'validation'}.${error.code}`, complete ? params as Record<string, string> : {}, locale)
}
