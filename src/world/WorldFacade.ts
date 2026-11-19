import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, Color, CylinderGeometry, DirectionalLight, FogExp2, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Raycaster, RingGeometry, Scene, ShaderMaterial, SphereGeometry,
  SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Material,
} from 'three';
import type { GameContext } from '../core/context';
import { Rng } from '../core/rng';
import type { EnemyState, GameEventMap, Quality, ResourceId, Tier, ValidatedAsset, Vec3, WorldLayout } from '../types/game';
import { createTerrain, inClearing, ISLAND_SIZE, noise, WATER_LEVEL, type TerrainBundle } from './terrain';
import { GeometryLibrary } from '../rendering/geometry';
import { createMaterials, createShaderTime, createWater, disposeMaterials, FLASH_INSTANCE, WHITE_INSTANCE, type Palette } from '../rendering/materials';
import { actor, altar, branch, chest, part, poseRig, relic, resource, setWeaponTier, totem, tree, type ModelKit, type ResourceModel, type Rig } from '../rendering/models';
import { PartBatch, type BatchHandle } from '../rendering/batching';
import { Effects, type Tell } from '../rendering/effects';
import { RenderPipeline } from '../rendering/pipeline';
import { disposeGenerated, loadRelicAsset } from '../rendering/assets';

export type WorldOptions = { canvas: HTMLCanvasElement; quality: Quality };
export type WorldDiagnostics = {
  drawCalls: number; triangles: number; geometries: number; textures: number; activeEnemies: number; particles: number;
  quality: Quality; pixelRatio: number; postprocessing: boolean; renderMilliseconds: number; shaderErrors: readonly string[];
  postprocessingError: string | null; assetError: string | null;
  targets: { drawCalls: number; triangles: number; particleLimit: number; textureMiB: number };
};
type ActorVisual = { rig: Rig; handle: BatchHandle; lastMode: EnemyState['mode']; modeStarted: number; flashUntil: number };
type NodeVisual = { model: ResourceModel; handle: BatchHandle; stage: number };
type MovingVisual = { root: Group; handle: BatchHandle };
const cyan = new Color('#79dfcc'), blood = new Color('#f27794'), gold = new Color('#efbd7a');
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const easing = (x: number): number => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const facingAngle = (v: Vec3): number => Math.atan2(v.x, v.z);
const copyPosition = (target: Vector3, source: Vec3): void => { target.set(source.x, source.y, source.z); };

/** Renderer/camera/visual state only. The caller publishes resetRun()'s layout. */
export class WorldFacade {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(48, 1, 0.12, 700);
  readonly scene = new Scene();
  private readonly geo = new GeometryLibrary();
  private readonly shaderTime = createShaderTime();
  private readonly mat: Palette;
  private readonly kit: ModelKit;
  private readonly sun = new DirectionalLight('#ffe1a4', 3.1);
  private readonly fill = new HemisphereLight('#b8d0c6', '#414033', 1.65);
  private readonly pipeline: RenderPipeline;
  private readonly effects = new Effects();
  private readonly sky: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly unsubscribers: (() => void)[] = [];
  private terrain: TerrainBundle | null = null;
  private ground: Mesh | null = null;
  private water: Mesh | null = null;
  private staticBatch = new PartBatch(false, 256);
  private nodeBatch = new PartBatch(false, 128);
  private dynamicBatch = new PartBatch(true, 128);
  private readonly nodes = new Map<ResourceId, NodeVisual>();
  private readonly enemies = new Map<string, ActorVisual>();
  private readonly projectiles = new Map<string, MovingVisual>();
  private readonly loot = new Map<string, MovingVisual>();
  private readonly projectilePool = new Map<string, Group[]>();
  private readonly lootPool: Group[] = [];
  private playerRig: Rig;
  private playerHandle: BatchHandle;
  private playerFlashUntil = 0;
  private playerWeaponTier: Tier = 'wood';
  private playerSwingUntil = 0;
  private playerRangedUntil = 0;
  private playerMagicUntil = 0;
  private playerSwingDuration = 0.28;
  private poseStopUntil = 0;
  private cameraShakeUntil = 0;
  private beaconRoot = new Group();
  private readonly beaconRingGeometry = new RingGeometry(9.93, 10, 96);
  private readonly beaconRingMaterial = new MeshBasicMaterial({ color: cyan.clone().multiplyScalar(1.5), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
  private readonly beaconChannelGeometry = new RingGeometry(1.85, 2.02, 64);
  private readonly beaconChannelMaterial = new MeshBasicMaterial({ color: '#e9d7a0', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  private readonly beaconChannel: Mesh;
  private readonly beaconBeam: Mesh<CylinderGeometry, ShaderMaterial>;
  private readonly aimGeometry = new RingGeometry(0.23, 0.31, 24);
  private readonly aimMaterial = new MeshBasicMaterial({ color: '#e8ecd3', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
  private readonly aimMarker: Mesh;
  private readonly raycaster = new Raycaster();
  private readonly rayPoint = new Vector3();
  private readonly rayRefine = new Vector3();
  private lastAim: Vec3 | null = null;
  private presentation: 'title' | 'hub' | 'run' = 'title';
  private quality: Quality;
  private width = 1;
  private height = 1;
  private requestedDpr = 1;
  private worldClock = 0;
  private decorationClock = 0;
  private lastWallTime = performance.now();
  private renderMilliseconds = 0;
  private disposed = false;
  private cameraInitialized = false;
  private readonly cameraTarget = new Vector3();
  private readonly desiredCamera = new Vector3();
  private readonly desiredTarget = new Vector3();
  private readonly shaderErrors: string[] = [];
  private readonly hubAnchor = new Vector3();
  private hubRelic: Group | null = null;
  private hubRelicHandle: BatchHandle | null = null;
  private generatedRelic = false;
  private visualAsset: ValidatedAsset | null = null;
  private visualRank = -1;
  private assetRequest = 0;
  private assetError: string | null = null;
  private visualRecipe: string | null = null;
  private profileVisualKey = '';

  constructor(private readonly ctx: GameContext, options: WorldOptions) {
    this.quality = options.quality;
    this.renderer = new WebGLRenderer({ canvas: options.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      const message = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n');
      if (this.shaderErrors.length < 8) this.shaderErrors.push(message || 'A graphics shader failed to compile.');
      console.error('Wxrld graphics shader:', message);
    };
    this.mat = createMaterials(this.shaderTime); this.kit = { geo: this.geo, mat: this.mat };
    this.scene.background = new Color('#a8ac99'); this.scene.fog = new FogExp2('#a8ac99', 0.008);
    this.sky = this.createSky(); this.scene.add(this.sky);
    this.sun.castShadow = true; this.sun.shadow.bias = -0.00018; this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 190;
    this.scene.add(this.sun, this.sun.target, this.fill, this.effects.group);
    this.scene.add(this.staticBatch.group, this.nodeBatch.group, this.dynamicBatch.group);
    this.playerRig = actor(this.kit, 'player'); this.playerHandle = this.dynamicBatch.add(this.playerRig.root);
    this.beaconRingMaterial.userData.bloom = true; this.beaconChannelMaterial.userData.bloom = true;
    const ring = new Mesh(this.beaconRingGeometry, this.beaconRingMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; this.beaconRoot.add(ring);
    this.beaconChannel = new Mesh(this.beaconChannelGeometry, this.beaconChannelMaterial); this.beaconChannel.rotation.x = -Math.PI / 2; this.beaconChannel.position.y = 0.11; this.beaconRoot.add(this.beaconChannel);
    this.beaconBeam = this.createBeaconBeam(); this.beaconBeam.position.y = 13; this.beaconRoot.add(this.beaconBeam);
    this.beaconRoot.visible = false; this.scene.add(this.beaconRoot);
    this.aimMarker = new Mesh(this.aimGeometry, this.aimMaterial); this.aimMarker.rotation.x = -Math.PI / 2; this.aimMarker.visible = false; this.scene.add(this.aimMarker);
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, this.quality);
    this.bindEvents(); this.resetRun(); this.setQuality(this.quality);
    const rect = options.canvas.getBoundingClientRect(); this.resize(rect.width || window.innerWidth, rect.height || window.innerHeight, window.devicePixelRatio || 1);
  }

  private createSky(): Mesh<SphereGeometry, ShaderMaterial> {
    const material = new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false,
      uniforms: { uDay: this.shaderTime.daylight, uSun: { value: new Vector3(0.25, 0.5, -0.4).normalize() } },
      vertexShader: 'varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform float uDay; uniform vec3 uSun; varying vec3 vDirection;
        void main(){ vec3 dir=normalize(vDirection); float h=smoothstep(-0.05,0.7,dir.y);
          vec3 horizon=mix(vec3(0.20,0.105,0.15),vec3(0.66,0.64,0.48),uDay);
          vec3 zenith=mix(vec3(0.05,0.075,0.14),vec3(0.25,0.40,0.44),uDay);
          vec3 color=mix(horizon,zenith,h);
          float disk=pow(max(0.0,dot(dir,uSun)),1300.0), halo=pow(max(0.0,dot(dir,uSun)),18.0);
          color+=mix(vec3(0.5,0.13,0.2),vec3(1.4,1.04,0.55),uDay)*(disk+halo*0.10);
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new Mesh(new SphereGeometry(420, 24, 12), material); mesh.frustumCulled = false; return mesh;
  }
  private createBeaconBeam(): Mesh<CylinderGeometry, ShaderMaterial> {
    const material = new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uTime: this.shaderTime.time },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){
        float vertical=smoothstep(0.0,0.08,vUv.y)*(1.0-smoothstep(0.12,1.0,vUv.y));
        float lanes=0.25+pow(abs(sin(vUv.x*25.13+uTime*0.25)),8.0)*0.35;
        gl_FragColor=vec4(0.38,0.8,0.69,vertical*lanes*0.35);
      }`,
    });
    material.userData.bloom = true;
    return new Mesh(new CylinderGeometry(0.3, 1.6, 26, 16, 1, true), material);
  }
  private bindEvents(): void {
    this.unsubscribers.push(
      this.ctx.events.on('fx:requested', fx => {
        if (this.presentation !== 'run') return;
        this.effects.request(fx);
        if (fx.kind === 'slash') { this.playerSwingUntil = this.worldClock + this.playerSwingDuration; }
        if (fx.kind === 'arrow') this.playerRangedUntil = this.worldClock + 0.27;
        if (fx.kind === 'magic') this.playerMagicUntil = this.worldClock + 0.35;
        if ((fx.kind === 'crit' || fx.kind === 'hit') && !this.ctx.state.settings.reducedMotion) {
          this.poseStopUntil = this.worldClock + this.ctx.balance.combat.hitstopSeconds;
          this.cameraShakeUntil = this.worldClock + 0.1;
        }
      }),
      this.ctx.events.on('actor:damaged', event => {
        if (event.id === 'player') this.playerFlashUntil = this.worldClock + 0.17;
        const enemy = this.enemies.get(event.id); if (enemy) enemy.flashUntil = this.worldClock + 0.17;
      }),
      this.ctx.events.on('resource:hit', event => { if (this.presentation === 'run') this.effects.burst(event.position, gold, 8, 0.5); }),
      this.ctx.events.on('resource:depleted', event => { if (this.presentation === 'run') this.effects.burst(event.position, event.kind === 'cursed' ? blood : gold, 18); }),
      this.ctx.events.on('combat:area-requested', event => {
        if (this.presentation === 'run') this.effects.ring(event.origin, event.radius, event.kind === 'frost' ? cyan : gold, event.kind === 'meteor' ? this.ctx.balance.buffEffects.meteorWarning : 0.5);
      }),
      this.ctx.events.on('item:crafted', () => { if (this.presentation === 'run') this.effects.burst(this.ctx.state.player.position, cyan, 18, 0.4, -0.1); }),
    );
  }

  resetRun(): WorldLayout {
    if (this.disposed) throw new Error('WorldFacade is disposed.');
    const preservedGlb = this.generatedRelic ? this.hubRelic : null;
    if (preservedGlb) { this.scene.remove(preservedGlb); this.hubRelic = null; }
    this.clearRunVisuals();
    this.terrain = createTerrain(this.ctx.state.seed);
    this.effects.setTerrain(this.terrain.heightTexture, ISLAND_SIZE);
    const layout = this.terrain.layout;
    this.ground = new Mesh(this.terrain.geometry, this.mat.terrain); this.ground.receiveShadow = true; this.scene.add(this.ground);
    const waterMaterial = createWater(this.terrain.heightTexture, this.shaderTime);
    this.water = new Mesh(new PlaneGeometry(620, 620, 64, 64), waterMaterial); this.water.rotation.x = -Math.PI / 2; this.water.position.y = WATER_LEVEL; this.water.renderOrder = 1; this.scene.add(this.water);
    this.hubAnchor.set(layout.playerSpawn.x - 2.8, layout.playerSpawn.y, layout.playerSpawn.z - 2);
    this.buildScenery(layout);
    for (const node of layout.nodes) {
      const model = resource(this.kit, node.kind, this.nodeSeed(node.id)); copyPosition(model.root.position, node.position);
      model.root.rotation.y = noise(node.position.x, node.position.z, layout.seed) * Math.PI * 2;
      this.nodes.set(node.id, { model, handle: this.nodeBatch.add(model.root), stage: -1 });
    }
    this.playerRig = actor(this.kit, 'player'); this.playerHandle = this.dynamicBatch.add(this.playerRig.root); this.playerWeaponTier = 'wood';
    this.worldClock = this.ctx.state.elapsedSeconds; this.playerSwingUntil = this.playerRangedUntil = this.playerMagicUntil = 0; this.playerFlashUntil = 0; this.cameraInitialized = false;
    this.visualRank = -1; this.visualRecipe = null; this.refreshProceduralRelic();
    if (preservedGlb) this.replaceRelic(preservedGlb, true);
    else if (this.visualAsset?.kind === 'glb') void this.applyRelicVisual(this.visualAsset).catch(() => { /* Baseline retained; diagnostics expose the asset error. */ });
    this.staticBatch.setShadows(this.quality !== 'low'); this.staticBatch.update(); this.nodeBatch.update(); this.dynamicBatch.update();
    return layout;
  }
  private nodeSeed(id: string): number { let n = this.ctx.state.seed; for (const ch of id) n = Math.imul(n, 31) ^ ch.charCodeAt(0); return n >>> 0; }
  private clearRunVisuals(): void {
    this.assetRequest++;
    if (this.hubRelic && this.generatedRelic) disposeGenerated(this.hubRelic);
    if (this.hubRelic) this.scene.remove(this.hubRelic);
    this.hubRelic = null; this.hubRelicHandle = null; this.generatedRelic = false;
    for (const batch of [this.staticBatch, this.nodeBatch, this.dynamicBatch]) { this.scene.remove(batch.group); batch.dispose(); }
    this.staticBatch = new PartBatch(false, 256); this.nodeBatch = new PartBatch(false, 128); this.dynamicBatch = new PartBatch(true, 128);
    this.scene.add(this.staticBatch.group, this.nodeBatch.group, this.dynamicBatch.group);
    this.nodes.clear(); this.enemies.clear(); this.projectiles.clear(); this.loot.clear(); this.projectilePool.clear(); this.lootPool.length = 0;
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); }
    if (this.water) { this.scene.remove(this.water); this.water.geometry.dispose(); for (const material of this.meshMaterials(this.water)) material.dispose(); }
    this.terrain?.heightTexture.dispose(); this.terrain = null; this.ground = null; this.water = null;
    this.effects.clear(); this.beaconRoot.visible = false; this.lastAim = null;
  }
  private meshMaterials(mesh: Mesh): Material[] { return Array.isArray(mesh.material) ? mesh.material : [mesh.material]; }

  private buildScenery(layout: WorldLayout): void {
    const rng = new Rng(layout.seed ^ 0x79a7e331);
    const forestCount = this.quality === 'low' ? 72 : this.quality === 'high' ? 135 : 120;
    let planted = 0;
    for (let attempts = 0; planted < forestCount && attempts < 7000; attempts++) {
      const x = (rng.next() - 0.5) * 143, z = (rng.next() - 0.5) * 143;
      if (!layout.isWalkable(x, z) || inClearing(layout, x, z)) continue;
      if (layout.nodes.some(n => Math.hypot(x - n.position.x, z - n.position.z) < 3)) continue;
      if (this.nearRoute(layout, x, z, 4.8)) continue;
      if (noise(x * 0.045, z * 0.045, layout.seed + 10) < 0.36 || layout.heightAt(x, z) > 18) continue;
      const model = tree(this.kit, rng.int(1, 0x7fffffff));
      model.root.position.set(x, layout.heightAt(x, z), z); model.root.rotation.y = rng.next() * 6.28;
      const s = 0.65 + rng.next() * 0.55; model.root.scale.setScalar(s);
      this.staticBatch.add(model.root); planted++;
    }
    const groundDetail = new Group();
    const detailCount = this.quality === 'low' ? 420 : this.quality === 'high' ? 1550 : 1100;
    for (let j = 0; j < detailCount; j++) {
      const x = (rng.next() - 0.5) * 152, z = (rng.next() - 0.5) * 152, y = layout.heightAt(x, z);
      if (y < WATER_LEVEL + 0.3 || inClearing(layout, x, z, 12.5) || this.nearRoute(layout, x, z, 2.5)) continue;
      if (j % 5 === 0) {
        const s = 0.25 + rng.next() * 0.75;
        part(groundDetail, this.geo.rock, y > 16 ? this.mat.darkRock : this.mat.rock, [x, y + s * 0.12, z], [s * 1.3, s * 0.7, s], [rng.next() * 0.4, rng.next() * 6.28, 0.1]);
      } else if (y < 19 && layout.isWalkable(x, z)) {
        const s = 0.7 + rng.next();
        part(groundDetail, this.geo.grass, j % 4 ? this.mat.grass : this.mat.leafLight, [x, y, z], [s, s, s], [0, rng.next() * 6.28, 0]);
        if (j % 9 === 0) part(groundDetail, this.geo.crown, this.mat.leafLight, [x, y + 0.25, z], [0.6, 0.7, 0.55], [0, rng.next() * 6.28, 0]);
      }
    }
    this.staticBatch.add(groundDetail);
    for (const landmark of layout.landmarks) {
      const decoration = new Group(); copyPosition(decoration.position, landmark.position);
      decoration.add(altar(this.kit, 3.1, landmark.id === 'ashen-spire'));
      const coffer = chest(this.kit); coffer.root.position.set(3.8, 0, 0.8); coffer.root.rotation.y = -0.7; decoration.add(coffer.root);
      if (landmark.id === 'ancient-grove') {
        for (const s of [-1, 1]) {
          const ancient = tree(this.kit, layout.seed + 101 + s, true); ancient.root.position.set(s * 10, 0, -7); ancient.root.rotation.z = -s * 0.18; decoration.add(ancient.root);
          branch(decoration, this.kit, [s * 6, 0, -5], [s * 4, 5.8, -6], 1.6);
          branch(decoration, this.kit, [s * 4, 5.8, -6], [0, 8.6, -6], 1.05);
          part(decoration, this.geo.rock, this.mat.bark, [s * 4, 4, -6], [1.2, 1.6, 1.2]);
        }
      } else if (landmark.id === 'sunken-shrine') {
        for (let i = 0; i < 7; i++) {
          const a = i * 6.28 / 7, h = 3 + (i % 3) * 1.8;
          part(decoration, this.geo.joint, this.mat.rock, [Math.sin(a) * 10, h / 2, Math.cos(a) * 10], [1.5, h, 1.5], [i % 2 ? 0.16 : -0.1, a, i % 3 ? 0 : 0.3]);
          part(decoration, this.geo.slab, this.mat.darkRock, [Math.sin(a) * 10, h, Math.cos(a) * 10], [2.1, 0.45, 1.9], [0.05, a, 0.15]);
          part(decoration, this.geo.slab, this.mat.gold, [Math.sin(a) * 10, h * 0.6, Math.cos(a) * 10 + 0.76], [0.09, 0.8, 0.04], [0, a, 0.1]);
        }
      } else {
        const bossTotem = totem(this.kit); bossTotem.position.z = -5; decoration.add(bossTotem);
        for (let i = 0; i < 7; i++) {
          const a = i * 6.28 / 7, h = 6 + (i % 3) * 2.7;
          part(decoration, this.geo.shard, this.mat.darkRock, [Math.cos(a) * 9, 0, Math.sin(a) * 9], [5, h, 3.3], [0.12, a, (i % 2 ? 1 : -1) * 0.13]);
          part(decoration, this.geo.shard, this.mat.crystal, [Math.cos(a) * 8.5, 0.3, Math.sin(a) * 8.5], [0.35, 2.1 + i % 3, 0.4], [0.1, a, 0.3]);
        }
      }
      this.staticBatch.add(decoration);
    }
    const forgePlatform = altar(this.kit, 2.2); forgePlatform.position.copy(this.hubAnchor); this.staticBatch.add(forgePlatform);
  }
  private nearRoute(layout: WorldLayout, x: number, z: number, width: number): boolean {
    const a = layout.playerSpawn;
    return layout.landmarks.some(landmark => {
      const b = landmark.position, dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp01(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz));
      return Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < width;
    });
  }

  setPresentation(mode: 'title' | 'hub' | 'run'): void {
    if (mode === this.presentation) return;
    this.presentation = mode; this.cameraInitialized = false; this.lastAim = null;
    this.effects.clear(); this.playerSwingUntil = 0;
    if (mode === 'hub') this.refreshProceduralRelic();
  }
  getAimPoint(clientX: number, clientY: number): Vec3 | null {
    if (this.presentation !== 'run' || !this.terrain) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.raycaster.setFromCamera(new Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.camera);
    const ray = this.raycaster.ray, layout = this.terrain.layout;
    // Traverse heightfield, then refine the first surface crossing. Avoid a 32k-triangle raycast every fixed tick.
    let previousT = 0;
    for (let t = 0; t < 430; t += 0.8) {
      const point = ray.at(t, this.rayPoint);
      if (Math.abs(point.x) > ISLAND_SIZE / 2 || Math.abs(point.z) > ISLAND_SIZE / 2) { previousT = t; continue; }
      const height = layout.heightAt(point.x, point.z);
      if (point.y <= height) {
        let lo = previousT, hi = t;
        for (let j = 0; j < 10; j++) { const middle = (lo + hi) / 2, p = ray.at(middle, this.rayRefine); if (p.y > layout.heightAt(p.x, p.z)) lo = middle; else hi = middle; }
        const p = ray.at(hi, this.rayRefine);
        if (layout.heightAt(p.x, p.z) <= WATER_LEVEL) { this.lastAim = null; return null; }
        this.lastAim = { x: p.x, y: layout.heightAt(p.x, p.z), z: p.z }; return { ...this.lastAim };
      }
      previousT = t;
    }
    this.lastAim = null; return null;
  }

  async applyRelicVisual(asset: ValidatedAsset): Promise<void> {
    if (this.disposed) return;
    this.visualAsset = asset; this.assetError = null; this.profileVisualKey = this.getProfileVisualKey();
    const request = ++this.assetRequest;
    if (asset.kind === 'procedural') { this.replaceRelic(relic(this.kit, asset.recipeId, asset.seed, this.ctx.state.profile.relicRanks[asset.recipeId]), false); this.visualRank = this.ctx.state.profile.relicRanks[asset.recipeId]; this.visualRecipe = asset.recipeId; return; }
    try {
      const model = await loadRelicAsset(asset);
      if (this.disposed || request !== this.assetRequest) { disposeGenerated(model); return; }
      this.replaceRelic(model, true);
    } catch (error) {
      if (request === this.assetRequest) this.assetError = error instanceof Error ? error.message : 'Relic model could not load.';
      // Keep the complete procedural motif visible on network/decode failure.
      throw error;
    }
  }
  private replaceRelic(model: Group, generated: boolean): void {
    if (this.hubRelicHandle) this.dynamicBatch.remove(this.hubRelicHandle);
    if (this.hubRelic) { this.scene.remove(this.hubRelic); if (this.generatedRelic) disposeGenerated(this.hubRelic); }
    this.hubRelic = model; this.generatedRelic = generated;
    this.hubRelicHandle = generated ? null : this.dynamicBatch.add(model);
    if (generated) this.scene.add(model);
  }
  private getProfileVisualKey(): string {
    const profile = this.ctx.state.profile, recipe = profile.equippedRelic ?? 'ember-fang', asset = profile.relicVisuals[recipe];
    const descriptor = asset?.kind === 'procedural' ? `${asset.recipeId}:${asset.seed}` : asset?.kind === 'glb' ? asset.assetId : 'baseline';
    return `${recipe}:${profile.relicRanks[recipe]}:${descriptor}`;
  }
  private syncProfileRelic(): void {
    const key = this.getProfileVisualKey();
    if (key === this.profileVisualKey) return;
    this.profileVisualKey = key;
    const profile = this.ctx.state.profile, recipe = profile.equippedRelic ?? 'ember-fang', asset = profile.relicVisuals[recipe];
    if (asset) {
      if (asset.kind === 'glb' && this.visualAsset?.kind === 'glb' && asset.assetId === this.visualAsset.assetId && this.generatedRelic) return;
      void this.applyRelicVisual(asset).catch(() => { /* Loading failure keeps the current complete procedural motif. */ });
    } else {
      this.assetRequest++; this.visualAsset = null;
      this.replaceRelic(relic(this.kit, recipe, this.ctx.state.seed ^ 0x591a, profile.relicRanks[recipe]), false);
      this.visualRecipe = recipe; this.visualRank = profile.relicRanks[recipe];
    }
  }
  private refreshProceduralRelic(): void {
    const profile = this.ctx.state.profile, recipe = this.visualAsset?.kind === 'procedural' ? this.visualAsset.recipeId : profile.equippedRelic ?? 'ember-fang';
    const rank = profile.relicRanks[recipe];
    if (this.generatedRelic || (recipe === this.visualRecipe && rank === this.visualRank && this.hubRelic)) return;
    const seed = this.visualAsset?.kind === 'procedural' ? this.visualAsset.seed : this.ctx.state.seed ^ 0x591a;
    this.replaceRelic(relic(this.kit, recipe, seed, rank), false); this.visualRecipe = recipe; this.visualRank = rank;
  }

  setQuality(quality: Quality): void {
    const changed = this.quality !== quality; this.quality = quality;
    const resolution = quality === 'low' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== resolution) { this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; this.sun.shadow.mapSize.set(resolution, resolution); }
    this.shaderTime.rim.value = quality === 'low' ? 0.35 : 1;
    this.pipeline.setQuality(quality); this.staticBatch.setShadows(quality !== 'low');
    this.resize(this.width, this.height, this.requestedDpr);
    if (changed && this.terrain) {
      // Visual-only LOD rebuild: navigation, seeded nodes and shared state are untouched.
      this.scene.remove(this.staticBatch.group); this.staticBatch.dispose(); this.staticBatch = new PartBatch(false, 256); this.scene.add(this.staticBatch.group);
      this.buildScenery(this.terrain.layout); this.staticBatch.setShadows(quality !== 'low'); this.staticBatch.update();
    }
  }
  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Number.isFinite(width) ? width : 1); this.height = Math.max(1, Number.isFinite(height) ? height : 1);
    this.requestedDpr = Math.max(0.5, Number.isFinite(pixelRatio) ? pixelRatio : 1);
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    const ratio = Math.min(cap, this.requestedDpr);
    this.renderer.setPixelRatio(ratio); this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix();
    this.pipeline.resize(Math.round(this.width * ratio), Math.round(this.height * ratio));
  }

  update(dt: number): void {
    if (this.disposed || !this.terrain) return;
    const wall = performance.now(), decorativeDt = Math.min(0.05, Math.max(0, (wall - this.lastWallTime) / 1000)); this.lastWallTime = wall;
    const simulationDt = this.presentation === 'run' && this.ctx.state.phase === 'playing' ? Math.min(0.1, Math.max(0, dt)) : 0;
    this.worldClock += simulationDt;
    if (this.presentation !== 'run') this.decorationClock += decorativeDt;
    const clock = this.presentation === 'run' ? this.worldClock : this.decorationClock;
    this.shaderTime.time.value = clock; this.shaderTime.motion.value = this.ctx.state.settings.reducedMotion ? 0.18 : 1;
    this.effects.setReducedMotion(this.ctx.state.settings.reducedMotion);
    this.updateLighting(); this.reconcileResources(); this.reconcileActors(clock); this.reconcileProjectiles(clock); this.reconcileLoot(clock); this.updateBeacon(clock);
    this.syncProfileRelic(); this.refreshProceduralRelic();
    if (this.hubRelic) {
      this.hubRelic.visible = this.presentation === 'hub';
      this.hubRelic.position.set(this.hubAnchor.x, this.hubAnchor.y + 1.35 + Math.sin(clock * 1.1) * (this.ctx.state.settings.reducedMotion ? 0 : 0.08), this.hubAnchor.z);
      this.hubRelic.rotation.y = clock * (this.ctx.state.settings.reducedMotion ? 0.05 : 0.2);
    }
    this.updateCamera(simulationDt, decorativeDt);
    this.effects.update(simulationDt, this.camera.quaternion);
    this.aimMarker.visible = this.presentation === 'run' && this.lastAim !== null;
    if (this.lastAim) this.aimMarker.position.set(this.lastAim.x, this.lastAim.y + 0.06, this.lastAim.z);
    this.nodeBatch.update(); this.dynamicBatch.update();
    const start = performance.now(); this.renderer.info.reset();
    this.pipeline.render(simulationDt, this.presentation === 'run' && this.ctx.state.player.overdrive ? 1 : 0, clock, this.ctx.state.settings.reducedMotion);
    this.renderMilliseconds = performance.now() - start;
  }

  private reconcileResources(): void {
    const show = this.presentation === 'run';
    for (const [id, visual] of this.nodes) {
      const state = this.ctx.state.resources.get(id);
      const fraction = show ? (state ? (state.depleted ? 0 : clamp01(state.hp / Math.max(1, state.maxHp))) : 0) : 1;
      const stage = fraction <= 0 ? 0 : Math.max(1, Math.ceil(fraction * visual.model.stages.length));
      if (stage !== visual.stage) {
        visual.stage = stage;
        for (let i = 0; i < visual.model.stages.length; i++) { const group = visual.model.stages[i]; if (group) group.visible = i < stage; }
        this.nodeBatch.invalidate();
      }
      if (state && (visual.model.root.position.x !== state.position.x || visual.model.root.position.y !== state.position.y || visual.model.root.position.z !== state.position.z)) { copyPosition(visual.model.root.position, state.position); this.nodeBatch.invalidate(); }
    }
    // Shared resource maps may contain valid dynamically added nodes, not just reset layout IDs.
    for (const [id, state] of this.ctx.state.resources) if (!this.nodes.has(id)) {
      const model = resource(this.kit, state.kind, this.nodeSeed(id)); copyPosition(model.root.position, state.position);
      this.nodes.set(id, { model, handle: this.nodeBatch.add(model.root), stage: -1 });
    }
  }
  private reconcileActors(clock: number): void {
    const state = this.ctx.state, run = this.presentation === 'run';
    this.playerRig.root.visible = this.presentation !== 'title';
    if (run) { copyPosition(this.playerRig.root.position, state.player.position); this.playerRig.root.rotation.y = facingAngle(state.player.facing); }
    else { this.playerRig.root.position.set(this.hubAnchor.x + 2.6, this.hubAnchor.y + 0.05, this.hubAnchor.z + 1.1); this.playerRig.root.rotation.y = 0.55; }
    if (this.playerWeaponTier !== state.player.weaponTier) {
      this.dynamicBatch.remove(this.playerHandle); setWeaponTier(this.playerRig, this.kit, state.player.weaponTier); this.playerHandle = this.dynamicBatch.add(this.playerRig.root); this.playerWeaponTier = state.player.weaponTier;
    }
    this.playerHandle.tint.copy(this.playerFlashUntil > this.worldClock ? FLASH_INSTANCE : WHITE_INSTANCE);
    if (this.worldClock >= this.poseStopUntil || !run) {
      const swinging = Math.max(0, this.playerSwingUntil - this.worldClock);
      poseRig(this.playerRig, clock, run && Math.hypot(state.player.velocity.x, state.player.velocity.z) > 0.3, state.player.hp <= 0 && run ? 'dead' : 'idle', state.player.hp <= 0 ? 1 : 0, swinging > 0 ? 1 - swinging / this.playerSwingDuration + 0.001 : 0, state.settings.reducedMotion);
    }
    const bowActive = run && this.playerRangedUntil > this.worldClock;
    const magicActive = run && this.playerMagicUntil > this.worldClock;
    this.playerRig.weapon.visible = !bowActive;
    if (this.playerRig.bow) this.playerRig.bow.visible = bowActive;
    if (bowActive) {
      this.playerRig.leftArm.rotation.x = -1.45; this.playerRig.leftArm.rotation.z = 0.22;
      this.playerRig.rightArm.rotation.x = -1.35; this.playerRig.rightArm.rotation.z = -0.65;
    } else if (magicActive) { this.playerRig.leftArm.rotation.x = -1.7; this.playerRig.leftArm.rotation.z = 0.25; }
    for (const [id, visual] of this.enemies) if (!state.enemies.has(id)) { this.dynamicBatch.remove(visual.handle); this.enemies.delete(id); }
    const tells: Tell[] = [];
    for (const [id, enemy] of state.enemies) {
      let visual = this.enemies.get(id);
      if (!visual) { const rig = actor(this.kit, enemy.archetype); visual = { rig, handle: this.dynamicBatch.add(rig.root), lastMode: enemy.mode, modeStarted: state.elapsedSeconds, flashUntil: 0 }; this.enemies.set(id, visual); }
      visual.rig.root.visible = run;
      copyPosition(visual.rig.root.position, enemy.position); visual.rig.root.rotation.y = facingAngle(enemy.facing);
      if (enemy.archetype === 'blood-wyvern' && enemy.mode !== 'dead') visual.rig.root.position.y += 0.9 + Math.sin(clock * 3) * (state.settings.reducedMotion ? 0.03 : 0.14);
      const eliteScale = enemy.tier === 'normal' ? 1 : enemy.tier === 'elite' ? 1.08 : 1.15; visual.rig.root.scale.setScalar(visual.rig.scale * eliteScale);
      visual.handle.tint.copy(visual.flashUntil > this.worldClock ? FLASH_INSTANCE : WHITE_INSTANCE);
      if (enemy.mode !== visual.lastMode) { visual.lastMode = enemy.mode; visual.modeStarted = state.elapsedSeconds; }
      const duration = Math.max(0.08, enemy.modeUntil - visual.modeStarted), progress = clamp01((state.elapsedSeconds - visual.modeStarted) / duration);
      if (this.worldClock >= this.poseStopUntil) poseRig(visual.rig, clock + this.nodeSeed(id) % 10, enemy.mode === 'chase', enemy.mode, progress, 0, state.settings.reducedMotion);
      if (run && enemy.mode === 'windup') this.enemyTell(enemy, progress, tells);
    }
    this.effects.setTells(tells);
  }
  private enemyTell(enemy: EnemyState, progress: number, tells: Tell[]): void {
    const position = { ...enemy.position, y: this.terrain!.layout.heightAt(enemy.position.x, enemy.position.z) };
    if (enemy.archetype === 'rootbound-sovereign') {
      tells.push({ position, radius: enemy.phase === 1 ? 5 : 7, progress, color: blood, pattern: 'roots' });
      if (enemy.phase >= 2) {
        const target = this.ctx.state.player.position;
        tells.push({ position: { ...target }, radius: 2.3, progress, color: gold, pattern: 'ranged' });
        for (const s of [-1, 1]) tells.push({ position: { x: target.x + s * 3.5, y: this.terrain!.layout.heightAt(target.x + s * 3.5, target.z), z: target.z }, radius: 1.1, progress, color: blood, pattern: 'roots' });
      }
    } else if (enemy.archetype === 'blood-wyvern' || enemy.archetype === 'relic-hunter') {
      tells.push({ position: { ...this.ctx.state.player.position }, radius: enemy.archetype === 'blood-wyvern' ? 2.5 : 1.35, progress, color: enemy.archetype === 'blood-wyvern' ? blood : cyan, pattern: 'ranged' });
    } else tells.push({ position, radius: enemy.archetype === 'stone-golem' ? 3.5 : 1.6, progress, color: enemy.archetype === 'stone-golem' ? gold : blood, pattern: 'slam' });
  }
  private makeProjectile(kind: GameEventMap['fx:requested']['kind'] | 'wyvern-spit' | 'boss-shard'): Group {
    const root = new Group();
    if (kind === 'arrow') {
      branch(root, this.kit, [0, 0, 0], [0, 0.95, 0], 0.04, this.mat.barkLight);
      part(root, this.geo.shard, this.mat.bone, [0, 0.86, 0], [0.23, 0.27, 0.2]);
      for (const s of [-1, 1]) part(root, this.geo.slab, this.mat.bone, [s * 0.055, 0.1, 0], [0.09, 0.2, 0.02], [0, 0, s * 0.28]);
    } else {
      const mat = kind === 'magic' ? this.mat.cyan : this.mat.crystal;
      part(root, this.geo.shard, mat, [0, 0, 0], [0.5, 0.75, 0.5]);
      part(root, this.geo.rock, mat, [0, 0.12, 0], [0.26, 0.26, 0.26]);
    }
    return root;
  }
  private reconcileProjectiles(clock: number): void {
    const state = this.ctx.state;
    for (const [id, visual] of this.projectiles) if (!state.projectiles.has(id)) {
      this.dynamicBatch.remove(visual.handle); this.projectiles.delete(id);
      const kind: unknown = visual.root.userData.projectileKind;
      if (typeof kind === 'string') { const pool = this.projectilePool.get(kind) ?? []; if (pool.length < 24) pool.push(visual.root); this.projectilePool.set(kind, pool); }
    }
    for (const [id, projectile] of state.projectiles) {
      let visual = this.projectiles.get(id);
      if (!visual) {
        const root = this.projectilePool.get(projectile.kind)?.pop() ?? this.makeProjectile(projectile.kind); root.userData.projectileKind = projectile.kind;
        visual = { root, handle: this.dynamicBatch.add(root) }; this.projectiles.set(id, visual);
      }
      visual.root.visible = this.presentation === 'run'; copyPosition(visual.root.position, projectile.position);
      const velocity = new Vector3(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z);
      if (velocity.lengthSq() > 0.001) visual.root.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), velocity.normalize());
      if (projectile.kind !== 'arrow') visual.root.rotateY(Math.sin(clock * 4) * 0.02);
    }
  }
  private reconcileLoot(clock: number): void {
    for (const [id, visual] of this.loot) if (!this.ctx.state.loot.has(id)) { this.dynamicBatch.remove(visual.handle); this.loot.delete(id); if (this.lootPool.length < 30) this.lootPool.push(visual.root); }
    for (const [id, loot] of this.ctx.state.loot) {
      let visual = this.loot.get(id);
      if (!visual) {
        const root = this.lootPool.pop() ?? new Group();
        if (root.children.length === 0) {
          part(root, this.geo.rock, this.mat.darkRock, [0, 0.13, 0], [0.34, 0.32, 0.34]);
          part(root, this.geo.shard, this.mat.cyan, [0, 0.18, 0], [0.5, 0.55, 0.5]);
          part(root, this.geo.ring, this.mat.gold, [0, 0.35, 0], [0.27, 0.27, 0.5], [Math.PI / 2, 0, 0]);
        }
        visual = { root, handle: this.dynamicBatch.add(root) }; this.loot.set(id, visual);
      }
      visual.root.visible = this.presentation === 'run';
      visual.root.position.set(loot.position.x, loot.position.y + 0.1 + Math.sin(clock * 2 + this.nodeSeed(id) % 10) * (this.ctx.state.settings.reducedMotion ? 0 : 0.08), loot.position.z);
      visual.root.rotation.y = clock * 0.8;
    }
  }
  private updateBeacon(clock: number): void {
    const beacon = this.ctx.state.beacon;
    this.beaconRoot.visible = this.presentation === 'run' && beacon !== null && beacon.announced && this.ctx.state.elapsedSeconds <= beacon.closesAt;
    if (!beacon) return;
    copyPosition(this.beaconRoot.position, beacon.position);
    const open = this.ctx.state.elapsedSeconds >= beacon.opensAt;
    this.beaconRingMaterial.opacity = open ? 0.85 : 0.36;
    this.beaconBeam.visible = open;
    this.beaconChannel.geometry.setDrawRange(0, Math.floor(clamp01(beacon.channelSeconds / this.ctx.balance.extraction.channelSeconds) * 64) * 6);
    this.beaconChannel.visible = open && beacon.channelSeconds > 0;
    const pulse = this.ctx.state.settings.reducedMotion ? 1 : 1 + Math.sin(clock * 2) * 0.008;
    this.beaconBeam.scale.set(pulse, 1, pulse);
  }
  private updateLighting(): void {
    const state = this.ctx.state, cycle = state.elapsedSeconds % this.ctx.balance.extraction.cycleSeconds, dayEnd = this.ctx.balance.extraction.daySeconds;
    let daylight = 1;
    if (this.presentation === 'run') {
      daylight = cycle < dayEnd - 10 ? 1 : cycle < dayEnd ? 1 - easing((cycle - (dayEnd - 10)) / 10) : cycle < this.ctx.balance.extraction.cycleSeconds - 10 ? 0 : easing((cycle - (this.ctx.balance.extraction.cycleSeconds - 10)) / 10);
    }
    this.shaderTime.daylight.value = daylight;
    this.sun.color.copy(new Color('#e4a0b5').lerp(new Color('#ffe2a8'), daylight)); this.sun.intensity = 1.6 + daylight * 1.5;
    this.fill.color.copy(new Color('#8296bb').lerp(new Color('#bdd3cb'), daylight)); this.fill.groundColor.copy(new Color('#3e3045').lerp(new Color('#555443'), daylight)); this.fill.intensity = 1.25 + daylight * 0.45;
    const fog = this.scene.fog;
    if (fog instanceof FogExp2) {
      fog.color.copy(new Color('#493445').lerp(new Color('#a4ad99'), daylight));
      const threat = this.presentation === 'run' ? clamp01(state.threat / this.ctx.balance.threat.max) : 0;
      fog.color.lerp(new Color('#67414f'), threat * 0.11); fog.density = 0.016 - daylight * 0.008;
      if (this.scene.background instanceof Color) this.scene.background.copy(fog.color);
    }
    const focus = this.presentation === 'run' ? state.player.position : { x: -8, y: 7, z: -8 };
    const shadowRange = this.presentation === 'run' ? 33 : 78;
    this.sun.target.position.set(Math.round(focus.x), focus.y, Math.round(focus.z));
    this.sun.position.set(focus.x + 35 * daylight - 10, focus.y + 66, focus.z + 20 * daylight - 26);
    this.sun.shadow.camera.left = -shadowRange; this.sun.shadow.camera.right = shadowRange; this.sun.shadow.camera.top = shadowRange; this.sun.shadow.camera.bottom = -shadowRange; this.sun.shadow.camera.updateProjectionMatrix();
    const direction = this.sky.material.uniforms.uSun;
    if (direction) direction.value = this.sun.position.clone().sub(this.sun.target.position).normalize();
  }
  private updateCamera(simulationDt: number, decorativeDt: number): void {
    const layout = this.terrain!.layout;
    if (this.presentation === 'run') {
      const p = this.ctx.state.player.position;
      this.desiredTarget.set(p.x, p.y + 1.2, p.z - 1.4);
      this.desiredCamera.set(p.x, p.y + 8.6, p.z + 12.4);
      // Shorten the arm rather than let it pass through a cliff behind the player.
      const anchor = new Vector3(p.x, p.y + 1.8, p.z);
      for (let j = 1; j <= 10; j++) {
        const check = anchor.clone().lerp(this.desiredCamera, j / 10);
        if (check.y < layout.heightAt(check.x, check.z) + 0.8) {
          this.desiredCamera.copy(anchor).lerp(this.desiredCamera, Math.max(0.25, (j - 1) / 10)); this.desiredCamera.y = Math.max(this.desiredCamera.y, layout.heightAt(this.desiredCamera.x, this.desiredCamera.z) + 1.5); break;
        }
      }
      this.camera.fov = this.width / this.height < 0.85 ? 57 : 48;
    } else if (this.presentation === 'hub') {
      this.desiredTarget.set(this.hubAnchor.x + 0.9, this.hubAnchor.y + 1.35, this.hubAnchor.z);
      this.desiredCamera.set(this.hubAnchor.x + 6, this.hubAnchor.y + 4.6, this.hubAnchor.z + 9);
      this.camera.fov = this.width / this.height < 0.85 ? 54 : 43;
    } else {
      const orbit = this.ctx.state.settings.reducedMotion ? 0 : Math.sin(this.decorationClock * 0.025) * 0.11;
      this.desiredTarget.set(-11, 7.5, -15);
      this.desiredCamera.set(58 + Math.sin(orbit) * 35, 41, 104 + Math.cos(orbit) * 8);
      this.camera.fov = this.width / this.height < 0.85 ? 62 : 46;
    }
    if (!this.cameraInitialized) { this.camera.position.copy(this.desiredCamera); this.cameraTarget.copy(this.desiredTarget); this.cameraInitialized = true; }
    else {
      const delta = this.presentation === 'run' ? simulationDt : decorativeDt;
      const smoothing = 1 - Math.exp(-delta * (this.presentation === 'run' ? 10 : 3));
      if (this.worldClock >= this.poseStopUntil || this.presentation !== 'run') { this.camera.position.lerp(this.desiredCamera, smoothing); this.cameraTarget.lerp(this.desiredTarget, smoothing); }
    }
    const clearance = layout.heightAt(this.camera.position.x, this.camera.position.z) + 1.6;
    this.camera.position.y = Math.max(clearance, this.camera.position.y);
    this.camera.lookAt(this.cameraTarget);
    if (this.presentation === 'run' && this.cameraShakeUntil > this.worldClock && !this.ctx.state.settings.reducedMotion) this.camera.rotation.z += Math.sin(this.worldClock * 140) * 0.003;
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
  }

  getDiagnostics(): WorldDiagnostics {
    return {
      drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, activeEnemies: this.enemies.size, particles: this.effects.activeParticles,
      quality: this.quality, pixelRatio: this.renderer.getPixelRatio(), postprocessing: this.pipeline.enabled, renderMilliseconds: this.renderMilliseconds,
      shaderErrors: [...this.shaderErrors], postprocessingError: this.pipeline.loadError, assetError: this.assetError,
      targets: { drawCalls: 150, triangles: 200000, particleLimit: 400, textureMiB: 128 },
    };
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.assetRequest++;
    for (const unsubscribe of this.unsubscribers) unsubscribe(); this.unsubscribers.length = 0;
    this.clearRunVisuals();
    for (const batch of [this.staticBatch, this.nodeBatch, this.dynamicBatch]) batch.dispose();
    this.effects.dispose(); this.pipeline.dispose();
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.beaconRingGeometry.dispose(); this.beaconRingMaterial.dispose(); this.beaconChannelGeometry.dispose(); this.beaconChannelMaterial.dispose(); this.beaconBeam.geometry.dispose(); this.beaconBeam.material.dispose(); this.aimGeometry.dispose(); this.aimMaterial.dispose();
    this.sun.shadow.map?.dispose(); this.geo.dispose(); disposeMaterials(this.mat);
    this.scene.clear(); this.renderer.dispose();
  }
}
