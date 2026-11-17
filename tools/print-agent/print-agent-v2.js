// Entry point for both the Windows service and a manual console run.
// All behaviour lives in server.mjs so it can be imported and tested.
// This import is a fallback for direct launches; production launchers also use --import.
import './instrument.mjs';
import { startPrintAgent } from './server.mjs';
import { sentry } from './sentry.mjs';

try {
  await startPrintAgent();
} catch (error) {
  const code = error?.code || 'AGENT_START_FAILED';
  await sentry.captureException(error, { phase: 'startup' });
  await sentry.flush(1800);
  // Stderr is captured by the service wrapper, so a failed start is diagnosable
  // without opening a terminal.
  console.error(`[OliTechs Print Agent] ${code}: ${error?.message || error}`);
  process.exit(1);
}
