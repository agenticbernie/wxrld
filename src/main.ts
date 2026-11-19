import { BALANCE } from './config/balance';
import { GameEvents } from './core/events';
import { EMPTY_INPUT, InputController, withoutEdges } from './core/input';
import { Rng } from './core/rng';
import { createRunState, resetRunState } from './core/state';
import { WorldFacade } from './world/WorldFacade';
import { CombatFacade } from './combat/CombatFacade';
import { SystemsFacade } from './systems/SystemsFacade';
import { UiFacade } from './ui/UiFacade';
import { AudioFacade } from './audio/AudioFacade';
import { SaveRepository } from './services/SaveRepository';
import { ForgeService } from './services/ForgeService';
import type { GameContext } from './core/context';
import type { GameAction, InputFrame } from './types/game';
export type { WxrldDebug } from './types/debug';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const root = document.querySelector<HTMLElement>('#ui-root');
if (!canvas || !root) throw new Error('Game canvas and UI root are required.');

function boot(canvas: HTMLCanvasElement, root: HTMLElement): () => void {
  const save = new SaveRepository();
  const state = createRunState(save.load());
  state.unsaved = save.lastError !== null;
  state.notification = save.lastError;
  state.settings.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const events = new GameEvents();
  const ctx: GameContext = { state, events, balance: BALANCE, rng: new Rng(1) };
  const world = new WorldFacade(ctx, { canvas, quality: state.settings.quality });
  const combat = new CombatFacade(ctx);
  const systems = new SystemsFacade(ctx);
  const audio = new AudioFacade(ctx);
  const input = new InputController(canvas);
  const forge = new ForgeService({ apiBase: import.meta.env.VITE_FORGE_API === 'enabled' ? '/api/forge' : null, allowPaid: false });
  let accumulator = 0;
  let pendingEdges: InputFrame = EMPTY_INPUT;
  let notificationValue: string | null = null;
  let notificationUntil = 0;
  let forgeSequence = 0;
  let forgeController: AbortController | null = null;
  let frameId = 0;
  let disposed = false;

  function persist(): void {
    const result = save.save(state.profile);
    state.unsaved = !result.saved;
    if (result.error) state.notification = `Save unavailable: ${result.error}`;
  }
  function pause(reason: 'menu' | 'draft' | 'blur'): void {
    if (state.phase !== 'playing' && state.phase !== 'paused') return;
    systems.handleAction({ type: 'pause' });
    state.phase = 'paused'; state.pauseReason = reason;
    input.clear(); accumulator = 0; pendingEdges = EMPTY_INPUT;
    combat.update(0, EMPTY_INPUT);
  }
  function resume(): void {
    if (state.phase !== 'paused' || state.activeDraft || document.hidden) return;
    state.phase = 'playing'; state.pauseReason = null; input.clear(); accumulator = 0;
  }
  function start(seed: number | null): void {
    if ((state.phase === 'playing' || state.phase === 'paused') && !state.result) systems.abandonRun();
    forgeController?.abort(); forgeSequence++;
    input.clear(); accumulator = 0; pendingEdges = EMPTY_INPUT;
    const selected = seed === null ? crypto.getRandomValues(new Uint32Array(1))[0] ?? 1 : seed >>> 0;
    resetRunState(state, selected, `run-${crypto.randomUUID()}`);
    ctx.rng.reset(selected);
    state.world = world.resetRun();
    combat.resetRun(); systems.resetRun();
    state.phase = 'playing'; state.pauseReason = null;
    world.setPresentation('run');
    events.emit('run:started', { runId: state.runId, seed: selected });
  }
  async function generate(action: Extract<GameAction, { type: 'generate-relic' }>): Promise<void> {
    if (state.phase !== 'hub') return;
    forgeController?.abort(); forgeController = new AbortController();
    const serial = ++forgeSequence;
    let seed = 2166136261;
    for (const char of `${action.recipeId}:${action.customization ?? ''}:${state.profile.relicRanks[action.recipeId]}`) { seed ^= char.charCodeAt(0); seed = Math.imul(seed, 16777619) >>> 0; }
    const currentRank = state.profile.relicRanks[action.recipeId];
    try {
      const job = await forge.submit({ requestId: `preview-${action.recipeId}-${seed}`, recipeId: action.recipeId, rank: currentRank === 0 ? 1 : currentRank, visualSeed: seed, customization: action.customization, allowPaid: false }, forgeController.signal);
      if (serial !== forgeSequence || state.phase !== 'hub') return;
      state.forgeJob = job; events.emit('forge:status', { job });
      const asset = await forge.resolveAsset(job, forgeController.signal);
      if (serial !== forgeSequence || state.phase !== 'hub') return;
      await world.applyRelicVisual(asset);
      if (currentRank > 0) { state.profile.relicVisuals[action.recipeId] = asset; persist(); }
      state.notification = 'Relic silhouette forged locally. Preview changes no gameplay statistics.';
    } catch (error) {
      if (serial === forgeSequence && state.phase === 'hub') state.notification = error instanceof Error ? error.message : 'Forge unavailable; procedural relic retained.';
    }
  }
  function dispatch(action: GameAction): void {
    void audio.unlock().catch(() => undefined);
    switch (action.type) {
      case 'start-run': start(action.seed); break;
      case 'pause': pause('menu'); break;
      case 'resume': resume(); break;
      case 'return-hub':
        if ((state.phase === 'playing' || state.phase === 'paused') && !state.result) systems.abandonRun();
        state.phase = 'hub'; state.pauseReason = null; input.clear(); accumulator = 0;
        world.setPresentation('hub'); combat.update(0, EMPTY_INPUT); break;
      case 'set-quality': state.settings.quality = action.quality; world.setQuality(action.quality); break;
      case 'set-audio':
        state.settings.music = Math.max(0, Math.min(1, action.music)); state.settings.sfx = Math.max(0, Math.min(1, action.sfx)); state.settings.muted = action.muted;
        audio.setVolumes(state.settings.music, state.settings.sfx); audio.setMuted(action.muted); break;
      case 'generate-relic': void generate(action); break;
      default: {
        const wasPlaying = state.phase === 'playing';
        const quickCraft = action.type === 'craft' && action.recipeId !== 'summon-boss' && wasPlaying;
        if (quickCraft) { systems.handleAction({ type: 'pause' }); state.phase = 'paused'; state.pauseReason = 'menu'; }
        const consumed = systems.handleAction(action);
        if (quickCraft) { state.phase = 'playing'; state.pauseReason = null; }
        if (action.type === 'choose-buff' && consumed && !state.activeDraft) resume();
        if (consumed && state.phase === 'hub') {
          persist();
          if (action.type === 'upgrade-relic' || action.type === 'equip-relic') {
            const asset = state.profile.relicVisuals[action.recipeId];
            if (asset) void world.applyRelicVisual(asset).catch(() => undefined);
          }
        }
        if (!consumed && action.type !== 'choose-buff') state.notification = 'Cannot use that action here. Check materials, blueprint, tier, or landmark distance.';
      }
    }
  }
  const ui = new UiFacade(ctx, { root, onAction: dispatch });
  const unsubscribers = [
    events.on('buff:draft-opened', () => pause('draft')),
    events.on('run:ended', ({ result }) => {
      input.clear(); accumulator = 0; pendingEdges = EMPTY_INPUT; forgeController?.abort();
      state.phase = result.outcome === 'extracted' ? 'extracted' : result.outcome === 'dead' ? 'dead' : 'hub';
      state.pauseReason = null; persist();
      world.setPresentation(result.outcome === 'abandoned' ? 'hub' : 'run');
      audio.update(0);
    }),
  ];
  const resize = (): void => world.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  const blur = (): void => { if (state.phase === 'playing' || state.phase === 'paused') pause('blur'); };
  const visibility = (): void => { if (document.hidden) blur(); };
  const gesture = (): void => { void audio.unlock().catch(() => undefined); };
  window.addEventListener('resize', resize); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('pointerdown', gesture); canvas.addEventListener('keydown', gesture);
  const fixedStep = 1 / 60;
  function simulate(dt: number, frame: InputFrame, simulateCombat = true): void {
    if (state.phase !== 'playing') return;
    systems.update(dt, frame);
    if (state.phase === 'playing' && simulateCombat) combat.update(dt, frame);
    systems.afterCombat(dt, frame);
  }
  if (import.meta.env.DEV) window.__WXRLD__ = {
    state, action: dispatch,
    step: (seconds, frame = EMPTY_INPUT, simulateCombat = true) => {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 6000) throw new Error('Invalid test simulation duration.');
      let remaining = seconds; let current = frame;
      while (remaining > 0.0000001 && state.phase === 'playing') { const dt = Math.min(fixedStep, remaining); simulate(dt, current, simulateCombat); current = withoutEdges(current); remaining -= dt; }
      world.update(0); ui.update(0.2);
    },
    diagnostics: () => world.getDiagnostics(),
  };
  let previous = performance.now();
  function frame(now: number): void {
    if (disposed) return;
    const dt = Math.min(0.1, Math.max(0, (now - previous) / 1000)); previous = now;
    let sampled = input.sample((x, y) => world.getAimPoint(x, y));
    if (sampled.pausePressed) { if (state.phase === 'playing') pause('menu'); else if (state.phase === 'paused') resume(); sampled = withoutEdges(sampled); }
    if (state.phase === 'playing') {
      sampled = {
        ...sampled,
        dashPressed: sampled.dashPressed || pendingEdges.dashPressed,
        rangedReleased: sampled.rangedReleased || pendingEdges.rangedReleased,
        magicPressed: sampled.magicPressed || pendingEdges.magicPressed,
        interactPressed: sampled.interactPressed || pendingEdges.interactPressed,
        bandagePressed: sampled.bandagePressed || pendingEdges.bandagePressed,
      };
      accumulator = Math.min(accumulator + dt, fixedStep * 5);
      let stepped = false;
      while (accumulator >= fixedStep && state.phase === 'playing') {
        simulate(fixedStep, sampled); sampled = withoutEdges(sampled); accumulator = Math.max(0, accumulator - fixedStep); stepped = true;
      }
      pendingEdges = stepped ? EMPTY_INPUT : sampled;
    } else { accumulator = 0; pendingEdges = EMPTY_INPUT; }
    if (state.notification !== notificationValue) { notificationValue = state.notification; notificationUntil = now + 6000; }
    if (state.notification && now >= notificationUntil) { state.notification = null; notificationValue = null; }
    world.update(state.phase === 'paused' ? 0 : dt); ui.update(dt); audio.update(dt);
    frameId = requestAnimationFrame(frame);
  }
  world.setPresentation('title'); resize();
  frameId = requestAnimationFrame(frame);
  return () => {
    disposed = true; cancelAnimationFrame(frameId); forgeController?.abort(); forge.dispose();
    window.removeEventListener('resize', resize); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility);
    canvas.removeEventListener('pointerdown', gesture); canvas.removeEventListener('keydown', gesture);
    for (const stop of unsubscribers) stop(); input.dispose(); systems.dispose(); combat.dispose(); ui.dispose(); audio.dispose(); world.dispose(); events.clear();
    delete window.__WXRLD__;
  };
}

try {
  const dispose = boot(canvas, root);
  if (import.meta.hot) import.meta.hot.dispose(dispose);
} catch (error) {
  const screen = document.createElement('section'); screen.className = 'error-screen';
  const panel = document.createElement('div'); const title = document.createElement('h1'); title.textContent = 'The island is out of reach.';
  const text = document.createElement('p'); text.textContent = `WebGL2 is required. Try a current desktop browser with graphics acceleration. ${error instanceof Error ? error.message : 'Renderer initialization failed.'}`;
  panel.append(title, text); screen.append(panel); root.replaceChildren(screen); console.error(error);
}
