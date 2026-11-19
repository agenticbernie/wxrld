import { Color, Mesh, MeshBasicMaterial, Vector2, type Camera, type Material, type Scene, type WebGLRenderer } from 'three';
import type { Quality } from '../types/game';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Lazy postprocessing; the scene can render immediately before this optional chunk arrives. */
export class RenderPipeline {
  private composer: EffectComposer | null = null;
  private bloomComposer: EffectComposer | null = null;
  private treatment: ShaderPass | null = null;
  private readonly black = new MeshBasicMaterial({ color: 0x000000 });
  private readonly blackBackground = new Color(0x000000);
  private disposed = false;
  private width = 1;
  private height = 1;
  private quality: Quality;
  private loading: Promise<void> | null = null;
  private error: string | null = null;

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, private readonly camera: Camera, quality: Quality) {
    this.quality = quality;
    if (quality !== 'low') this.load();
  }
  private load(): void {
    if (this.loading || this.disposed) return;
    this.loading = this.initialize().catch(error => { this.error = error instanceof Error ? error.message : 'Postprocessing could not load'; });
  }
  private async initialize(): Promise<void> {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/ShaderPass.js'), import('three/addons/postprocessing/OutputPass.js'),
    ]);
    if (this.disposed) return;
    const bloomComposer = new EffectComposer(this.renderer); bloomComposer.renderToScreen = false;
    bloomComposer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new Vector2(this.width / 2, this.height / 2), 0.35, 0.35, 1);
    bloomComposer.addPass(bloom);
    const composer = new EffectComposer(this.renderer); composer.addPass(new RenderPass(this.scene, this.camera));
    const treatment = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uBloom: { value: bloomComposer.renderTarget2.texture }, uDanger: { value: 0 }, uTime: { value: 0 }, uMotion: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D uBloom; uniform float uDanger; uniform float uTime; uniform float uMotion; varying vec2 vUv;
        void main(){
          vec3 color=texture2D(tDiffuse,vUv).rgb + texture2D(uBloom,vUv).rgb;
          vec2 p=vUv*2.0-1.0; float vignette=smoothstep(0.28,1.55,dot(p,p));
          float heartbeat=(0.92+0.08*sin(uTime*5.8)*uMotion)*uDanger;
          color*=1.0-vignette*(0.13+heartbeat*0.23);
          color+=vec3(0.1,0.0,0.012)*vignette*heartbeat;
          gl_FragColor=vec4(color,1.0);
        }`,
    });
    composer.addPass(treatment); composer.addPass(new OutputPass());
    this.bloomComposer = bloomComposer; this.composer = composer; this.treatment = treatment;
    this.resize(this.width, this.height);
  }
  setQuality(quality: Quality): void { this.quality = quality; if (quality !== 'low') this.load(); this.resize(this.width, this.height); }
  resize(width: number, height: number): void {
    this.width = width; this.height = height;
    // Bound half-float/depth render targets independently of the presentation canvas DPR.
    const scale = Math.min(1, Math.sqrt(2600000 / Math.max(1, width * height)));
    const renderWidth = Math.max(1, Math.round(width * scale)), renderHeight = Math.max(1, Math.round(height * scale));
    this.composer?.setPixelRatio(1); this.composer?.setSize(renderWidth, renderHeight);
    this.bloomComposer?.setPixelRatio(1); this.bloomComposer?.setSize(Math.max(1, renderWidth / 2), Math.max(1, renderHeight / 2));
  }
  render(dt: number, danger: number, clock: number, reducedMotion: boolean): void {
    if (this.quality === 'low' || !this.composer || !this.bloomComposer || !this.treatment) { this.renderer.render(this.scene, this.camera); return; }
    const restored: { mesh: Mesh; material: Material | Material[]; visible: boolean }[] = [];
    const background = this.scene.background;
    const shadowAutoUpdate = this.renderer.shadowMap.autoUpdate, shadowNeedsUpdate = this.renderer.shadowMap.needsUpdate;
    try {
      // Emissive isolation does not need a second shadow render; base pass updates the one map.
      this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = false;
      this.scene.background = this.blackBackground;
      this.scene.traverse(object => {
        if (!(object instanceof Mesh) || !object.visible) return;
        const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(material => material.userData.bloom === true)) return;
        restored.push({ mesh: object, material: object.material, visible: object.visible });
        if (materials.some(material => material.transparent || material.depthWrite === false)) object.visible = false;
        else object.material = this.black;
      });
      this.bloomComposer.render(dt);
    } finally {
      this.scene.background = background;
      this.renderer.shadowMap.autoUpdate = shadowAutoUpdate; this.renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
      for (const saved of restored) { saved.mesh.material = saved.material; saved.mesh.visible = saved.visible; }
    }
    this.treatment.uniforms.uBloom!.value = this.bloomComposer.renderTarget2.texture;
    this.treatment.uniforms.uDanger!.value = danger;
    this.treatment.uniforms.uTime!.value = clock;
    this.treatment.uniforms.uMotion!.value = reducedMotion ? 0 : 1;
    this.composer.render(dt);
  }
  get enabled(): boolean { return this.quality !== 'low' && this.composer !== null; }
  get loadError(): string | null { return this.error; }
  dispose(): void {
    this.disposed = true;
    this.black.dispose();
    for (const pass of this.composer?.passes ?? []) pass.dispose();
    for (const pass of this.bloomComposer?.passes ?? []) pass.dispose();
    this.composer?.dispose(); this.bloomComposer?.dispose(); this.treatment = null;
  }
}
