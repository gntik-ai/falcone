import { SAGA_CONFIG } from './saga-config.mjs';
import {
  appendCompensationLog,
  updateStepCompensationAttempts,
  updateStepStatus
} from './saga-state-store.mjs';

export function backoffDelay(attempt, config = SAGA_CONFIG.compensation) {
  return Math.min(config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt), config.maxDelayMs);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function compensateSaga(sagaInstance, succeededSteps, definition, sagaCtx) {
  const orderedSteps = [...succeededSteps].sort((a, b) => b.step_ordinal - a.step_ordinal);
  const failedSteps = [];

  for (const step of orderedSteps) {
    const stepDef = definition.steps.find((candidate) => candidate.ordinal === step.step_ordinal);
    if (!stepDef) {
      failedSteps.push(step.step_key);
      continue;
    }

    if (step.status === 'compensated') {
      await appendCompensationLog(sagaInstance.saga_id, step.step_id, 0, 'skipped-idempotent', null);
      continue;
    }

    await updateStepStatus(step.step_id, 'compensating');

    let compensated = false;
    for (let attempt = 1; attempt <= SAGA_CONFIG.compensation.maxRetries; attempt += 1) {
      try {
        await updateStepCompensationAttempts(step.step_id, attempt);
        await stepDef.compensate(step.input_snapshot, step.output_snapshot, sagaCtx);
        await updateStepStatus(step.step_id, 'compensated');
        await appendCompensationLog(sagaInstance.saga_id, step.step_id, attempt, 'succeeded', null);
        compensated = true;
        break;
      } catch (error) {
        await appendCompensationLog(sagaInstance.saga_id, step.step_id, attempt, 'failed', {
          message: error?.message ?? String(error)
        });
        if (attempt < SAGA_CONFIG.compensation.maxRetries) {
          await sleep(backoffDelay(attempt, SAGA_CONFIG.compensation));
        }
      }
    }

    if (!compensated) {
      await updateStepStatus(step.step_id, 'compensation-failed', { stepKey: step.step_key });
      failedSteps.push(step.step_key);
    }
  }

  return { allCompensated: failedSteps.length === 0, failedSteps };
}
