import type { ForgeAvailability, ForgeJob, ForgeRequest } from '../src/types/game';

export interface XingchiProviderAdapter {
  availability(): Promise<ForgeAvailability>;
  submit(request: ForgeRequest): Promise<ForgeJob>;
  status(id: string): Promise<ForgeJob>;
  cancel(id: string): Promise<void>;
}

export class UnconfiguredXingchiProvider implements XingchiProviderAdapter {
  async availability(): Promise<ForgeAvailability> { return { mode: 'offline', enabled: false, reason: 'Official Xingchi endpoints, authentication, job schema and pricing are unverified. No remote adapter is enabled.' }; }
  async submit(_request: ForgeRequest): Promise<ForgeJob> { throw new Error('UNCONFIGURED: a reviewed official Xingchi adapter is required before paid submission.'); }
  async status(_id: string): Promise<ForgeJob> { throw new Error('UNCONFIGURED: no remote job exists.'); }
  async cancel(_id: string): Promise<void> { throw new Error('CANCEL_UNSUPPORTED: no verified remote cancellation contract.'); }
}
