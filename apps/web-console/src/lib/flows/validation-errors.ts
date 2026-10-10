import type { ValidationError } from '@/types/flows'

// Console-owned copy. Shared validators and API responses remain in English.
const fallbacks: Record<string, string> = {
  'FLW-E001': 'Los ID de nodo deben ser únicos dentro del flujo.',
  'FLW-E002': 'El grafo de nodos contiene un ciclo.',
  'FLW-E003': 'Una conexión referencia un nodo desconocido.',
  'FLW-E004': 'No se pudo resolver una referencia de subflujo.',
  'FLW-E005': 'No se pudo analizar una expresión con el motor configurado.',
  'FLW-E006': 'El tipo de tarea no está presente en el catálogo.',
  'FLW-E007': 'La programación cron no es válida (5 o 6 campos).',
  'FLW-E008': 'La duración del nodo de espera no es una duración ISO 8601 válida.',
  'FLW-E009': 'La rama necesita al menos dos brazos, o un brazo más una conexión predeterminada.'
}

/** Localize structured diagnostics without ever displaying a raw server message. */
export function describeFlowValidationError(error: Pick<ValidationError, 'code' | 'nodeId' | 'params'>): string {
  const fallback = Object.hasOwn(fallbacks, error.code)
    ? fallbacks[error.code]
    : 'La validación del flujo encontró un error.'
  const params = error.params
  const has = (...keys: string[]) => keys.every((key) => typeof params?.[key] === 'string')
  if (!params) return fallback

  switch (error.code) {
    case 'FLW-E001':
      if (has('nodeId')) return `ID de nodo duplicado "${params.nodeId}"; los ID de nodo deben ser únicos dentro del flujo.`
      break
    case 'FLW-E002':
      if (has('nodeId')) return `El grafo de nodos contiene un ciclo alcanzable desde el nodo "${params.nodeId}".`
      break
    case 'FLW-E003':
      if (has('nodeId', 'target')) return `El nodo "${params.nodeId}" referencia el nodo desconocido "${params.target}".`
      break
    case 'FLW-E004':
      if (has('flowId', 'flowVersion')) return `La referencia de subflujo ${params.flowId}@${params.flowVersion} no pudo resolverse.`
      break
    case 'FLW-E005':
      if (has('expression', 'engine')) return `La expresión "${params.expression}" no puede analizarse con el motor ${params.engine}.`
      break
    case 'FLW-E006':
      if (has('taskType')) return `Tipo de tarea desconocido "${params.taskType}"; no está presente en el catálogo de tipos de tarea.`
      break
    case 'FLW-E007':
      if (has('schedule')) return `La programación cron "${params.schedule}" no es una expresión cron POSIX válida (5 o 6 campos).`
      break
    case 'FLW-E008':
      if (has('duration', 'nodeId')) return `La duración "${params.duration}" del nodo de espera "${params.nodeId}" no es una duración ISO 8601 válida.`
      break
    case 'FLW-E009':
      if (has('nodeId')) return `La rama "${params.nodeId}" necesita al menos dos brazos, o un brazo más una conexión predeterminada.`
  }
  return fallback
}
