import type { WebSocket } from '@playwright/test';
export interface Capability {
  readHttp(signal: AbortSignal): Promise<number>;
  subscribe(onEventId: (id: string) => void, signal: AbortSignal): Promise<() => Promise<void>>;
}
export interface RevocationOptions {
  acquire(signal: AbortSignal): Promise<{ subject: Capability; control: Capability }>;
  revoke(signal: AbortSignal): Promise<boolean>;
  emit(eventId: string, signal: AbortSignal): Promise<boolean>;
  cleanup(signal: AbortSignal): Promise<void>;
  deadlineMs: number;
  observationMs?: number;
  operationTimeoutMs?: number;
}
export interface RevocationReport {
  schemaVersion: 1;
  status: 'passed' | 'failed' | 'incomplete' | 'error';
  execution: 'completed' | 'timed_out' | 'interrupted';
  observations: 'complete' | 'incomplete';
  assertions: 'passed' | 'failed' | 'not_evaluated';
  cleanup: 'completed' | 'failed';
  policy: { deadlineMs: number; observationMs: number; operationTimeoutMs: number };
  http: { before: { subject: number; control: number } | null; after: { subject: number | null; control: number | null } | null };
  canaries: { before: { subject: boolean; control: boolean }; after: { subject: boolean; control: boolean } };
  canaryIds: { before: string; after: string };
  violations: string[];
  missing: string[];
  timeline: { kind: string; elapsedMs: number }[];
  durationMs: number;
}
export function rehearseRevocation(options: RevocationOptions): Promise<RevocationReport>;
export function revocationExitCode(report: RevocationReport): 0 | 1 | 2 | 3;
export function playwrightWebSocketCapability(options: {
  socket: WebSocket;
  readHttp(signal: AbortSignal): Promise<number>;
  eventId(payload: string | Buffer): string | undefined;
}): Capability;
