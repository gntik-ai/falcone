import type { PrecheckResult } from './precheck.types.js'

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000
}

export function snapshotAgePrecheck(
  snapshotCreatedAt: Date,
  thresholdHours: number,
  requestedAt: Date = new Date(),
): PrecheckResult {
  const ageHours = hoursBetween(snapshotCreatedAt, requestedAt)

  if (ageHours > thresholdHours) {
    return {
      result: 'warning',
      code: 'snapshot_age_check',
      message: `El snapshot tiene ${Math.round(ageHours)} horas de antigüedad, superior al umbral de ${thresholdHours} horas configurado.`,
      metadata: {
        age_hours: Math.round(ageHours),
        threshold_hours: thresholdHours,
      },
    }
  }

  return {
    result: 'ok',
    code: 'snapshot_age_check',
    message: 'La antigüedad del snapshot está dentro del umbral configurado.',
  }
}
