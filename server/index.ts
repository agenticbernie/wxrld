import { createServer } from 'node:http';
import { proceduralJob, validateForgeRequest } from '../src/services/ForgeService';
import { RELIC_IDS } from '../src/config/balance';
import type { ForgeJob, ForgeRequest, RelicRecipeId } from '../src/types/game';
import { UnconfiguredXingchiProvider } from './xingchi-provider';

const provider = new UnconfiguredXingchiProvider();
const jobs = new Map<string, ForgeJob>();
const requests = new Map<string, string>();
const port = Number(process.env.PORT ?? 8787);
const recipe = (value: unknown): value is RelicRecipeId => typeof value === 'string' && RELIC_IDS.some(id => id === value);
function parseRequest(value: unknown): ForgeRequest {
  if (typeof value !== 'object' || value === null || !('requestId' in value) || !('recipeId' in value) || !('rank' in value) || !('visualSeed' in value) || !('allowPaid' in value) || !('customization' in value)) throw new Error('Invalid request body.');
  if (typeof value.requestId !== 'string' || !recipe(value.recipeId) || (value.rank !== 1 && value.rank !== 2 && value.rank !== 3) || typeof value.visualSeed !== 'number' || typeof value.allowPaid !== 'boolean' || (value.customization !== null && typeof value.customization !== 'string')) throw new Error('Invalid forge request fields.');
  const request: ForgeRequest = { requestId: value.requestId, recipeId: value.recipeId, rank: value.rank, visualSeed: value.visualSeed, allowPaid: value.allowPaid, customization: value.customization };
  validateForgeRequest(request); return request;
}
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, value: unknown): void => { response.statusCode = status; response.end(JSON.stringify(value)); };
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (request.method === 'GET' && url.pathname === '/api/forge/availability') {
      const unavailable = await provider.availability(); reply(200, { ...unavailable, enabled: true, reason: 'Offline procedural forge enabled. Remote Xingchi adapter remains unverified and disabled.' }); return;
    }
    if (request.method === 'POST' && url.pathname === '/api/forge/jobs') {
      const origin = request.headers.origin;
      if (origin && !/^http:\/\/(?:127\.0\.0\.1|localhost):(?:5173|4173|8787)$/.test(origin)) { reply(403, { error: 'Origin rejected.' }); return; }
      if (!request.headers['content-type']?.startsWith('application/json')) { reply(415, { error: 'JSON request required.' }); return; }
      let text = ''; for await (const chunk of request) { text += String(chunk); if (Buffer.byteLength(text) > 4096) { reply(413, { error: 'Request too large.' }); request.destroy(); return; } }
      const value: unknown = JSON.parse(text); const forge = parseRequest(value);
      if (forge.allowPaid) { reply(503, { error: 'UNCONFIGURED: paid execution requires reviewed official Xingchi documentation and adapter.' }); return; }
      const existing = requests.get(forge.requestId); if (existing) { reply(200, jobs.get(existing)); return; }
      if (jobs.size >= 128) { reply(429, { error: 'Session job limit reached. Restart the local server to clear completed previews.' }); return; }
      const job = proceduralJob(forge); jobs.set(job.id, job); requests.set(job.requestId, job.id); reply(200, job); return;
    }
    const match = /^\/api\/forge\/jobs\/([a-zA-Z0-9_-]+)$/.exec(url.pathname); const id = match?.[1];
    if (id && request.method === 'GET') { const job = jobs.get(id); reply(job ? 200 : 404, job ?? { error: 'Job not found.' }); return; }
    if (id && request.method === 'DELETE') { reply(200, { cancelled: false, reason: 'Offline generation completed synchronously; no remote job or billing exists.' }); return; }
    reply(404, { error: 'Route not found.' });
  } catch (error) { reply(400, { error: error instanceof Error ? error.message : 'Invalid request.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Wxrld offline forge API: http://127.0.0.1:${port}`));
