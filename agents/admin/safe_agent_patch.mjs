function recoveryError(message, cause) {
  const error = new Error(message, { cause });
  error.originalError = cause;
  return error;
}

/**
 * Apply one narrow Agent Studio PATCH with fail-closed recovery semantics.
 *
 * classify(state) must return
 * { state: 'before' | 'intended' | 'equivalent' | 'drift', details }.
 * Agent Studio does not expose an atomic conditional PATCH here. Therefore an
 * ambiguous outcome is read back and recorded, but never automatically rolled
 * back: a separate read-then-write could overwrite a concurrent operator edit.
 */
export async function applyPatchWithRecovery({
  read,
  patch,
  classify,
  intendedPayload,
  recordRecovery = () => {},
}) {
  let originalError;
  try {
    await patch(intendedPayload);
    const after = await read();
    const assessment = classify(after);
    if (!['intended', 'equivalent'].includes(assessment.state)) {
      throw new Error(`Post-PATCH state was ${assessment.state}, not intended`);
    }
    return after;
  } catch (error) {
    originalError = error;
  }

  let current;
  try {
    current = await read();
  } catch (readError) {
    recordRecovery({
      state: 'unknown-manual-recovery-required',
      originalError: String(originalError),
      readbackError: String(readError),
    });
    throw recoveryError('PATCH outcome is ambiguous and readback failed; no rollback attempted', originalError);
  }

  const currentAssessment = classify(current);
  if (['before', 'equivalent'].includes(currentAssessment.state)) {
    recordRecovery({
      state: 'before-noop',
      originalError: String(originalError),
      assessment: currentAssessment.details,
    });
    throw recoveryError('PATCH did not change the reviewed target; no rollback required', originalError);
  }
  if (currentAssessment.state !== 'intended') {
    recordRecovery({
      state: 'drift-refused',
      originalError: String(originalError),
      assessment: currentAssessment.details,
    });
    throw recoveryError('Target drifted after PATCH; refusing to overwrite concurrent changes', originalError);
  }
  recordRecovery({
    state: 'intended-manual-recovery-required',
    originalError: String(originalError),
    assessment: currentAssessment.details,
  });
  throw recoveryError(
    'PATCH reached the intended state but its response was ambiguous; automatic rollback is disabled to protect concurrent edits',
    originalError,
  );
}
