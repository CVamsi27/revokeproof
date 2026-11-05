import type { WebSocket } from '@playwright/test';
import {
  playwrightWebSocketCapability, rehearseRevocation, revocationExitCode,
  type Capability, type RevocationOptions, type RevocationReport,
} from '@developer-pain-lab/revokeproof';

declare const subjectSocket: WebSocket;
declare const controlSocket: WebSocket;
declare const readStatus: (signal: AbortSignal) => Promise<number>;
const capability = (socket: WebSocket): Capability => playwrightWebSocketCapability({
  socket, readHttp: readStatus,
  eventId: payload => JSON.parse(String(payload)).id as string,
});
const options: RevocationOptions = {
  acquire: async () => ({ subject: capability(subjectSocket), control: capability(controlSocket) }),
  revoke: async () => true,
  emit: async () => true,
  cleanup: async () => {},
  deadlineMs: 100,
};
const report: RevocationReport = await rehearseRevocation(options);
const code: 0 | 1 | 2 | 3 = revocationExitCode(report);
void code;
