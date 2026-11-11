// Entry point for both the Windows service and a manual console run.
// All behaviour lives in server.mjs so it can be imported and tested.
import { startPrintAgent } from './server.mjs';

try {
  await startPrintAgent();
} catch (error) {
  const code = error?.code || 'AGENT_START_FAILED';
  // Stderr is captured by the service wrapper, so a failed start is diagnosable
  // without opening a terminal.
  console.error(`[OliTechs Print Agent] ${code}: ${error?.message || error}`);
  process.exit(1);
}
