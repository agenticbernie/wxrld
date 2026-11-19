# Wxrld — Art Direction and Graphics Specification

## 1. Visual thesis and acceptance
- **Sharp organic silhouettes, detailed beveled multipart construction, and coherent PBR lighting** distinguish the game from primitive-only prototypes.
- Think ancient woodland growing through broken mineral architecture: twisted roots, chipped basalt, layered stone, leathery wings and inset relic cores.
- A fallback is finished game art built procedurally, not a box substituted while waiting for AI. The entire title, hub and island must work without downloaded assets.
- Combat readability is non-negotiable: clear silhouettes, stable ground contact, visible tells and effects that never hide the player or extraction ring.
- 60 fps on mainstream desktop hardware is a **target, not a measured result**. Low quality should target usable 30 fps; record real hardware, resolution and timings before claiming either.

## 2. Shared scene and composition
- Reuse the same world scene, sky, island terrain, lighting rig and asset palette across title, hub and live run. Do not create three independent renderers or duplicate full worlds.
- Title presentation: cinematic orbit toward Ancient Grove, gentle wind and distant landmark silhouettes; no live enemy damage, resource depletion or run-clock advancement.
- Hub presentation: camera frames a relic forge platform and character; island remains an atmospheric background; UI is an overlay, not an unrelated flat application.
- Run presentation: trailing third-person camera with terrain clearance and obstruction handling; ground aim marker and extraction pads remain legible.
- `WorldFacade.setPresentation('title' | 'hub' | 'run')` changes camera/composition and decorative activity, not gameplay ownership.
- Main owns presentation transitions. World reads shared state and maintains visual sets keyed by stable entity/node IDs.
- Rebuild seeded run visuals on `resetRun()`, dispose replaced geometry/materials and clear stale ID maps. Preserve reusable asset prototypes and renderer.

## 3. Terrain morphology and biome bands
- Approximately 180 ×180 m island inside a larger water plane; central traversable meadow, mossy rises, broken cliffs and volcanic peaks.
- Use seeded layered noise, radial island falloff and deliberate landmark plateaus; do not trust pure noise to produce playable routes.
- Suggested grid: 128 ×128 subdivisions medium/high; 80 ×80 low. Compute smooth normals after displacement.
- Normalize terrain height and slope. Vertex colors blend the following bands rather than hard striping; vary within each band using low-frequency noise.
| Band | Approximate height / slope | Surface and color family |
|---|---|---|
| Beach | 0–3 m, shallow slope | Warm sand, damp darker shoreline, shell-stone fragments |
| Meadow | 3–10 m, gentle slope | Olive/sage grass with golden dry patches |
| Moss | 8–18 m, sheltered gentle slope | Deep desaturated green, roots and damp rock |
| Cliffs | Any elevation with slope >38° | Cool gray stratified rock; sparse vegetation |
| Volcanic peaks | >20 m and exposed ridges | Charcoal basalt, muted rust seams, tiny crimson fissures |
- Height and slope rules overlap with smooth weights; cliffs override grass on steep faces. Add noise to breakup, not to physical navigation queries.
- `WorldLayout.heightAt(x,z)` and `isWalkable(x,z)` must match the rendered terrain. Put nodes/enemy spawns/beacons on verified reachable surfaces.
- Mark extraction pads as level, approximately 24 m diameter, with no foliage inside the central channel area.
- Three landmark shapes: grove arching canopy/root gate; shrine concentric broken pillars partly submerged; spire jagged vertical basalt/altar silhouette.

## 4. Procedural fallback asset craft
| Asset | Required multipart construction / silhouette |
|---|---|
| Player | Articulated limbs, beveled torso/armor, cloth skirt/cape panels, readable helm/hair and held tool; 12–20 parts |
| Ancient tree | Tapered bent trunk segments, flared roots, branching forks, clustered non-spherical foliage, hanging vines and bark variation |
| Stone/gold node | 5–9 irregular beveled chunks, fractured stratification, recessed gold veins; not one uniformly scaled icosahedron |
| Cursed node | Jagged clustered crystal blades emerging from basalt cradle, inset hot core, uneven shard lengths and silhouette |
| Goblin Stalker | Hunched torso, oversized ears, narrow articulated limbs, crooked weapon, shoulder asymmetry and sharp profile |
| Stone Golem | Layered beveled slabs, visible joint gaps, recessed glowing runes, broad fists and heavy foot contact |
| Blood Wyvern | Ribbed wing spars and thin membranes, long tail, angular head/horns, articulated limbs and clear flight silhouette |
| Relic Hunter | Lean armored body, split cloak, long rune blade, offset shoulders and distinctive cool spectral accents |
| Rootbound Sovereign | Twisted trunk/rib cage, root limbs, antler branches, embedded mineral plates and exposed cursed heart |
| Relic | At least three nested parts: sculpted shell, inset core, separate trim/prongs; bevels, asymmetry and property-specific motif |
- Required generation set: PlayerWanderer, GoblinStalker, StoneGolem, BloodWyvern, AncientPine, CursedCrystal, GoldChest, BossTotem and ExtractionAltar; manifest mappings are in doc 03. Player GLB may be a static hub preview; live player animation stays procedural unless a usable rig is validated.
- GoldChest fallback: beveled timber slats, inset gold trim, hinged lid and rune lock. BossTotem: stacked angular stone/root plates and recessed cursed heart. ExtractionAltar: multipart beveled circular platform, broken prongs and emissive channel runes.
- Build beveled extrusions, tapered cylinders/cones, custom indexed wedges and deformed low-poly surfaces with consistent normals. Avoid coplanar layers and z-fighting.
- Reuse geometries/materials where possible, but vary silhouette, orientation, size and roughness from a seed. Cloning must not leak shared mutable materials.
- Resource depletion stages progressively hide outer chunks; preserve collision/HP rules from the shared state, not visual mesh counts.
- Enemy animation is deterministic hierarchical posing: walk, windup, strike, recovery, hurt, death; the fallback must not depend on provider skeletal animation.

## 5. Materials, shaders and color management
- Use `MeshStandardMaterial`/`MeshPhysicalMaterial` with roughness-led surfaces; metalness only for metal/gold, not every rock or tree.
- Suggested roughness: bark 0.85, rock 0.9, leaves 0.75, leather 0.7, armor 0.45, gold 0.28, crystal 0.18. Emissive accents remain localized.
- Procedural texture detail may use generated canvas noise/normal maps, vertex color and shader noise; do not require external texture URLs.
- `renderer.outputColorSpace = THREE.SRGBColorSpace`; `renderer.toneMapping = THREE.ACESFilmicToneMapping`; initial exposure 1.05, tuned against highlight clipping.
- Correctly label color textures sRGB and non-color normal/roughness/metalness textures linear. Do not apply a second manual gamma transform.
- `onBeforeCompile` augments standard materials for foliage wind, water surface breakup/foam and tasteful Fresnel rim; retain Three.js PBR and shadow chunks.
- Store shader references/uniforms explicitly; stable `customProgramCacheKey()` per shader feature combination. Never patch internal chunks without a version-specific smoke test.
- Wind: anchor trunk/root vertices; sway foliage tips and thin branches with world-space noise. Suggested amplitude 0.12–0.35 m, frequencies 0.7/1.3 Hz.
- Fresnel rim: `pow(1 - clamp(dot(normal, viewDir),0,1), power)`; power 3–5; subtle on relics/enemies, reduced in low quality. It is not a global neon outline.
- Reduced-motion option lowers wind amplitude, trails, camera shake, heartbeat pulsing and disables hitstop.

## 6. Water and shoreline foam
- Water plane at a fixed level around the island; blue-green daylight, nearly black crimson-reflecting night, with visible shoreline contrast.
- Blend two slow normal/noise directions; broad low-amplitude vertex waves ≤0.18 m must not alter gameplay terrain sampling.
- Use Fresnel to blend shallow transmission color and sky/reflection approximation; do not claim physically accurate refraction without a depth/refraction pass.
- Shoreline foam derives from terrain-height proximity at water level, plus animated noise breakup. Approximate using a sampled shoreline/height texture from the same layout.
- Foam band initial width 1.5 m, irregular opacity, movement slower than combat trails; avoid a uniform white island outline.
- Add occasional small crest foam using wave/noise threshold. Optional depth-based refinement is high quality only.
- Use stable transparent sorting/depth settings; inspect camera-near shoreline and intersecting shrine stones. Low quality keeps color/Fresnel/shore foam but lowers shader complexity.

## 7. Lighting, shadows, fog and cycle transitions
- One shadow-casting directional light changes sun/moon position and color across the cycle; one hemisphere/ambient contribution supplies readable silhouettes.
- Enable `THREE.PCFSoftShadowMap`; medium/high directional shadow map 2048 ×2048; low 1024. Fit the shadow camera to the relevant island/player region, not an enormous ocean.
- Carefully tune bias/normalBias to avoid acne and floating contact shadows. Instanced vegetation can receive shadows; only selected nearby foliage casts them.
- Day palette: warm gold key light, desaturated blue-green fill, sage landscape. Night: crimson/violet key accents with cool readable fill, not pitch-black enemies.
- `THREE.FogExp2` density initially 0.008 day →0.016 night; smoothly transition fog color from gold-gray to crimson-charcoal near dusk/dawn.
- Use continuous interpolation over the final 10 s before each boundary; exact AI/day/night switching remains the GDD clock rule.
- Cursed threat subtly increases crimson emissive and fog tint, never hides the threat meter or telegraphs. Thunder-like flashes must respect photosensitivity settings.

## 8. Post-processing and gameplay effects
- Use `EffectComposer` with render pass, selective bloom composite, vignette/color treatment and final output conversion in the correct color-space order.
- Selective bloom includes cursed cores, relic accents, meteor highlights and beacon rune edges, not entire terrain/sky or white UI.
- A bloom-layer/masked material approach must restore materials after the bloom pass and avoid visibly darkening transparent objects.
- Bloom starts at half resolution medium/high, quarter low if enabled; threshold around 1.0, restrained strength around 0.35. Low defaults off.
- Overdrive vignette appears only below the HP threshold; heartbeat is audible with an independent volume option. No uncontrolled full-screen strobe.
- Weapon trails are short tapered ribbon meshes; damage sparks are pooled quads/meshes. Dash afterimages fade quickly and preserve the player silhouette.
- Hitstop is a visual-only pose/camera pause of approximately 35 ms on heavy impacts; does not slow survival timers, grant invulnerability or change attack cooldowns.
- Telegraphs: golem ring, wyvern landing/spit marker, hunter blink destination, boss roots/volley and meteor warning; color plus shape/pattern, not color alone.
- Beacon ring explicitly shows 10 m radius; channel fill is UI/ground visual, not a mesh-driven gameplay timer.

## 9. Budgets and update discipline
| Budget | Initial limit / implementation |
|---|---|
| Visible triangles | Approximately 200k target in normal play; measure, do not infer from prototype counts |
| Player / regular enemy / boss | 12k /8k /20k fallback triangles; high quality may use more only after profiling |
| Procedural prop | 0.5–4k triangles prototype; distant LOD or silhouette cards |
| Generated individual asset | ≤50k triangles, ≤6 materials, ≤2048 px textures, ≤15 MiB transferred file |
| Texture memory | Target ≤128 MiB total GPU texture allocation, explicit disposal on replacements |
| Active enemies | GDD cap 18 +one boss; pool transient effects/projectiles |
| Particles / trails | ≤400 active pooled particles; ≤32 trail segments per trail |
| Shadows / renderer | One 2048 shadow map; devicePixelRatio capped at 1.5 medium /2 high /1 low |
| Draw calls | Target ≤150 typical frame; inspect actual calls after batching |
- Instanced foliage and rock chunks use stable instance indices and coarse spatial groups; update only changed matrices/colors. Resource removal scales/hides the instance or recycles its slot.
- Batch repeated mob limb/armor parts using per-part instanced meshes when practical; articulation updates part matrices. Unique generated rigs may use separate objects only within budgets.
- Shared spatial hash supports nearby combat/resource/AI queries; rendering does not perform a full all-pairs search.
- Pool projectile meshes, damage particles, telegraphs and floating text. Map `EntityId`/`ResourceId` to visual handles; reconcile additions/removals once per update.
- Gameplay coordinates and entity state are authoritative; visual easing never writes movement, HP, node depletion or inventory back into the simulation.
- Cache geometry/material prototypes; dispose per-run/generated assets deliberately. Repeated start/death/extract must not grow scene or GPU allocation indefinitely.

## 10. Quality levels and graphics verification
- Low: reduced vegetation/grid detail, 1024 shadows, DPR 1, bloom off, simplified water/rim, shorter trails; all gameplay tells retained.
- Medium: 2048 shadows, DPR ≤1.5, instanced dense foreground, half-resolution bloom and complete water/wind/rim shaders.
- High: DPR ≤2, richer silhouettes/LOD distances and additional small detail only; no new gameplay obstacles or stat differences.
- A graphics smoke test must cover title →hub →run →pause →death/extract →hub, resize, hidden-tab resume, resource depletion and every enemy silhouette.
- Inspect beach/moon shoreline, camera near cliffs, shadow acne, bloom masking, shader compilation and consistent glTF orientation/scale.
- Record CPU simulation time, GPU/render time where available, draw calls, triangles, active objects and memory across several repeated runs.
- Screenshot comparisons are evidence of visual consistency, not proof of performance. No finished look or fps claim until actual browser verification.
