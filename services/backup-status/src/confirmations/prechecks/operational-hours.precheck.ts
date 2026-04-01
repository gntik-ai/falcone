import type { PrecheckResult } from './precheck.types.js'

export interface OperationalHoursConfig {
  enabled: boolean
  start: string
  end: string
}

function parseHHMM(value: string): number {
  const [hours, minutes] = value.split(':').map((n) => Number(n))
  return hours * 60 + minutes
}

export function operationalHoursPrecheck(
  requestedAt: Date,
  config: OperationalHoursConfig,
): PrecheckResult {
  if (!config.enabled) {
    return {
      result: 'ok',
      code: 'operational_hours_check',
      message: 'Verificación de horario operativo desactivada.',
    }
  }

  const current = requestedAt.getUTCHours() * 60 + requestedAt.getUTCMinutes()
  const start = parseHHMM(config.start)
  const end = parseHHMM(config.end)
  const within = current >= start && current < end

  if (!within) {
    return {
      result: 'warning',
      code: 'operational_hours_check',
      message: `La solicitud se realiza fuera del horario operativo (${config.start}–${config.end} UTC).`,
    }
  }

  return {
    result: 'ok',
    code: 'operational_hours_check',
    message: 'La solicitud se realiza dentro del horario operativo.',
  }
}
