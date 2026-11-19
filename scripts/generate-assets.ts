import { ASSET_PROMPTS, STYLE_PROMPT } from './asset-prompts';

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const confirmed = args.includes('--confirm-paid');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const allowed = new Set(['--execute', '--confirm-paid', '--dry-run', '--only']);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--only') { i++; continue; }
  if (arg && !allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
}
if (onlyIndex >= 0 && (!only || !Object.hasOwn(ASSET_PROMPTS, only))) throw new Error('Unknown or missing model ID for --only.');
if (execute && !confirmed) throw new Error('Remote execution requires --execute --confirm-paid and a verified provider adapter.');
if (execute) throw new Error('UNCONFIGURED: official Xingchi documentation and a reviewed adapter are not available. No request was submitted.');

const requests = Object.entries(ASSET_PROMPTS).filter(([id]) => !only || id === only).map(([id, prompt]) => ({ id, prompt: `${STYLE_PROMPT} ${prompt}`, output: `public/assets/generated/${id}.glb` }));
console.log(JSON.stringify({ mode: 'dry-run', providerStatus: 'unverified / disabled', submittedJobs: 0, estimatedCost: null, requests }, null, 2));
