# Wxrld

An offline-first, single-player **3D roguelike extraction survival** game. Three.js, strict TypeScript, Vite and Tailwind CSS. No accounts, multiplayer, blockchain or Web3 dependencies.

## Run

Requires Node.js 24 and npm.

```sh
npm install --ignore-scripts
npm run dev
```

Open the local URL printed by Vite, normally **http://127.0.0.1:5173**. A current desktop browser with WebGL2 and keyboard/mouse is required. The title leads to the Sanctuary, then the cursed island, then an extraction or death receipt.

```sh
npm run build
npm run preview
npx tsc --noEmit
npm run typecheck
npm run test:unit
npm run test:browser
```

Browser tests use system Chromium with its sandbox enabled. Set `CHROMIUM_PATH` to another installed Chromium executable when necessary. No browser-security bypass flags are configured.

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Shift | Sprint; consumes stamina |
| Space | Dodge dash; brief invulnerability |
| Mouse cursor | Aim on terrain independently of movement |
| Left mouse | Melee combo or harvest a nearby aimed resource |
| Right mouse | Hold to draw, release to fire the bow |
| Q | Magic projectile |
| R | Apply a bandage while stationary; interrupted by movement or hits |
| E | Interact or harvest; hold inside a beacon to extract |
| 1–6 | Quick-craft the six toolbar recipes |
| Escape | Pause, field guide, graphics/audio settings |

Hidden tabs pause the simulation. Resume explicitly when returning. Game simulation, enemies, threat and extraction stop while menus or buff drafts are open.

## The extraction loop

- **90 seconds of daylight, 60 seconds of Blood Moon.** Gather wood, stone and gold; craft stone/cursed tools and blades; survive four enemy archetypes.
- **Cursed deposits** grant Soul Shards and periodic Relic Cores. They raise threat, suppress passive healing, and attract elite hunters.
- **Blood Overdrive** activates strictly below 30% HP: 3× attack rate, 2.5× direct damage, and 2% direct-damage lifesteal. Healing caps prevent recursive or overkill farming.
- **Gold chests** offer three-card choices from twelve five-stack powers. Paid drafts cost 5 gold, then increase by 3; kill milestones can grant free drafts.
- **Extraction** opens every 150 simulation seconds for 45 seconds. Hold E, stationary, inside the 10 m ring for 10 uninterrupted seconds. Hits, movement and actions reset the channel.
- First/second/third-and-later windows pay **1.5× / 2.5× / 5×** Soul Shards. Cores and blueprints are not multiplied. Death loses unbanked loot; bounded first-time discoveries can grant consolation.
- Spend banked rewards in the **Sanctuary** on nine three-rank skills and three fixed-stat relic recipes. Summon the optional Rootbound Sovereign at Ashen Spire with three cores.

Only the versioned profile is stored in `localStorage` (`wxrld.profile.v1`); active runs are not resumed after reload. Storage can be cleared or edited and is not an authoritative economy. Storage failure shows an unsaved warning.

## Art and forge

The shipped baseline uses seeded multipart procedural PBR art: height-colored island terrain, instanced organic vegetation and actor parts, shoreline foam, wind, day/night fog and lighting, selective bloom, Fresnel rims, trails and telegraphs. The Web Audio soundtrack/effects are synthesized locally. Low/medium/high graphics and separate atmosphere/effects volumes are available.

The local relic forge creates deterministic cosmetic silhouettes immediately. Previewing art does not alter statistics or spend real money.

### Xingchi asset pipeline

**Official Xingchi API documentation, endpoints, authentication and pricing could not be verified. Remote generation is intentionally disabled, not simulated as a working vendor integration.** All gameplay and relic upgrades work without credentials.

```sh
npm run assets:generate -- --dry-run
npm run assets:generate -- --only ancient-pine
npm run dev:api
```

The batch script lists the nine curated model prompts and planned GLB destinations without submitting jobs. `--execute --confirm-paid` currently fails safely until a reviewed provider adapter exists. `server/xingchi-provider.ts` defines the adapter boundary; `.env.example` documents server-only configuration. Never place credentials in `VITE_*` variables.

The optional local API listens on `127.0.0.1:8787` and serves app-owned offline preview routes. Set `VITE_FORGE_API=enabled` only when running that API. The initial GLB inspector rejects external resources, unsupported decoders and textured remote files pending a complete reviewed validator. No generated base GLB assets are bundled.

## Architecture and specifications

- `src/types/game.ts`: shared state, actions, events and asset contracts.
- `src/config/balance.ts`, `src/core/`: balancing, deterministic RNG, input, event bus, spatial hashing and selectors.
- `src/world/`, `src/rendering/`: world facade, terrain, assets, shaders, batching and effects.
- `src/entities/`, `src/combat/`: movement, AI, attack/projectile/lifesteal resolution.
- `src/systems/`: gathering, crafting, threat, buffs, extraction, settlement and progression.
- `src/ui/`, `src/audio/`, `src/services/`: interface, synth audio, validated saves and offline forge.
- `src/main.ts`: fixed-step composition and title/hub/run/summary lifecycle.

The four numbered documents in `docs/` are the detailed design and interface specifications. No engineering harness or special workflow kit is used. Balancing and 60 FPS are targets, not playtested or benchmarked claims. Development-only `window.__WXRLD__` hooks support deterministic tests and are removed from production by Vite's development guard.

## Verification status

Focused specialist combat, systems and terrain checks were reported passing during construction. Whole-app build and browser verification remain pending because this session's Auto-mode safety service blocked execution commands. Do not treat those focused reports as an integrated release verification.
