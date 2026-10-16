// Best effort after COMMIT: never wait for external acknowledgements, and never
// log payloads or error messages (they may contain secret material).
export function rotationSideEffect(operation, fields, logger = console) {
  void Promise.resolve().then(operation).catch(error => {
    try {
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code : 'SIDE_EFFECT_FAILED';
      logger.error({ event: 'secret_rotation_side_effect_failed', ...fields, code });
    } catch { /* Logging must not affect a committed response. */ }
  });
}
