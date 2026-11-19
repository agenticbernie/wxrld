# Wxrld — Game Design Document

## 1. Product and player promise
- A desktop, single-player, pure Web2 browser extraction roguelike: Three.js, strict TypeScript, Vite and Tailwind; no accounts, blockchain, trading or multiplayer.
- Explore an organic island, gather, improve equipment, disturb cursed deposits, survive the night and escape with a valuable haul.
- The central question is **“Do I leave safely now, or risk another cycle?”** Boss victory is optional; extraction is the success condition.
- The emotional rhythm is curiosity → competence → temptation → panic → relief. Visible rules make defeat attributable to choices rather than hidden punishment.
- Day supports planning and resource routes. Night compresses those plans into readable combat decisions. Cursed mining buys power by making the whole island more dangerous.
- Overdrive provides a spectacular last-chance burst without invulnerability. Extraction is a short, vulnerable commitment, not an instant escape button.
- The hub converts successful escapes into modest permanent progress. A custom relic's generated appearance never determines its power.
- All numbers below are **initial tuning proposals, not playtested or measured conclusions**. Change only the centralized balance configuration, then record evidence.

## 2. First playable scope
- One compact approximately 180 × 180 m island, three landmarks, one hub/title environment, one player, four enemy archetypes and one summonable boss.
- Complete gather → craft → fight → buff draft → extract/death → hub loop, all twelve buffs, fixed relic recipes and local persistence.
- Three landmarks: Ancient Grove, Sunken Shrine and Ashen Spire. Each has a reachable extraction pad and recognizable silhouette.
- Desktop keyboard/mouse first; no mobile controls, infinite generation, multiplayer, online economy, advanced flight physics or AI-generated character rigging.
- Procedural art and offline relic forging must make the entire game playable without an external generation provider.

## 3. Time, controls and player baseline
| Setting | Initial value / exact behavior |
|---|---|
| Run clock | Starts at 0 in daylight; 90 s day +60 s night =150 s cycle |
| Movement / sprint | WASD, 4.5 /7 m/s; sprint costs 16 stamina/s |
| HP / stamina | 100 /100; maximum HP fixed for the run after hub loadout application |
| Stamina recovery | 22/s after 0.75 s without expenditure |
| Dash | Space; 4 m over 0.22 s; cost 25; cooldown 1.2 s; invulnerable first 0.18 s |
| Melee | Left mouse; mouse-ground aimed; 90° base arc, 2.5 m reach; approximately 2 swings/s; cost 8 stamina/swing |
| Combo | Three directional arcs, damage multipliers 1.0 /1.15 /1.5; reset after 1 s without attacking |
| Bow | Hold/release right mouse; 0.7 s draw; 24 damage; one arrow per volley; 35 m range |
| Magic | Q; 30 damage; 1 s cooldown; cost 18 stamina; 28 m range |
| Interact | Hold E for extraction; E press for chest/altar/pickup interactions; proximity indicator explains target |
| Passive healing | 1 HP/s after 8 s without hostile damage; disabled during mining suppression |
| Bandage | Two initially; heal 25 over a 2 s use; movement/hostile hit cancels without consuming |
| Camera | Third-person trailing/offset view; cursor ground projection selects attack direction; movement never overwrites aim |
| Pause / menus | Escape, help, inventory, crafting and draft modal freeze the complete simulation |

## 4. Gathering, inventory and crafting
- Resource hits use the current tool tier every 0.35 s at ≤2.5 m; left mouse aimed at a node harvests it when no enemy is targeted. Combat uses the current melee tier. Harvest cadence is not accelerated by combat attack-speed/Overdrive bonuses.
- Physical resource drops enter a pickup field; Soul Magnet increases pickup radius, not harvest range. Default pickup radius is 2 m.
- Resource tools deal 20 /30 /40 node damage for wood /stone /cursed tiers. Stone or cursed tool is required for cursed deposits.
| Node | HP | Base yield when depleted | Required tier | Special rule |
|---|---:|---|---|---|
| Ancient tree | 60 | 6 wood | Wood | 3 wood-tool hits |
| Stone outcrop | 80 | 4 stone | Wood | 4 wood-tool hits |
| Gold vein | 80 | 2 gold | Wood | 4 wood-tool hits |
| Cursed deposit | 150 | 8 Soul Shards | Stone | 5 stone-tool hits; every third depleted cursed node adds 1 Relic Core |
- Nodes do not regenerate during a run. At least 18 trees, 14 stone nodes, 10 gold veins and 12 cursed deposits are seeded on traversable ground.
- Initial loadout: wood tool, wood melee weapon, bow, 10 arrows, two bandages; zero gathered materials.
| Recipe ID | Cost | Result / use |
|---|---|---|
| stone-tool | 6 wood +8 stone | Stone harvesting tool |
| stone-weapon | 6 wood +8 stone | Melee damage 22; replaces wood damage 14 |
| cursed-tool | 6 stone +4 gold +1 core | Cursed harvesting tool |
| cursed-weapon | 6 stone +4 gold +1 core | Melee damage 32 |
| arrows | 2 wood +1 stone | 10 arrows |
| bandage | 4 wood +1 gold | One bandage; maximum four carried |
| summon-boss | 3 cores | Activate Ashen Spire altar once per run |
- Crafting is deterministic, immediate inside a fully paused modal and consumes resources once. No crafting animation creates free world time.
- Wood, stone, gold, arrows, bandages, run equipment and temporary buffs disappear when the run ends. Soul Shards, unused cores and found blueprints bank only on extraction.

## 5. Enemy roles, tiers and night behavior
| Archetype | HP | Damage | Speed | Tell / attack cooldown | Role / normal reward |
|---|---:|---:|---:|---|---|
| Goblin Stalker | 50 | 8 | 3.8 m/s | 0.45 /1.3 s | Flanking melee; 1 Soul Shard |
| Stone Golem | 200 | 20 | 2.2 m/s | 0.85 /2.6 s | Slow area denial; 3 Soul Shards |
| Blood Wyvern | 120 | 12 | 4.2 m/s | 0.8 /2.2 s | Hovering ranged spit; 2 Soul Shards |
| Relic Hunter | 160 | 16 | 4.8 m/s | 0.65 /1.8 s | Elite ground pursuit; 6 Soul Shards; first hunter kill grants one blueprint |

| Tier | HP multiplier | Damage multiplier | Rule |
|---|---:|---:|---|
| Normal | 1.0 | 1.0 | Ordinary daylight/night spawns |
| Elite | 1.35 | 1.15 | All threat-spawned hunters; stronger silhouette and tell |
| Enraged elite | 1.6 | 1.3 | Future hunters spawned at threat ≥75; no retroactive stat changes |
- Detection radius is 14 m in daylight, 21 m at night. Night speed is ×1.15 and spawn interval is 7 s rather than 12 s; damage is not secretly night-multiplied.
- Per completed cycle add +8% HP and +5% damage, capped after six cycles at +48% /+30%; multiply by tier values.
- Maximum 18 active ordinary/elite enemies, including at most two hunters and two wyverns. Boss occupies a separate single slot.
- Spawn at navigable points 18–30 m away, outside the camera's immediate view and extraction pad; no unavoidable contact spawn or instant untelegraphed blink.
- Normal spawn weights: goblin 60%, golem 25%, wyvern 15%; hunters are threat-driven only. Attack tells remain readable under every visual effect.

## 6. Cursed threat and Overdrive
| Threat setting | Exact value / rule |
|---|---|
| Meter | Global 0–100; cursed node depletion +18, boss summon +30 |
| Cooldown / decay | Decay begins 25 s after last cursed depletion or boss summon; −1 point/s; new disturbance resets delay |
| Healing suppression | Cursed depletion blocks passive healing for 20 s; refresh expiry, never accumulate durations; bandage/lifesteal unaffected |
| Hunters | At ≥40, spawn one if timer permits; next eligible spawn after 25 s; at most two alive |
| Threshold oscillation | Crossing back above 40 does not reset hunter spawn cooldown; existing enemies never despawn on threat reduction |
| High threat | At ≥75, future hunters use enraged-elite tier |
| Overdrive trigger | Current HP strictly <30% maximum; immediate exit at ≥30%; no hysteresis, manual toggle or activation charge |
| Overdrive power | Attack rate ×3 (+200%); direct damage ×2.5 (+150%); +2% direct-damage lifesteal |
| Ordinary stat ceilings | Additive attack speed +25%; additive damage +50% before crit/Overdrive; crit multiplier separately defined below |
| Lifesteal safety | Actual enemy HP removed after mitigation, excluding overkill; direct attacks only; total ≤6%/hit and ≤8 HP/s |
| Exclusions | No healing from nodes, corpses, secondary effects, DoT or summons; no self-damage or in-run max-HP swapping |
- Overdrive does not reduce stamina/ammo costs or grant invulnerability. Its lifesteal may heal the player out of the mode. Resolve eligibility after every HP mutation.
- Feedback: crimson edge vignette, heartbeat, brighter weapon trails and restrained 35 ms hitstop. Reduced-motion mode disables hitstop/camera shake; timers always use actual simulation time, not effect time.

## 7. Gold chests and twelve stackable buffs
- Each of three landmark chests sells a three-choice draft. First paid draft in a run costs 5 gold; each subsequent paid draft costs +3: 5, 8, 11, 14… across all chests.
- Pay only when a valid draft opens; choose exactly one. Modal cannot be dismissed to reroll. Generate choices from seeded RNG, excluding capped buffs; never charge if fewer than one eligible choice remains.
- Kill milestones at 12, 30, 55 and 85 optionally supplement paid drafts with free choices; no further kill milestones initially. Queue pending drafts; never pause in the middle of resolving lethal damage.
- Each buff has five stacks maximum. All secondary damage is non-recursive and cannot generate lifesteal or additional attack procs.
| ID / display name | Per-stack effect | Ceiling / trigger |
|---|---|---|
| chain-lightning / Chain Lightning | Direct hit chains 15% weapon damage to +1 enemy/stack within 6 m | Five targets; each target 1 s chain cooldown |
| cleave / Cleave | Melee arc +8° and reach +0.15 m/stack | +40°, +0.75 m; one direct hit per target per swing |
| vampirism / Vampirism | +0.8% direct-damage lifesteal/stack | 4%; shared 6%/hit and 8 HP/s caps |
| multishot / Multishot | +1 arrow/stack; additional arrows deal 30% bow damage | Five extras; one ammo/volley; no extra volley recursion |
| berserk-speed / Berserk Speed | +5% attack rate/stack | +25% before explicit ×3 Overdrive |
| frost-nova / Frost Nova | Every 6 s, 3 m pulse; +6% slow/stack for 2 s | 30% slow, bosses half; no damage |
| crit-amplifier / Crit Amplifier | +5 percentage points crit chance/stack | Baseline 5%, ceiling 30%; critical damage ×1.5 |
| meteor-strike / Meteor Strike | Every 12 s in combat, marked meteor: 40 damage/stack, radius 3 m | 200 damage; 0.7 s visible warning; no lifesteal |
| ironbark / Ironbark | +4% damage reduction/stack | 20% |
| fleetfoot / Fleetfoot | +3% movement speed/stack | +15%; cannot move while channeling |
| deep-breath / Deep Breath | −4% stamina cost/stack | −20%; does not accelerate recovery |
| soul-magnet / Soul Magnet | +1.5 m pickup radius/stack | Default 2 m →9.5 m; no harvest/channel range effect |

## 8. Boss and extraction
| Setting | Exact rule |
|---|---|
| Boss | Rootbound Sovereign; summon once at Ashen Spire for 3 cores; +30 threat |
| HP / attacks | 1,800 HP before cycle scaling; slam 24 damage, roots 14, shard volley 12; minimum 1 s tells |
| Phases | At 66% /33% HP, 1.5 s clearly signalled invulnerable transition; no healing; new attack pattern each phase |
| Pattern | Phase 1 slam/roots; phase 2 adds volley; phase 3 alternates faster tells with 1 s minimum; no unavoidable damage |
| Boss reward | 40 Soul Shards +one new blueprint if any remain; otherwise 1 core |
| Beacon opens | t=150 /300 /450 /600…; reveal location 15 s beforehand; window lasts 45 s |
| Payout | First ×1.5; second ×2.5; third and every later window ×5.0; multiply all collected Soul Shards once, floor result |
| Selection | Seeded random among three landmarks; exclude active boss arena; reachable in roughly 25 s; avoid repeating last landmark when alternatives qualify |
| Channel | Hold E, stationary, inside 10 m for 10 continuous seconds; enemies remain active |
| Interruptions | Movement, attack, dash, E release, leaving radius, opening modal, or any hostile hit including shield absorption resets to zero |
| Deadline | Completion ≤opening+45 s; last valid start opening+35 s; lethal damage wins same-tick ties |
| Banking | End run, atomically bank multiplied Souls +unused cores +unique blueprints; no multiplier for cores/blueprints |
- Show next beacon countdown, current payout, estimated banked reward, channel interruption reason and end-of-run receipt. Extraction remains legal during a boss fight.

## 9. Hub progression, death and save semantics
| Skill node | Rank effects (1 /2 /3) | Rank costs (Soul Shards) |
|---|---|---|
| Vitality | +5 /10 /15 maximum HP | 20 /50 /100 |
| Endurance | +5 /10 /15 maximum stamina | 20 /50 /100 |
| Training | +5 /10 /15% direct damage | 20 /50 /100 |
| Recovery | Passive-heal waiting time −0.5 /1 /1.5 s | 20 /50 /100 |
| Supply | Starting arrows +5 /10 /15 | 20 /50 /100 |
| Field Medic | Bandage healing +5 /10 /15 HP; starting bandages +0 /1 /2, max four | 20 /50 /100 |
| Surveyor | Reveal next beacon +2 /4 /6 s earlier | 20 /50 /100 |
| Scavenger | First 3 /6 /9 ordinary nodes yield +1 material | 20 /50 /100 |
| Artisan | Starting wood +2 /4 /6 | 20 /50 /100 |
- Nodes are independent; ranks require the previous rank, no hidden prerequisites. Rank values are totals, not summed across ranks. Relic damage benefits share the ordinary +50% cap.
| Relic rank | Upgrade cost | Fixed benefit, choose one blueprint property |
|---|---|---|
| 1 | 25 Souls +1 core | +5% maximum stamina OR +5% direct damage |
| 2 | 60 Souls +2 cores | Same property becomes +10% total |
| 3 | 120 Souls +3 cores | Same property becomes +15% total |
- Blueprints: Ember Fang (damage), Rootheart (stamina), Moon Sigil (damage); deterministic hunter/boss blueprint rotation skips owned blueprints. Equip one relic before deployment.
- Death loses all unbanked loot, cores, blueprints and buffs; existing hub progress remains. Never promise permanent progress on literally every run.
- Optional bounded consolation: eight first-time codex discoveries (four enemy kills, three landmark visits, boss kill) award 2 banked Souls each on run settlement, max 16 over the entire save; repeated discoveries pay nothing. Abandoning a run pays nothing.
- Quit/reload abandons the active run. Save only versioned bank/profile state; no active-run resume initially. Settlement uses a unique run ID to prevent duplicate banking.
- localStorage is local, editable and clearable, not an authoritative economy. Storage failure must show an unsaved warning and preserve a usable in-memory session; optional export/import follows validation.
- Pause/blur freeze all simulation timers; explicit resume without catch-up. Hub generation jobs never change active-run stats.

## 10. Acceptance and tuning
- A fresh offline save can gather, craft, fight every archetype, buy a draft, trigger Overdrive, summon the boss, extract and revisit a persisted hub.
- Death removes run loot; extraction multiplies only Souls using 1.5 /2.5 /5; repeated settlement cannot duplicate rewards.
- Combat tells, threat, lifesteal caps, modal pause and interruption/deadline rules have deterministic tests. No paid request occurs on load or ordinary forge use.
- Tune time-to-first-craft, first-night survival, draft affordability, Overdrive uptime, extraction interruption rate and hub upgrade pace after real play sessions; do not report targets as achieved measurements.
