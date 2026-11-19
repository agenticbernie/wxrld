import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, RingGeometry, Vector3, type Texture } from 'three';
import type { GameEventMap, Vec3 } from '../types/game';
import { Rng } from '../core/rng';

const PARTICLE_LIMIT = 400;
const TRAIL_LIMIT = 8;
const TRAIL_SEGMENTS = 24;
const TELL_LIMIT = 32;
type Particle = { position: Vector3; velocity: Vector3; life: number; duration: number; size: number; color: Color; gravity: number };
type Ribbon = { mesh: Mesh<BufferGeometry, MeshBasicMaterial>; life: number; duration: number };
type TransientRing = { position: Vec3; radius: number; life: number; duration: number; color: Color };
export type Tell = { position: Vec3; radius: number; progress: number; color: Color; pattern: 'slam' | 'ranged' | 'roots' };
const tempMatrix = new Matrix4(), tempScale = new Vector3(), tempQuat = new Quaternion();
const warm = new Color('#f4ba79'), crimson = new Color('#ef5f83'), cool = new Color('#8ae5d6');

/** Fixed-capacity transient buffers. No gameplay state or gameplay clocks live here. */
export class Effects {
  readonly group = new Group();
  private readonly particles: Particle[] = Array.from({ length: PARTICLE_LIMIT }, () => ({ position: new Vector3(), velocity: new Vector3(), life: 0, duration: 1, size: 0, color: new Color(), gravity: 0 }));
  private readonly particleGeometry = new PlaneGeometry(1, 1);
  private readonly particleMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
  private readonly particleMesh = new InstancedMesh(this.particleGeometry, this.particleMaterial, PARTICLE_LIMIT);
  private readonly ringGeometry = new RingGeometry(0.965, 1, 48);
  private readonly ringMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide, toneMapped: false });
  private readonly ringMesh = new InstancedMesh(this.ringGeometry, this.ringMaterial, TELL_LIMIT);
  private readonly tickGeometry: BufferGeometry;
  private readonly tickMaterial = this.ringMaterial.clone();
  private readonly tellPatterns = new InstancedBufferAttribute(new Float32Array(TELL_LIMIT), 1);
  private readonly terrainUniform: { value: Texture | null } = { value: null };
  private readonly terrainSize = { value: 180 };
  private readonly tickMesh: InstancedMesh<BufferGeometry, MeshBasicMaterial>;
  private readonly ribbons: Ribbon[] = [];
  private readonly rings: TransientRing[] = [];
  private readonly rng = new Rng(834763);
  private nextParticle = 0;
  private tells: readonly Tell[] = [];
  private motion = 1;

  constructor() {
    this.particleMaterial.userData.bloom = true;
    this.particleMesh.frustumCulled = false; this.particleMesh.count = 0; this.particleMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.ringMesh.frustumCulled = false; this.ringMesh.count = 0; this.ringMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const pos: number[] = [], tickIndices: number[] = [];
    for (let j = 0; j < 8; j++) {
      const a = j * Math.PI / 4;
      for (const [r, offset] of [[0.9, -0.055], [0.9, 0.055], [0.73, 0]] as const) { pos.push(Math.cos(a + offset) * r, Math.sin(a + offset) * r, 0); tickIndices.push(j); }
    }
    this.tickGeometry = new BufferGeometry(); this.tickGeometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    this.tickGeometry.setAttribute('aTickIndex', new BufferAttribute(new Float32Array(tickIndices), 1));
    this.tickGeometry.setAttribute('aTellPattern', this.tellPatterns);
    this.configureGroundShader(this.ringMaterial, false); this.configureGroundShader(this.tickMaterial, true);
    this.tickMesh = new InstancedMesh(this.tickGeometry, this.tickMaterial, TELL_LIMIT); this.tickMesh.frustumCulled = false; this.tickMesh.count = 0;
    this.group.add(this.particleMesh, this.ringMesh, this.tickMesh);
    for (let i = 0; i < TRAIL_LIMIT; i++) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array((TRAIL_SEGMENTS + 1) * 2 * 3), 3));
      const indices: number[] = [];
      for (let j = 0; j < TRAIL_SEGMENTS; j++) { const a = j * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geometry.setIndex(indices);
      const material = new MeshBasicMaterial({ color: warm, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false });
      material.userData.bloom = true;
      const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; mesh.visible = false;
      this.group.add(mesh); this.ribbons.push({ mesh, life: 0, duration: 0.25 });
    }
  }
  private configureGroundShader(material: MeshBasicMaterial, ticks: boolean): void {
    material.onBeforeCompile = shader => {
      shader.uniforms.uTerrainHeight = this.terrainUniform; shader.uniforms.uTerrainSize = this.terrainSize;
      shader.vertexShader = `uniform sampler2D uTerrainHeight; uniform float uTerrainSize; ${ticks ? 'attribute float aTickIndex; attribute float aTellPattern;' : ''}\n${shader.vertexShader}`;
      if (ticks) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        bool odd = mod(aTickIndex, 2.0) > 0.5;
        if ((aTellPattern < 0.5 && odd) || (aTellPattern > 0.5 && aTellPattern < 1.5 && !odd)) transformed = vec3(0.0);
        if (aTellPattern > 1.5 && length(position.xy) < 0.8) transformed.xy *= 0.6;
      `);
      // Verified against Three r180 project_vertex. Project decals onto the authoritative height texture.
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 worldGround = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          worldGround = instanceMatrix * worldGround;
        #endif
        worldGround = modelMatrix * worldGround;
        vec2 groundUv = worldGround.xz / uTerrainSize + 0.5;
        worldGround.y = texture2D(uTerrainHeight, clamp(groundUv, 0.0, 1.0)).r + 0.10;
        vec4 mvPosition = viewMatrix * worldGround;
        gl_Position = projectionMatrix * mvPosition;
      `);
    };
    material.customProgramCacheKey = () => `wxrld-ground-decal-r180-${ticks ? 'shape' : 'ring'}`;
  }
  setTerrain(texture: Texture, size: number): void { this.terrainUniform.value = texture; this.terrainSize.value = size; }
  setReducedMotion(reduced: boolean): void { this.motion = reduced ? 0.22 : 1; }
  setTells(tells: readonly Tell[]): void { this.tells = tells; }
  ring(position: Vec3, radius: number, color = crimson, duration = 0.7): void {
    if (this.rings.length >= 10) this.rings.shift();
    this.rings.push({ position: { ...position }, radius, life: duration, duration, color });
  }
  burst(position: Vec3, color: Color, count: number, intensity = 1, gravity = 5): void {
    for (let j = 0; j < Math.ceil(count * this.motion); j++) {
      const p = this.particles[this.nextParticle++ % PARTICLE_LIMIT]; if (!p) continue;
      const a = this.rng.next() * Math.PI * 2, speed = (0.7 + this.rng.next() * 2.8) * intensity;
      p.position.set(position.x, position.y + 0.8, position.z);
      p.velocity.set(Math.cos(a) * speed, 1 + this.rng.next() * speed, Math.sin(a) * speed);
      p.duration = p.life = 0.25 + this.rng.next() * 0.5;
      p.size = 0.06 + this.rng.next() * 0.09; p.color.copy(color); p.gravity = gravity;
    }
  }
  request(fx: GameEventMap['fx:requested']): void {
    switch (fx.kind) {
      case 'slash': this.ribbon(fx.position, fx.direction, 'arc', warm); break;
      case 'arrow': this.burst(fx.position, warm, 4, 0.35, 0); break;
      case 'magic': this.burst(fx.position, cool, 16, 0.8, 0); this.ring(fx.position, 1, cool, 0.3); break;
      case 'lightning': this.ribbon(fx.position, fx.direction, 'bolt', cool); this.burst(fx.position, cool, 15); break;
      case 'dash': this.ribbon(fx.position, fx.direction, 'dash', cool); this.burst(fx.position, cool, 8, 0.4, 0); break;
      case 'meteor': this.ring(fx.position, 3, warm, 0.55); this.burst(fx.position, warm, 55, 2); break;
      case 'frost': this.ring(fx.position, 3, cool, 0.65); this.burst(fx.position, cool, 35, 0.8, -0.4); break;
      case 'death': this.burst(fx.position, crimson, 35, 1.5); break;
      case 'crit': this.burst(fx.position, warm, 25, 1.4); break;
      case 'hit': this.burst(fx.position, warm, 12, fx.intensity); break;
    }
  }
  private ribbon(position: Vec3, direction: Vec3 | null, kind: 'arc' | 'bolt' | 'dash', color: Color): void {
    const ribbon = this.ribbons.find(r => r.life <= 0) ?? this.ribbons[0]; if (!ribbon) return;
    const attr = ribbon.mesh.geometry.getAttribute('position');
    const angle = Math.atan2(direction?.x ?? 0, direction?.z ?? 1);
    for (let j = 0; j <= TRAIL_SEGMENTS; j++) {
      const t = j / TRAIL_SEGMENTS, a = angle + (t - 0.5) * 2.8;
      const r = 1.5 + t * 0.8;
      const width = Math.sin(t * Math.PI) * 0.22 * this.motion + 0.02;
      let x: number, y: number, z: number;
      if (kind === 'arc') { x = position.x + Math.sin(a) * r; y = position.y + 1.0 + Math.sin(t * Math.PI) * 0.3; z = position.z + Math.cos(a) * r; }
      else {
        const length = kind === 'dash' ? 3.2 : 6;
        const jitter = kind === 'bolt' ? Math.sin(j * 8.7) * 0.22 : 0;
        x = position.x + Math.sin(angle) * length * t + Math.cos(angle) * jitter;
        z = position.z + Math.cos(angle) * length * t - Math.sin(angle) * jitter;
        y = position.y + 0.8 + jitter;
      }
      attr.setXYZ(j * 2, x, y - width, z); attr.setXYZ(j * 2 + 1, x, y + width, z);
    }
    attr.needsUpdate = true; ribbon.mesh.material.color.copy(color); ribbon.duration = ribbon.life = kind === 'bolt' ? 0.18 : 0.26;
    ribbon.mesh.visible = true;
  }
  update(dt: number, cameraRotation: Quaternion): void {
    let count = 0;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt; p.velocity.y -= p.gravity * dt; p.position.addScaledVector(p.velocity, dt);
      const fade = Math.max(0, p.life / p.duration);
      tempScale.setScalar(p.size * Math.sqrt(fade)); tempMatrix.compose(p.position, cameraRotation, tempScale);
      this.particleMesh.setMatrixAt(count, tempMatrix); this.particleMesh.setColorAt(count, p.color); count++;
    }
    this.particleMesh.count = count; this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    for (const r of this.ribbons) { r.life = Math.max(0, r.life - dt); r.mesh.visible = r.life > 0; r.mesh.material.opacity = 0.68 * r.life / r.duration; }
    for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; if (r) { r.life -= dt; if (r.life <= 0) this.rings.splice(i, 1); } }
    tempQuat.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    let ringCount = 0;
    const writeRing = (p: Vec3, radius: number, color: Color, fill: number, pattern: Tell['pattern']): void => {
      if (ringCount >= TELL_LIMIT) return;
      tempMatrix.compose(new Vector3(p.x, p.y + 0.08, p.z), tempQuat, new Vector3(radius, radius, 1));
      this.ringMesh.setMatrixAt(ringCount, tempMatrix); this.ringMesh.setColorAt(ringCount, color);
      tempMatrix.compose(new Vector3(p.x, p.y + 0.09, p.z), tempQuat, new Vector3(radius * (0.55 + fill * 0.45), radius * (0.55 + fill * 0.45), 1));
      this.tickMesh.setMatrixAt(ringCount, tempMatrix); this.tickMesh.setColorAt(ringCount, color);
      this.tellPatterns.setX(ringCount, pattern === 'slam' ? 0 : pattern === 'ranged' ? 1 : 2); ringCount++;
    };
    for (const tell of this.tells) writeRing(tell.position, tell.radius, tell.color, tell.progress, tell.pattern);
    for (const ring of this.rings) writeRing(ring.position, ring.radius * (1 + (1 - ring.life / ring.duration) * 0.15), ring.color, ring.life / ring.duration, 'ranged');
    this.tellPatterns.needsUpdate = true;
    this.ringMesh.count = this.tickMesh.count = ringCount;
    this.ringMesh.instanceMatrix.needsUpdate = this.tickMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
    if (this.tickMesh.instanceColor) this.tickMesh.instanceColor.needsUpdate = true;
  }
  clear(): void { for (const p of this.particles) p.life = 0; for (const r of this.ribbons) { r.life = 0; r.mesh.visible = false; } this.rings.length = 0; this.tells = []; this.particleMesh.count = this.ringMesh.count = this.tickMesh.count = 0; }
  get activeParticles(): number { return this.particleMesh.count; }
  dispose(): void {
    this.clear(); this.particleMesh.dispose(); this.ringMesh.dispose(); this.tickMesh.dispose();
    this.particleGeometry.dispose(); this.particleMaterial.dispose(); this.ringGeometry.dispose(); this.tickGeometry.dispose(); this.ringMaterial.dispose(); this.tickMaterial.dispose();
    for (const r of this.ribbons) { r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
    this.group.clear();
  }
}
