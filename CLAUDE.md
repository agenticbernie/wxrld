# Wxrld — Project Guidance

## Scope and authoritative specifications
This is an offline-first, single-player Web2 extraction survival game. Use only the project guidance and specifications below; **do not install or use an engineering harness, special workflow kit, workflow agents/skills, or unrelated process artifacts**.

- `docs/01_GAME_DESIGN_DOCUMENT.md`: player psychology, exact initial tuning, resources/recipes, enemies, threat, twelve buffs, extraction and permanent progression.
- `docs/02_ART_DIRECTION_AND_GRAPHICS_SPEC.md`: organic multipart PBR fallback, terrain/water/shaders, shared scene, budgets and graphics targets.
- `docs/03_XINGCHI_3D_PIPELINE.md`: unverified optional provider, configurable server adapter, safe assets, offline forge and explicit paid-execution gates.
- `docs/04_ARCHITECTURE_AND_CONVENTIONS.md`: shared types, events, field ownership, facade signatures and central loop. Its interface contract takes precedence over ad hoc module choices.

## Stack and commands
Node 24 + npm; Three.js/@types 0.180.0; TypeScript 5.9.2; Vite 7.3.8; Tailwind and its Vite plugin 4.1.13; tsx 4.20.6. Use compatible pinned Playwright/Chromium versions.

Commands: `npm run dev`, `npm run dev:api`, `npm run typecheck`, `npm run build`, `npm run test:unit`, `npm run test:browser`, `npm run assets:generate -- --dry-run`. Scripts exist; passing verification is a separate requirement. Current integration-verification status is recorded in `README.md`.

## Architecture and work boundaries
- One mutable `RunState`, typed synchronous `GameEventMap`, explicit `GameAction` callbacks; no competing stores, implicit singletons or cross-directory import cycles.
- Scaffold `src/types/game.ts`, `src/config/balance.ts` and `src/core/` before independent directory implementation. Integrate `src/main.ts` after modules meet the shared contract.
- Owners: world/rendering; entities/combat; systems; services/UI/audio/scripts/server. Do not edit another owner's implementation or common contracts without an agreed correction.
- Named facades: `WorldFacade(ctx, {canvas, quality})`, `CombatFacade(ctx)`, `SystemsFacade(ctx)`, `UiFacade(ctx, {root, onAction})`, `AudioFacade(ctx)`, `ForgeService({apiBase, allowPaid})`, `SaveRepository()`; exact exports/methods are in doc 04.
- Main controls phases, input and persistence; systems update →combat update →systems afterCombat at fixed 1/60 s; world/UI/audio render separately. Death wins extraction ties.
- Numeric values belong in `BALANCE`; shared state owns gameplay, scene meshes only display it. Seeded RNG drives gameplay. Pause/blur stop all simulation timers.

## Quality and safety
- Strict TypeScript, no `any`, English source/comments. Prefer small explicit modules and typed imports; no type casts used to conceal contract mismatch.
- Initial balancing and 60-fps budgets are targets, not tested facts. Report actual checks and unresolved limitations honestly.
- First/second/third+ beacon payouts are ×1.5 /×2.5 /×5. Twelve buffs and gold draft prices are fixed by doc 01.
- Persist validated versioned profile data only; localStorage is editable/clearable. Death loses run loot; only explicitly bounded first-time discoveries can grant consolation.
- Xingchi has no verified official API here. Never invent its endpoint or substitute another provider under its name. No automatic paid submission; server-only secrets, explicit configuration/consent gates, working offline fallback.
- `scripts/generate-assets.ts` must default to dry-run; actual paid execution requires documented official endpoint configuration and explicit flags. Generated art cannot change approved relic stats/colliders.
- Do not add source scaffolding until requested. Do not commit, push or spend money unless explicitly requested.
