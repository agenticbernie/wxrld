import './styles.css';
import { BALANCE, BUFF_IDS, EMPTY_MATERIALS, RELIC_IDS, SKILL_IDS } from '../config/balance';
import type { GameContext } from '../core/context';
import { distanceXZ } from '../core/math';
import { getUiSnapshot } from '../core/selectors';
import type { BuffId, GameAction, Materials, Quality, RecipeId, RelicRecipeId, UiSnapshot } from '../types/game';
import { button, element, formatTime, setText } from './dom';

const RECIPES: readonly RecipeId[] = ['stone-tool', 'stone-weapon', 'cursed-tool', 'cursed-weapon', 'arrows', 'bandage'];
const costText = (cost: Readonly<Materials>): string => Object.entries(cost).filter(([, amount]) => amount > 0).map(([name, amount]) => `${amount} ${name === 'relicCores' ? 'core' : name === 'soulShards' ? 'souls' : name}`).join(' · ');
const pretty = (text: string): string => text.split('-').map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ');
type DamagePopup = { node: HTMLSpanElement; life: number; x: number; y: number };

export class UiFacade {
  private screenKey = '';
  private elapsed = 0;
  private helpOpen = false;
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly popups: DamagePopup[] = [];
  private readonly cleanup: (() => void)[] = [];
  private readonly damageLayer = element('div', 'damage-layer');
  constructor(private readonly ctx: GameContext, private readonly options: { root: HTMLElement; onAction: (action: GameAction) => void }) {
    for (let i = 0; i < 32; i++) {
      const node = element('span', 'damage-number'); node.hidden = true; node.setAttribute('aria-hidden', 'true');
      this.damageLayer.append(node); this.popups.push({ node, life: 0, x: 0, y: 0 });
    }
    this.cleanup.push(ctx.events.on('actor:damaged', event => {
      if (event.amount <= 0 || event.id === 'player') return;
      const popup = this.popups.find(item => item.life <= 0) ?? this.popups[0];
      if (!popup) return;
      popup.life = 0.85;
      popup.x = window.innerWidth / 2 + Math.max(-180, Math.min(180, (event.position.x - ctx.state.player.position.x) * 14));
      popup.y = window.innerHeight * 0.44 + Math.max(-70, Math.min(70, (event.position.z - ctx.state.player.position.z) * 8));
      popup.node.className = `damage-number${event.critical ? ' critical' : ''}`;
      popup.node.textContent = `${Math.ceil(event.amount)}${event.critical ? '!' : ''}`; popup.node.hidden = false;
    }));
    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        const dialog = this.options.root.querySelector<HTMLElement>('.modal-panel');
        const controls = dialog ? [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')] : [];
        const first = controls[0]; const last = controls[controls.length - 1];
        if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      }
      if (event.code === 'Escape' && this.helpOpen && ctx.state.phase === 'title') { this.helpOpen = false; this.screenKey = ''; this.update(0.2); }
      if (event.target instanceof HTMLElement && event.target.matches('input,textarea,select')) return;
      if (ctx.state.phase === 'playing' && /^Digit[1-6]$/.test(event.code)) {
        const recipe = RECIPES[Number(event.code.slice(-1)) - 1];
        if (recipe) options.onAction({ type: 'craft', recipeId: recipe });
      }
    };
    window.addEventListener('keydown', keyboard); this.cleanup.push(() => window.removeEventListener('keydown', keyboard));
    this.update(0.2);
  }
  update(dt: number): void {
    for (const popup of this.popups) {
      if (popup.life <= 0) continue;
      popup.life -= dt;
      popup.node.hidden = popup.life <= 0;
      popup.node.style.transform = `translate(${popup.x}px,${popup.y - (0.85 - popup.life) * 55}px)`;
      popup.node.style.opacity = `${Math.min(1, popup.life * 3)}`;
    }
    this.elapsed += dt;
    if (this.elapsed < 0.09 && this.screenKey) return;
    this.elapsed = 0;
    const snapshot = getUiSnapshot(this.ctx.state);
    const key = snapshot.phase === 'hub' ? `hub:${snapshot.profile.soulShards}:${snapshot.profile.relicCores}:${JSON.stringify(snapshot.profile.skills)}:${JSON.stringify(snapshot.profile.relicRanks)}:${snapshot.profile.equippedRelic}` : `${snapshot.phase}:${snapshot.draft?.id ?? ''}:${this.helpOpen}:${snapshot.settings.muted}`;
    if (key !== this.screenKey) { this.screenKey = key; this.render(snapshot); }
    this.refresh(snapshot);
  }
  dispose(): void { for (const stop of this.cleanup) stop(); this.options.root.replaceChildren(); }
  private action(action: GameAction): void { this.options.onAction(action); }
  private cache(key: string, node: HTMLElement): HTMLElement { this.nodes.set(key, node); return node; }
  private render(snapshot: UiSnapshot): void {
    this.nodes.clear();
    const root = this.options.root;
    const screen = element('section', 'screen');
    if (snapshot.phase === 'title') this.title(screen);
    else if (snapshot.phase === 'hub') this.hub(screen, snapshot);
    else if (snapshot.phase === 'dead' || snapshot.phase === 'extracted') this.summary(screen, snapshot);
    else {
      this.hud(screen);
      if (snapshot.phase === 'paused') {
        const overlay = element('section', 'screen modal-screen');
        if (snapshot.draft) this.draft(overlay, snapshot.draft.choices, snapshot.draft.id);
        else this.pause(overlay, snapshot);
        screen.append(overlay);
      }
    }
    root.replaceChildren(screen, this.damageLayer);
    if (snapshot.phase === 'paused' || snapshot.phase === 'dead' || snapshot.phase === 'extracted') queueMicrotask(() => screen.querySelector<HTMLButtonElement>('.modal-panel button,.summary-panel button')?.focus());
  }
  private brand(): HTMLElement { const mark = element('div', 'brand'); const sigil = element('span', 'sigil'); sigil.setAttribute('aria-hidden', 'true'); mark.append(sigil, element('span', '', 'WXRLD')); return mark; }
  private title(screen: HTMLElement): void {
    screen.className += ' title-screen'; screen.dataset.testid = 'title-screen';
    const top = element('header', 'topline'); top.append(this.brand(), element('span', 'eyebrow', 'A cursed island. An uncertain return.'));
    const hero = element('div', 'title-hero');
    hero.append(element('div', 'eyebrow', 'Roguelike extraction survival'), element('h1', '', 'WXRLD'), element('p', '', 'Gather beneath a dying sun. Fight through the Blood Moon. Escape with your soul intact—or risk one more night.'));
    const enter = button('Enter the Sanctuary', () => this.action({ type: 'return-hub' }), 'primary'); enter.dataset.testid = 'enter-hub';
    const controls = button('Field guide', () => { this.helpOpen = !this.helpOpen; this.screenKey = ''; this.update(0.2); });
    const row = element('div', 'button-row'); row.append(enter, controls); hero.append(row, element('p', 'mobile-note', 'Keyboard and mouse required. Desktop recommended.'));
    const footer = element('div', 'title-footer'); footer.append(element('span', '', '90 SECONDS TO PREPARE · 60 TO SURVIVE'), element('span', '', 'OFFLINE FIRST / NO ACCOUNTS / NO WEB3'));
    screen.append(top, hero, footer);
    if (this.helpOpen) {
      const modal = element('div', 'screen modal-screen'); const panel = element('div', 'panel modal-panel');
      panel.append(element('div', 'eyebrow', 'The island does not forgive hesitation'), element('h2', '', 'Field guide'), this.controls(), element('p', 'muted', 'Mine cursed deposits with a stone pick to gain Souls—and raise threat. At 150 seconds, hold E for 10 uninterrupted seconds inside the beacon. Your first payout is 1.5×; the next is 2.5×, then 5×.'), button('Close guide', () => { this.helpOpen = false; this.screenKey = ''; this.update(0.2); })); modal.append(panel); screen.append(modal);
    }
  }
  private hub(screen: HTMLElement, snapshot: UiSnapshot): void {
    screen.className += ' hub-screen'; screen.dataset.testid = 'hub-screen';
    const top = element('header', 'topline'); top.append(this.brand(), element('span', 'bank', `${snapshot.profile.soulShards} SOULS · ${snapshot.profile.relicCores} CORES`));
    const heading = element('div', 'hub-heading'); heading.append(element('div', 'eyebrow', 'Between the tides / Sanctuary'), element('h2', '', 'What survives becomes strength.'), element('p', 'muted', 'Bank your haul. Shape your legacy. Leave nothing to chance.'));
    const layout = element('div', 'hub-layout'); const skills = element('div', 'panel skill-panel');
    const title = element('div', 'section-title'); title.append(element('h2', '', 'The living covenant'), element('span', 'eyebrow', 'Permanent skills')); skills.append(title);
    const grid = element('div', 'skill-grid');
    for (const id of SKILL_IDS) {
      const skill = BALANCE.skills[id]; const rank = snapshot.profile.skills[id]; const cost = rank === 3 ? undefined : BALANCE.progression.skillCosts[rank];
      const card = element('div', 'skill-card'); card.append(element('div', 'rank', `${'◆'.repeat(rank)}${'◇'.repeat(3 - rank)}`), element('h3', '', skill.name), element('p', 'muted', skill.description));
      const upgrade = button(rank === 3 ? 'Mastered' : `${cost ?? 0} souls · Learn`, () => this.action({ type: 'upgrade-skill', nodeId: id }), 'small'); upgrade.disabled = cost === undefined || snapshot.profile.soulShards < cost; card.append(upgrade); grid.append(card);
    }
    skills.append(grid);
    const forge = element('div', 'panel forge-panel'); const forgeTitle = element('div', 'section-title'); forgeTitle.append(element('h2', '', 'Relic forge'), element('span', 'eyebrow', 'Procedural / offline')); forge.append(forgeTitle);
    for (const id of RELIC_IDS) {
      const relic = BALANCE.relics[id]; const rank = snapshot.profile.relicRanks[id]; const owned = snapshot.profile.blueprints.includes(id); const soulCost = rank === 3 ? undefined : BALANCE.progression.relicSoulCosts[rank]; const coreCost = rank === 3 ? undefined : BALANCE.progression.relicCoreCosts[rank];
      const card = element('div', 'relic-card'); card.append(element('h3', '', relic.name), element('p', 'muted', relic.description), element('div', 'rank', `${owned ? `RANK ${rank}/3` : 'BLUEPRINT: HUNTER / SOVEREIGN'}${snapshot.profile.equippedRelic === id ? ' · EQUIPPED' : ''}`));
      const actions = element('div', 'button-row');
      const upgrade = button(rank >= 3 ? 'Mastered' : `${soulCost ?? 0} souls + ${coreCost ?? 0} core`, () => this.action({ type: 'upgrade-relic', recipeId: id }), 'small'); upgrade.disabled = !owned || soulCost === undefined || coreCost === undefined || snapshot.profile.soulShards < soulCost || snapshot.profile.relicCores < coreCost;
      const equip = button('Equip', () => this.action({ type: 'equip-relic', recipeId: id }), 'small'); equip.disabled = rank === 0 || snapshot.profile.equippedRelic === id;
      const preview = button('Preview', () => this.preview(id), 'small'); actions.append(upgrade, equip, preview); card.append(actions); forge.append(card);
    }
    const note = element('div', 'forge-note'); note.append(element('div', 'eyebrow', 'Custom silhouette · No stat rerolls'));
    const input = element('input'); input.placeholder = 'Aesthetic detail: bronze antlers, moonstone…'; input.maxLength = 400; input.setAttribute('aria-label', 'Relic appearance customization'); this.cache('customization', input);
    note.append(input, this.cache('forge-status', element('p', 'muted', 'Local forge is ready. Xingchi adapter is unconfigured.'))); forge.append(note);
    layout.append(skills, forge);
    const deploy = element('div', 'hub-deploy'); const start = button('Cross into the cursed island', () => this.action({ type: 'start-run', seed: null }), 'primary'); start.dataset.testid = 'start-run'; deploy.append(start, element('p', '', 'ONLY WHAT YOU EXTRACT WILL RETURN'));
    screen.append(top, heading, layout, deploy, this.cache('notification', element('div', 'notification')), this.cache('unsaved', element('div', 'unsaved')));
  }
  private preview(recipeId: RelicRecipeId): void {
    const input = this.nodes.get('customization');
    this.action({ type: 'generate-relic', recipeId, customization: input instanceof HTMLInputElement ? input.value || null : null });
  }
  private meter(label: string, key: string, className = ''): HTMLElement {
    const box = element('div'); const labels = element('div', 'bar-label'); labels.append(element('span', '', label), this.cache(`${key}-value`, element('span')));
    const track = element('div', `meter ${className}`); track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', label); this.cache(`${key}-track`, track);
    track.append(this.cache(`${key}-fill`, element('div', 'meter-fill'))); box.append(labels, track); return box;
  }
  private hud(screen: HTMLElement): void {
    screen.className += ' run-hud'; screen.dataset.testid = 'run-hud';
    const left = element('div', 'hud-left'); left.append(this.meter('Vitality', 'hp'), this.meter('Endurance', 'stamina', 'stamina'), this.cache('overdrive', element('div', 'overdrive-tag', 'BLOOD OVERDRIVE · 3× RATE / 2.5× DAMAGE')));
    const resources = element('div', 'materials'); for (const name of ['wood', 'stone', 'gold', 'soulShards', 'relicCores', 'arrows', 'bandages']) { const item = element('span', '', name === 'soulShards' ? 'Souls' : name === 'relicCores' ? 'Cores' : pretty(name)); item.append(this.cache(`material-${name}`, element('b'))); resources.append(item); } left.append(resources);
    const cycle = element('div', 'hud-cycle'); cycle.append(this.cache('dayphase', element('div', 'eyebrow')), this.cache('clock', element('div', 'clock')), this.cache('cycle', element('div', 'muted')));
    const threat = element('div', 'threat-box'); threat.append(this.meter('Threat', 'threat')); cycle.append(threat, button('Esc · Field guide', () => this.action({ type: 'pause' }), 'small'));
    const beacon = element('div', 'beacon-panel'); beacon.append(this.cache('beacon-title', element('h3')), this.cache('beacon-location', element('p', 'muted')));
    const channel = element('div', 'beacon-row');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('beacon-ring'); svg.setAttribute('viewBox', '0 0 52 52'); svg.setAttribute('aria-hidden', 'true');
    for (const name of ['track', 'progress']) { const circle = document.createElementNS(svg.namespaceURI, 'circle'); circle.setAttribute('cx', '26'); circle.setAttribute('cy', '26'); circle.setAttribute('r', '22'); circle.setAttribute('class', name); if (name === 'progress') circle.setAttribute('id', 'channel-ring'); svg.append(circle); }
    channel.append(svg, this.cache('beacon-progress', element('span', 'beacon-progress'))); beacon.append(channel, this.cache('beacon-payout', element('p', 'muted')));
    const bottom = element('div', 'hud-bottom'); bottom.append(this.cache('hint', element('div', 'hud-hint')));
    const quick = element('div', 'quickcraft'); RECIPES.forEach((id, index) => { const craft = button(`${index + 1} · ${BALANCE.recipes[id].name}`, () => this.action({ type: 'craft', recipeId: id }), 'small'); craft.title = costText(BALANCE.recipes[id].cost); this.cache(`craft-${id}`, craft); quick.append(craft); }); bottom.append(quick, this.cache('buffs', element('div', 'buff-list')));
    const boss = element('div', 'boss-hud'); boss.hidden = true; this.cache('boss', boss); boss.append(element('div', 'eyebrow', 'Rootbound Sovereign'), this.meter('Cursed heart', 'boss-hp'));
    screen.append(left, cycle, boss, beacon, bottom, this.cache('notification', element('div', 'notification')), this.cache('unsaved', element('div', 'unsaved')));
  }
  private controls(): HTMLElement {
    const grid = element('div', 'control-grid');
    for (const [key, description] of [['WASD / Shift', 'Move / sprint'], ['Space', 'Dodge with i-frames'], ['Left mouse', 'Melee / harvest'], ['Right mouse', 'Hold, then release bow'], ['Q / R', 'Magic bolt / bandage'], ['E', 'Interact / hold to extract'], ['1–6', 'Instant quick-craft'], ['Escape', 'Pause / field guide']]) { const row = element('div'); row.append(element('b', '', key), document.createTextNode(description ?? '')); grid.append(row); }
    return grid;
  }
  private pause(overlay: HTMLElement, snapshot: UiSnapshot): void {
    overlay.dataset.testid = 'pause-screen'; const panel = element('div', 'panel modal-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.append(element('div', 'eyebrow', snapshot.phase === 'paused' ? 'The world is paused' : 'Field guide'), element('h2', '', 'Catch your breath.'), this.controls());
    const craft = element('div', 'button-row'); for (const id of RECIPES) craft.append(button(`${BALANCE.recipes[id].name} · ${costText(BALANCE.recipes[id].cost)}`, () => this.action({ type: 'craft', recipeId: id }), 'small')); craft.append(button('Summon Sovereign · 3 cores', () => this.action({ type: 'craft', recipeId: 'summon-boss' }), 'small')); panel.append(craft);
    const quality = element('select'); quality.setAttribute('aria-label', 'Graphics quality'); for (const value of ['low', 'medium', 'high'] as const) { const option = element('option', '', pretty(value)); option.value = value; quality.append(option); } quality.value = snapshot.settings.quality; quality.addEventListener('change', () => { const value = quality.value; if (value === 'low' || value === 'medium' || value === 'high') this.action({ type: 'set-quality', quality: value }); });
    const qualityRow = element('label', 'setting-row', 'Graphics quality'); qualityRow.append(quality); panel.append(qualityRow);
    for (const channel of ['music', 'sfx'] as const) {
      const row = element('label', 'setting-row', channel === 'music' ? 'Atmosphere volume' : 'Effects volume'); const slider = element('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.05'; slider.value = `${snapshot.settings[channel]}`; slider.addEventListener('input', () => this.action({ type: 'set-audio', music: channel === 'music' ? Number(slider.value) : this.ctx.state.settings.music, sfx: channel === 'sfx' ? Number(slider.value) : this.ctx.state.settings.sfx, muted: this.ctx.state.settings.muted })); row.append(slider); panel.append(row);
    }
    const actions = element('div', 'button-row'); actions.append(button('Return to the fight', () => this.action({ type: 'resume' }), 'primary'), button(snapshot.settings.muted ? 'Enable audio' : 'Mute audio', () => this.action({ type: 'set-audio', music: snapshot.settings.music, sfx: snapshot.settings.sfx, muted: !this.ctx.state.settings.muted }), 'small'), button('Abandon run', () => this.action({ type: 'return-hub' }), 'danger')); panel.append(actions, element('p', 'muted', 'A hidden tab pauses automatically. Abandoning forfeits every unbanked reward.')); overlay.append(panel);
  }
  private draft(overlay: HTMLElement, choices: readonly BuffId[], id: string): void {
    overlay.dataset.testid = 'draft-screen'; const panel = element('div', 'panel modal-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.append(element('div', 'eyebrow', 'A bargain with the island'), element('h2', '', 'Choose what changes you.'), element('p', 'muted', 'Select one permanent-for-this-run effect. Identical powers stack up to five times.'));
    const cards = element('div', 'draft-grid'); for (const buffId of choices) { const info = BALANCE.buffs[buffId]; const card = button('', () => this.action({ type: 'choose-buff', draftId: id, buffId }), 'draft-card'); card.append(element('div', 'eyebrow', `Stack ${this.ctx.state.buffs[buffId] + 1} / 5`), element('h3', '', info.name), element('p', '', info.description)); cards.append(card); } panel.append(cards); overlay.append(panel);
  }
  private summary(screen: HTMLElement, snapshot: UiSnapshot): void {
    screen.className += ' modal-screen summary-screen'; screen.dataset.testid = 'summary-screen'; const success = snapshot.phase === 'extracted'; const result = snapshot.result; const panel = element('div', 'panel modal-panel summary-panel');
    panel.append(element('div', 'eyebrow', success ? 'The beacon remembers your name' : 'The island keeps its due'), element('h2', '', success ? 'You made it home.' : 'The Blood Moon claims you.'), element('p', 'muted', success ? 'Your haul is banked. The next expedition begins stronger.' : 'Unbanked loot is lost. Your existing Sanctuary progress remains.'));
    const receipt = element('div', 'receipt'); for (const [label, value] of [['Time on island', formatTime(result?.durationSeconds ?? snapshot.elapsedSeconds)], ['Souls carried', `${result?.collectedSouls ?? 0}`], ['Extraction multiplier', success ? `${result?.multiplier ?? 1.5}×` : 'Lost'], ['Souls banked', `${result?.bankedSouls ?? 0}`], ['Cores banked', `${result?.bankedCores ?? 0}`], ['Blueprints saved', `${result?.bankedBlueprints.length ?? 0}`], ['First discoveries', `${result?.discoverySouls ?? 0} souls`]]) { receipt.append(element('span', '', label), element('b', '', value)); } panel.append(receipt);
    const actions = element('div', 'button-row'); actions.append(button('Return to Sanctuary', () => this.action({ type: 'return-hub' }), 'primary'), button('One more expedition', () => this.action({ type: 'start-run', seed: null }))); panel.append(actions); screen.append(panel);
  }
  private refresh(snapshot: UiSnapshot): void {
    const text = (id: string, value: string): void => { const node = this.nodes.get(id); if (node) setText(node, value); };
    const meter = (id: string, value: number, max: number): void => {
      const fill = this.nodes.get(`${id}-fill`); if (fill) fill.style.width = `${Math.max(0, Math.min(100, value / max * 100))}%`;
      const track = this.nodes.get(`${id}-track`); track?.setAttribute('aria-valuenow', `${Math.round(value)}`); track?.setAttribute('aria-valuemin', '0'); track?.setAttribute('aria-valuemax', `${max}`); text(`${id}-value`, `${Math.ceil(value)} / ${Math.ceil(max)}`);
    };
    meter('hp', snapshot.hp, snapshot.maxHp); meter('stamina', snapshot.stamina, snapshot.maxStamina); meter('threat', snapshot.threat, 100);
    const boss = [...this.ctx.state.enemies.values()].find(enemy => enemy.archetype === 'rootbound-sovereign' && enemy.hp > 0);
    const bossPanel = this.nodes.get('boss'); if (bossPanel) bossPanel.hidden = !boss;
    if (boss) meter('boss-hp', boss.hp, boss.maxHp);
    this.nodes.get('overdrive')?.classList.toggle('active', snapshot.overdrive);
    text('dayphase', snapshot.dayPhase === 'night' ? 'Blood Moon · Hold your ground' : 'Daylight · Gather before dusk'); text('clock', formatTime(snapshot.phaseSecondsRemaining)); text('cycle', `CYCLE ${snapshot.cycleIndex + 1} · ${snapshot.kills} KILLS`);
    for (const [name, value] of Object.entries({ ...snapshot.materials, arrows: snapshot.arrows, bandages: snapshot.bandages })) text(`material-${name}`, `${value}`);
    const beacon = snapshot.beacon; const active = beacon && snapshot.elapsedSeconds >= beacon.opensAt && snapshot.elapsedSeconds <= beacon.closesAt;
    text('beacon-title', active ? 'EXTRACTION WINDOW OPEN' : 'THE NEXT ESCAPE'); text('beacon-location', beacon ? `${pretty(beacon.landmarkId)} · ${formatTime((active ? beacon.closesAt : beacon.opensAt) - snapshot.elapsedSeconds)}` : `Beacon in ${formatTime(snapshot.nextBeaconAt - snapshot.elapsedSeconds)}`); text('beacon-progress', `${(beacon?.channelSeconds ?? 0).toFixed(1)} / 10s`); text('beacon-payout', `${snapshot.payoutMultiplier}× payout · ${snapshot.projectedSouls} Souls projected`);
    const circle = this.options.root.querySelector('#channel-ring'); circle?.setAttribute('stroke-dashoffset', `${138.23 * (1 - (beacon?.channelSeconds ?? 0) / 10)}`);
    let hint = 'WASD Move · Shift Sprint · Space Dodge · LMB Melee · Q Magic · E Interact';
    if (active && beacon && distanceXZ(beacon.position, this.ctx.state.player.position) <= 10) hint = 'HOLD E · STAND STILL FOR 10s · ANY HIT OR ACTION INTERRUPTS';
    else {
      let nearest = 3.1; for (const node of this.ctx.state.resources.values()) { const distance = distanceXZ(node.position, this.ctx.state.player.position); if (!node.depleted && distance < nearest) { nearest = distance; hint = `${pretty(node.kind)} · LMB / Hold E to harvest${node.kind === 'cursed' && snapshot.toolTier === 'wood' ? ' · Requires stone pick' : ''}`; } }
      for (const landmark of this.ctx.state.world?.landmarks ?? []) if (distanceXZ(landmark.position, this.ctx.state.player.position) < 4) hint = landmark.id === 'ashen-spire' ? 'E: Gold chest / Sovereign altar · 3 cores to summon' : 'E: Gold chest · Choose a stackable power';
    }
    text('hint', hint);
    for (const id of RECIPES) { const node = this.nodes.get(`craft-${id}`); if (node instanceof HTMLButtonElement) node.disabled = Object.entries(BALANCE.recipes[id].cost).some(([name, amount]) => amount > (snapshot.materials[name as keyof Materials] ?? 0)); }
    const buffs = this.nodes.get('buffs'); const buffText = BUFF_IDS.filter(id => snapshot.buffs[id] > 0).map(id => `${BALANCE.buffs[id].name} ×${snapshot.buffs[id]}`).join('|'); if (buffs && buffs.dataset.contents !== buffText) { buffs.dataset.contents = buffText; buffs.replaceChildren(...BUFF_IDS.filter(id => snapshot.buffs[id] > 0).map(id => element('span', 'buff-chip', `${BALANCE.buffs[id].name} ×${snapshot.buffs[id]}`))); }
    const notification = this.nodes.get('notification'); if (notification) { setText(notification, snapshot.notification ?? ''); notification.hidden = !snapshot.notification; }
    text('unsaved', snapshot.unsaved ? 'Local storage unavailable — this session is not safely saved.' : '');
    const job = snapshot.forgeJob; if (job) text('forge-status', job.status === 'succeeded' ? 'Procedural silhouette forged locally. No provider request or payment.' : job.error?.message ?? `Forge: ${job.status}`);
  }
}
