import { RELIC_IDS } from '../config/balance';
import { validateAsset } from './SaveRepository';
import type { ForgeAvailability, ForgeJob, ForgeRequest, ValidatedAsset } from '../types/game';

export function validateForgeRequest(request: ForgeRequest): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(request.requestId) || !RELIC_IDS.includes(request.recipeId) || ![1, 2, 3].includes(request.rank) || !Number.isInteger(request.visualSeed) || request.visualSeed < 0 || request.visualSeed > 4294967295 || typeof request.allowPaid !== 'boolean' || (request.customization !== null && (request.customization.length > 400 || /[\u0000-\u001f]|https?:\/\//i.test(request.customization)))) throw new Error('Invalid forge request.');
}
export function proceduralJob(request: ForgeRequest): ForgeJob {
  validateForgeRequest(request);
  const now = Date.now();
  return { id: `local-${request.requestId}`, requestId: request.requestId, mode: 'offline', status: 'succeeded', progress: 1, asset: { kind: 'procedural', recipeId: request.recipeId, seed: request.visualSeed }, error: null, createdAt: now, updatedAt: now };
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function parseJob(value: unknown): ForgeJob {
  if (!isRecord(value)) throw new Error('Invalid forge response.');
  const fields = value;
  const { id, requestId, mode, status, progress, createdAt, updatedAt } = fields;
  if (typeof id !== 'string' || typeof requestId !== 'string' || (mode !== 'offline' && mode !== 'remote') || (status !== 'queued' && status !== 'running' && status !== 'succeeded' && status !== 'failed' && status !== 'cancelled') || (progress !== null && (typeof progress !== 'number' || progress < 0 || progress > 1)) || typeof createdAt !== 'number' || typeof updatedAt !== 'number') throw new Error('Invalid forge job fields.');
  let error: ForgeJob['error'] = null;
  if (fields.error !== null && typeof fields.error === 'object' && fields.error !== null && 'code' in fields.error && 'message' in fields.error && typeof fields.error.code === 'string' && typeof fields.error.message === 'string') error = { code: fields.error.code, message: fields.error.message };
  return { id, requestId, mode, status, progress, asset: fields.asset === null ? null : validateAsset(fields.asset), error, createdAt, updatedAt };
}
export class ForgeService {
  private readonly jobs = new Map<string, ForgeJob>();
  private readonly requests = new Map<string, string>();
  private disposed = false;
  constructor(private readonly options: { apiBase: string | null; allowPaid: boolean }) {}
  async getAvailability(signal?: AbortSignal): Promise<ForgeAvailability> {
    if (!this.options.apiBase) return { mode: 'offline', enabled: true, reason: 'Procedural forge. Xingchi official API adapter is not configured.' };
    const value = await this.request('/availability', { method: 'GET' }, signal);
    if (typeof value !== 'object' || value === null || !('mode' in value) || !('enabled' in value) || (value.mode !== 'offline' && value.mode !== 'remote') || typeof value.enabled !== 'boolean') throw new Error('Invalid forge availability.');
    return { mode: value.mode, enabled: value.enabled, reason: 'reason' in value && typeof value.reason === 'string' ? value.reason : null };
  }
  async submit(request: ForgeRequest, signal?: AbortSignal): Promise<ForgeJob> {
    if (this.disposed) throw new Error('Forge has been disposed.');
    validateForgeRequest(request);
    const existingId = this.requests.get(request.requestId);
    const existing = existingId ? this.jobs.get(existingId) : undefined;
    if (existing) return existing;
    if (request.allowPaid && !this.options.allowPaid) throw new Error('Paid generation is disabled. Use the procedural forge.');
    const job = this.options.apiBase ? parseJob(await this.request('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }, signal)) : proceduralJob(request);
    this.jobs.set(job.id, job);
    this.requests.set(request.requestId, job.id);
    return job;
  }
  async getJob(jobId: string, signal?: AbortSignal): Promise<ForgeJob> {
    const local = this.jobs.get(jobId);
    if (!this.options.apiBase) { if (!local) throw new Error('Forge job not found.'); return local; }
    const job = parseJob(await this.request(`/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, signal));
    this.jobs.set(job.id, job);
    return job;
  }
  async cancel(jobId: string): Promise<void> {
    if (this.options.apiBase) { await this.request(`/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }); return; }
    const job = this.jobs.get(jobId);
    if (job && job.status !== 'succeeded') { job.status = 'cancelled'; job.updatedAt = Date.now(); }
  }
  async resolveAsset(job: ForgeJob, signal?: AbortSignal): Promise<ValidatedAsset> {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (signal?.aborted || this.disposed) throw new Error('Forge waiting cancelled.');
      if (job.status === 'succeeded' && job.asset) return job.asset;
      if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error?.message ?? 'Generation did not complete.');
      await new Promise<void>((resolve, reject) => {
        const done = (): void => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(done, Math.min(10000, 2000 * 2 ** Math.min(attempt, 3)));
        const abort = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Forge waiting cancelled.')); };
        signal?.addEventListener('abort', abort, { once: true });
      });
      job = await this.getJob(job.id, signal);
    }
    throw new Error('Forge generation timed out.');
  }
  dispose(): void { this.disposed = true; }
  private async request(path: string, options: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const request: RequestInit = { ...options };
    if (signal) request.signal = signal;
    const response = await fetch(`${this.options.apiBase}${path}`, request);
    if (!response.ok) throw new Error(`Forge request failed (${response.status}).`);
    const value: unknown = await response.json();
    return value;
  }
}
