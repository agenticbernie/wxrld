import { Color, DataTexture, MeshStandardMaterial, MeshPhysicalMaterial, RGBAFormat, RepeatWrapping, Vector3, type IUniform, type Material, type Texture } from 'three';
import { ISLAND_SIZE, WATER_LEVEL } from '../world/terrain';

export type Palette = ReturnType<typeof createMaterials>;
export type ShaderTime = { time: IUniform<number>; motion: IUniform<number>; daylight: IUniform<number>; rim: IUniform<number> };
export function createShaderTime(): ShaderTime {
  return { time: { value: 0 }, motion: { value: 1 }, daylight: { value: 1 }, rim: { value: 1 } };
}

function surfaceTexture(): DataTexture {
  const data = new Uint8Array(64 * 64 * 4);
  let seed = 93421;
  for (let i = 0; i < 64 * 64; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const v = 223 + (seed >>> 27);
    data.set([v, v, v, 255], i * 4);
  }
  const texture = new DataTexture(data, 64, 64, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.needsUpdate = true;
  // This is a roughness/bump data texture, deliberately not tagged sRGB.
  return texture;
}

function decorate(material: MeshStandardMaterial, uniforms: ShaderTime, wind: boolean, rim: boolean): MeshStandardMaterial {
  material.onBeforeCompile = shader => {
    shader.uniforms.uWorldTime = uniforms.time;
    shader.uniforms.uMotion = uniforms.motion;
    shader.uniforms.uRim = uniforms.rim;
    shader.vertexShader = `uniform float uWorldTime; uniform float uMotion;\n${shader.vertexShader}`;
    if (wind) {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 anchor = vec3(0.0);
        #ifdef USE_INSTANCING
          anchor = instanceMatrix[3].xyz;
        #else
          anchor = modelMatrix[3].xyz;
        #endif
        float tip = smoothstep(-0.35, 0.7, position.y);
        transformed.x += sin(uWorldTime * 1.3 + anchor.x * 0.18 + anchor.z * 0.12) * 0.18 * tip * uMotion;
        transformed.z += sin(uWorldTime * 0.7 + anchor.z * 0.16) * 0.12 * tip * uMotion;
      `);
    }
    if (rim) {
      shader.fragmentShader = `uniform float uRim;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float edge = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
        outgoingLight += vec3(0.13, 0.23, 0.21) * edge * uRim;
        #include <opaque_fragment>
      `);
    }
  };
  material.customProgramCacheKey = () => `wxrld-pbr-r180-${wind ? 'wind' : 'still'}-${rim ? 'rim' : 'plain'}`;
  return material;
}

export function createMaterials(uniforms: ShaderTime) {
  const detail = surfaceTexture();
  const make = (color: string, roughness: number, metalness = 0, wind = false, rim = false): MeshStandardMaterial => {
    const mat = new MeshStandardMaterial({ color, roughness, metalness, roughnessMap: detail, bumpMap: detail, bumpScale: 0.035 });
    return decorate(mat, uniforms, wind, rim);
  };
  const core = (color: string, intensity: number): MeshStandardMaterial => {
    const mat = make(color, 0.25, 0.25, false, true);
    mat.emissive.set(color); mat.emissiveIntensity = intensity; mat.userData.bloom = true;
    return mat;
  };
  return {
    bark: make('#514334', 0.85), barkLight: make('#736044', 0.87),
    leaf: make('#435b38', 0.75, 0, true), leafLight: make('#75824b', 0.79, 0, true),
    grass: make('#82925e', 0.92, 0, true), rock: make('#687271', 0.9), darkRock: make('#353e43', 0.94),
    sand: make('#b6a37d', 0.88), gold: make('#c4a36c', 0.3, 0.78), silver: make('#9bb6b6', 0.4, 0.7, false, true),
    leather: make('#615444', 0.75), cloth: make('#4c6667', 0.86), redCloth: make('#723a43', 0.83),
    armor: make('#8a9992', 0.45, 0.55, false, true), skin: make('#aa9375', 0.83), goblin: make('#6c7960', 0.88),
    bone: make('#c3b693', 0.76), crystal: core('#dc5479', 1.65), cyan: core('#69c9bd', 1.8), ember: core('#f4b975', 1.65),
    terrain: new MeshStandardMaterial({ vertexColors: true, roughness: 0.98, roughnessMap: detail, bumpMap: detail, bumpScale: 0.13 }),
    detail,
  };
}

export function createWater(heightTexture: Texture, uniforms: ShaderTime): MeshPhysicalMaterial {
  const water = new MeshPhysicalMaterial({ color: '#345c60', roughness: 0.32, metalness: 0.18, transparent: true, opacity: 0.94, depthWrite: false, clearcoat: 0.45, clearcoatRoughness: 0.3 });
  water.onBeforeCompile = shader => {
    shader.uniforms.uWorldTime = uniforms.time; shader.uniforms.uMotion = uniforms.motion;
    shader.uniforms.uDaylight = uniforms.daylight;
    shader.uniforms.uHeight = { value: heightTexture };
    shader.vertexShader = `uniform float uWorldTime; uniform float uMotion; varying vec3 vWaterWorld;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.z += (sin(position.x * 0.18 + uWorldTime * 0.5) + cos(position.y * 0.13 - uWorldTime * 0.35)) * 0.07 * uMotion;
    `).replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `);
    shader.fragmentShader = `uniform float uWorldTime; uniform float uDaylight; uniform sampler2D uHeight; varying vec3 vWaterWorld;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 shoreUV = vWaterWorld.xz / ${ISLAND_SIZE.toFixed(1)} + 0.5;
      float h = texture2D(uHeight, clamp(shoreUV, 0.0, 1.0)).r;
      float insideMap = step(0.0, shoreUV.x) * step(shoreUV.x, 1.0) * step(0.0, shoreUV.y) * step(shoreUV.y, 1.0);
      float ripples = sin(vWaterWorld.x * 0.72 + vWaterWorld.z * 0.61 + uWorldTime * 0.65) * sin(vWaterWorld.z * 0.51 - uWorldTime * 0.42);
      float foam = (1.0 - smoothstep(0.1, 1.5, abs(h - ${WATER_LEVEL}))) * insideMap;
      foam *= smoothstep(-0.65, 0.7, ripples) * 0.65;
      float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
      vec3 shallow = mix(vec3(0.06, 0.09, 0.14), vec3(0.12, 0.29, 0.29), uDaylight);
      vec3 horizon = mix(vec3(0.22, 0.095, 0.15), vec3(0.42, 0.48, 0.43), uDaylight);
      diffuseColor.rgb = mix(shallow, horizon, fresnel * 0.7) + ripples * 0.015;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.79, 0.68), foam);
    `);
  };
  water.customProgramCacheKey = () => 'wxrld-water-shore-r180';
  return water;
}

export function disposeMaterials(palette: Palette): void {
  for (const value of Object.values(palette)) value.dispose();
}
export function markBloom<T extends Material>(material: T): T { material.userData.bloom = true; return material; }
export const WHITE_INSTANCE = new Color(1, 1, 1);
export const FLASH_INSTANCE = new Color(2.4, 1.25, 1.1);
export const UP = new Vector3(0, 1, 0);
