# Wxrld — Xingchi 3D Pipeline

## 1. Verified status and non-negotiable fallback
- **No public official Xingchi 3D API documentation, domain or endpoint was verified during the initial lookup.** This does not establish that the provider does not exist.
- No provider authentication schema, async-job format, price, quota, GLB export, PBR texture support, licence, cancellation policy or generation latency is confirmed.
- Search attempts returned unavailable search/access notices or unrelated results. Do not replace Xingchi with another company's API and retain the Xingchi label.
- The contracts below are **application-owned proposals, not Xingchi's official wire format**. Implement a provider translator only after an official documentation link is supplied and verified.
- No paid call, credential access or game-generation submission occurred during design. These documents and prompts do not constitute permission to spend money.
- Offline procedural models and deterministic relic forging are the shipped default; gameplay, upgrades and every screen work when the adapter is disabled.

## 2. Separation of responsibilities
- Browser: chooses an approved relic recipe, displays disclosed stats/cost, uses a procedural appearance immediately, optionally submits an explicitly confirmed visual-generation request.
- App server: stores credentials, checks availability/budget, translates the application contract to the verified provider API, tracks jobs and safely downloads outputs.
- Provider-specific adapter: owns actual headers, endpoints, request/response mapping and documented status semantics. No guessed URLs or headers.
- Asset validator/normalizer: checks untrusted downloads, converts validated output into the game's GLB convention and produces metadata.
- World renderer: loads only accepted assets, normalizes placement and swaps a cosmetic visual without changing stats, collider, reach or attachment.
- Batch script: generates the nine curated character/environment/interactive-prop models only on explicit execution; runtime forge is a separate optional cosmetic workflow.

## 3. Configuration and billing gates
| Variable / setting | Meaning / default |
|---|---|
| XINGCHI_API_KEY | Server-only secret; absent by default; never `VITE_*`, committed or logged |
| XINGCHI_API_BASE_URL | Verified official HTTPS origin; absent by default; no fabricated default |
| XINGCHI_OFFICIAL_DOCS_URL | Human-reviewed official documentation URL identifying the actual provider |
| XINGCHI_SUBMIT_PATH | Actual documented generation path, resolved only inside the verified origin |
| XINGCHI_STATUS_PATH | Actual documented status path/template, not assumed `/jobs/:id` |
| XINGCHI_CANCEL_PATH | Optional documented cancellation path; absent means unsupported |
| XINGCHI_DOWNLOAD_HOSTS | Explicit allowed HTTPS hostnames, including documented provider/CDN origins |
| XINGCHI_ALLOW_PAID_EXECUTION | `false` by default; must explicitly be `true` before any remote submission |
| XINGCHI_MAX_JOBS | Explicit per-session/batch ceiling; suggested 9 batch /1 concurrent runtime |
| XINGCHI_MAX_COST | Operator-specified budget if official pricing can be calculated; otherwise require manual budget approval |
- Availability is remote-enabled only when key, reviewed docs, actual submit/status mapping, output validation and paid flag are all configured. Incomplete configuration returns offline mode.
- A browser request cannot override origins, credentials, allowlists, pricing limits or provider mappings.
- Do not log keys, full provider payloads or signed output URLs. Redact diagnostics; report typed errors and request IDs.
- Configure local development proxy `/api` to the app-owned Node server. Deployment of the static game alone remains fully supported and offline.

## 4. Application-owned server contract
The following routes belong to this application; they are not asserted provider endpoints.
| Route | Operation / application result |
|---|---|
| GET /api/forge/availability | Mode `offline` or `remote`, enabled flag, supported formats, limits, optional unavailable reason |
| POST /api/forge/jobs | Validated `ForgeRequest`; returns `ForgeJob`; disabled adapter returns immediate procedural success without external traffic |
| GET /api/forge/jobs/:jobId | Current application job state and metadata; no automatic resubmission |
| DELETE /api/forge/jobs/:jobId | Best-effort application cancel; distinguishes unsupported/provider-confirmed cancellation |
| GET /api/forge/assets/:assetId | Streams a previously validated asset from app-owned storage, never an arbitrary requested URL |
- `ForgeRequest`: `requestId`, approved `recipeId`, integer `rank` 1–3, unsigned `visualSeed`, `customization` string (≤400 characters) or `null`, `allowPaid: boolean`.
- `ForgeJob`: `id`, `requestId`, `mode: 'offline' | 'remote'`, `status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'`, `progress` 0–1 or `null`, `asset` descriptor or `null`, typed `error` or `null`, `createdAt`/`updatedAt` Unix milliseconds. Exact shared types are in doc 04.
- Do not fabricate progress when the provider does not report it; show indeterminate progress instead.
- `ValidatedAsset`: either `{kind:'procedural', recipeId, seed}` or `{kind:'glb', assetId, url, sha256, byteLength, triangles, materials, maxTextureSize}`. URL is app-owned/validated, never a caller-supplied fetch target.
- Error codes: `UNCONFIGURED`, `PAID_DISABLED`, `INVALID_REQUEST`, `BUDGET_EXCEEDED`, `RATE_LIMITED`, `PROVIDER_FAILED`, `TIMEOUT`, `CANCEL_UNSUPPORTED`, `DOWNLOAD_REJECTED`, `ASSET_INVALID`, `NETWORK_ERROR`.
- Recipe eligibility and local gameplay currency are handled by game systems. Provider success/failure cannot alter recipe stats or automatically debit extra upgrade currency.
- Same `requestId` returns the same tracked job while retained. Persist idempotency records for a deployed paid adapter; document retention and restart behavior.
- Runtime customization is constrained aesthetic text, not code or a system instruction; reject control characters, extreme size and arbitrary URLs. Do not include user identity, save data or unrelated personal information.

## 5. Polling, retries and cancellation
- Default one concurrent runtime generation and two concurrent batch jobs; apply stricter official limits if documented.
- Suggested polling backoff: 2, 4, 8, then 10 seconds with small jitter; stop after 120 polls or 15 minutes, whichever occurs first. Polling does not submit new jobs.
- Retry status reads on transient 429/5xx at most three times per operation, respecting documented `Retry-After`; never blindly retry billable submission.
- Submission retry is allowed only with a documented provider idempotency mechanism or evidence that no job was created. Otherwise surface uncertain submission and require review.
- An AbortSignal cancels local waiting. A separate cancel request attempts provider cancellation only if officially supported; do not promise refunds or stopped billing.
- Timeouts and unsupported cancellation leave the procedural relic active. Keep enough metadata to inspect an uncertain remote job without submitting another.
- Leaving the hub or starting a run stops UI polling; server job may continue within approved limits. Completed art is applied only in hub or before the next run.

## 6. Offline-first runtime relic forge
- The GDD fixes three blueprints, three deterministic ranks, one equipped relic and disclosed costs. Core gameplay upgrade completes locally once, independent of service availability.
- Build a detailed multipart procedural visual from `(recipeId, rank, visualSeed)` immediately. Rootheart uses an organic shell; Ember Fang beveled metal prongs; Moon Sigil nested crescent plates.
- A separate “Generate custom appearance” action explains possible cost, service availability and the fact that no stats improve. No automatic submission on page load, blueprint unlock, upgrade or retry.
- Remote action requires `allowPaid:true` from explicit user confirmation plus enabled server configuration. Offline/default forge performs no network generation calls.
- A failed, rejected, delayed or oversized model never removes the approved relic or consumes another recipe payment. Appearance replacement is optional and reversible.
- Keep approved collider/attachment/scale fixed; oversized sword-like output cannot increase reach. Do not equip a new rank during a run.
- Persist the procedural seed/approved recipe plus validated asset reference, not large binary data in localStorage. Missing/expired assets fall back gracefully.

## 7. Proposed batch script and dry-run behavior
- Future file: `scripts/generate-assets.ts`; no script implementation or source scaffolding is part of this documentation stage.
- Proposed invocation: `npm run assets:generate -- --dry-run` (also default if no mode flag); print sanitized requests, model IDs, output destinations and estimated costs only when official prices are known.
- Paid invocation: `npm run assets:generate -- --execute --confirm-paid`; requires every configuration/budget gate above. Absence of either explicit flag refuses remote submission.
- `--only <model-id>` limits scope; `--resume` reads tracked jobs/manifest and does not resubmit succeeded/uncertain requests. Invalid IDs fail before traffic.
- Suggested output: `public/assets/generated/<model-id>.glb` plus a versioned manifest with provenance, hash, counts, status and approved licence metadata; do not record secrets/signed URLs.
- Existing accepted outputs are skipped unless explicit `--replace <model-id>` is provided. Failed outputs are isolated and never overwrite a working fallback/accepted model.
- Use one shared style prefix: “Game-ready stylized organic fantasy 3D asset, sharp readable silhouette, detailed beveled multipart construction, physically based roughness and metalness, restrained emissive accents, no text, no watermark, isolated object, efficient topology.”
- These curated English prompt suffixes are local design material, not requests submitted during this work.
| Required model / manifest ID | Runtime mapping | Curated English prompt suffix |
|---|---|---|
| PlayerWanderer / player-wanderer | Player hub/static preview; live rig remains procedural unless validated | “Third-person wandering survivor with articulated human silhouette, beveled leather and metal armor, layered cloth, readable face/helm and hand-held tool; neutral pose, feet grounded, facing forward.” |
| GoblinStalker / goblin-stalker | Enemy archetype `goblin-stalker` | “Hunched lean goblin with long sharp ears, thin articulated limbs, asymmetric leather armor, crooked blade and angular head; green-brown woodland colors.” |
| StoneGolem / stone-golem | Enemy archetype `stone-golem` | “Heavy golem built from layered beveled rock slabs, separated joints, broad fists, grounded feet, chipped edges and recessed restrained glowing runes.” |
| BloodWyvern / blood-wyvern | Enemy archetype `blood-wyvern` | “Blood-red wyvern with ribbed wing spars, thin leathery membranes, angular horned head, articulated legs and tapering tail; dramatic readable wing silhouette, no environment.” |
| AncientPine / ancient-pine | Resource kind `tree`, ancient-tree fallback | “Ancient twisted pine with tapered bent trunk, flared roots, branching forks, clustered sharp needle canopy, bark grooves and hanging vines; grounded pivot and moss-sage palette.” |
| CursedCrystal / cursed-crystal | Resource kind `cursed` | “Uneven jagged cursed crystal blades growing from a dark basalt cradle, recessed crimson glowing core, sharp asymmetric silhouette and breakable outer shards.” |
| GoldChest / gold-chest | Landmark chest keyed by `LandmarkId`; not the `gold` mining node | “Ancient treasure chest with separate beveled timber slats, inset metallic gold trim, articulated hinged lid, recessed rune lock and weathered organic detailing; broad stable ground base.” |
| BossTotem / boss-totem | Ashen Spire summon-altar prop; not a boss character replacement | “Cursed summoning totem of stacked angular basalt plates, twisted roots, beveled prongs and inset crimson heart; tall readable ritual silhouette and grounded base.” |
| ExtractionAltar / extraction-altar | Beacon pad prop at each landmark | “Circular extraction altar made of separate beveled stone rings, broken upward prongs, inset luminous runes and worn mossy edges; open walkable center and readable circular ground footprint.” |
- The required batch has exactly these nine entries. Manifest IDs map to runtime categories above, not to guessed provider model names. Stone/gold nodes, Relic Hunter, Rootbound Sovereign and custom relics retain detailed procedural fallback; additional generation is a separate opt-in scope.
- Request separate multipart objects and standard PBR export only if the verified provider supports them. Prompt wording does not guarantee separate parts, a rig, topology quality or any output format.

## 8. Safe asset download, validation and normalization
- Download only HTTPS URLs from exact allowlisted hosts. Reject user-selected URLs, credentials in URLs, nonstandard ports, localhost, loopback, private/link-local IPs and unsafe DNS/redirect changes.
- Revalidate every redirect and resolved address; cap redirects at three, connection timeout 10 s and download timeout 60 s. Limit streamed bytes to 15 MiB before decoding.
- Prefer self-contained GLB 2.0. Check magic/version/declared length and validate glTF structure. Reject external resources/extensions requiring unapproved network fetches or unsupported decoders.
- Validate ≤50k triangles, ≤6 materials, textures ≤2048 ×2048, finite transforms/accessors and bounded decoded texture memory. Decompression bombs must fail before renderer allocation.
- Do not run downloaded scripts or provider archives. If conversion becomes necessary, use an isolated trusted tool with explicit input/output paths, resource limits and no network.
- Normalize to Y-up, feet/base at y=0, facing +Z, centered x/z pivot, units in metres; record original bounds and normalization transform.
| Asset class | Target height / extent |
|---|---|
| PlayerWanderer | 1.8 m height; static hub preview unless rig validated |
| Goblin / hunter | 1.4 m /1.9 m height |
| Golem / boss | 2.8 m /6 m height |
| GoldChest / BossTotem / ExtractionAltar | 1.2 m width /3 m height /4 m diameter; gameplay channel radius remains 10 m |
| Wyvern | 4 m wingspan; presentation hover height supplied by simulation |
| Ancient tree | 8 m height |
| Stone /gold node | 1.8 m width, approximately 1.2 m height |
| Cursed deposit | 1.8 m height |
| Relic | 0.35 m longest extent before fixed attachment transform |
- Generated characters may lack usable articulation. Keep fallback animation/colliders; reject cosmetic replacement or use a documented static presentation rather than falsely claiming a rig.
- Confirm commercial/game distribution rights, prompt/output retention, attribution, asset hosting duration and export terms from official sources before distributing generated files.

## 9. Tests and completion evidence
- Unit tests: disabled configuration, paid gate, schema rejection, request deduplication, status transitions, polling cap, cancel-unsupported, output limits and normalization.
- Server tests use a local mock provider only; no real keys or paid endpoint in CI. Mock wire formats must be labelled mock, not Xingchi documentation.
- Browser test: fully offline forge/upgrade/equip works; remote failure leaves fallback and approved stats unchanged; no billable traffic on load or ordinary upgrade.
- Batch dry-run must make zero submission/download requests, print no secrets and produce no paid job. Execution tests require fake transport until an explicitly approved live test.
- Open integration questions remain: actual official docs, endpoint/auth/job mappings, cost/idempotency, cancellation, GLB/PBR/rig exports, quota, licensing and retention.
- Lookup attempts, not provider evidence: [English query](https://www.google.com/search?q=Xingchi+3D+API+official+documentation+2026), [Chinese query](https://www.google.com/search?q=%E6%98%9F%E9%A9%B0+3D+API+%E5%AE%98%E6%96%B9+%E6%96%87%E6%A1%A3+2026), [Bing query](https://www.bing.com/search?q=Xingchi+3D+API).
