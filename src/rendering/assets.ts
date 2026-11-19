import { Box3, Group, Mesh, Texture, Vector3, type BufferGeometry, type Material } from 'three';
import type { ValidatedAsset } from '../types/game';

type GlbAsset = Extract<ValidatedAsset, { kind: 'glb' }>;

/** Only explicit validated descriptors trigger a load; no guessed manifest paths or providers. */
export async function loadRelicAsset(asset: GlbAsset): Promise<Group> {
  const url = new URL(asset.url, window.location.href);
  if (!['https:', 'http:', 'blob:', 'data:'].includes(url.protocol)) throw new Error('Unsupported validated asset URL protocol.');
  if (asset.byteLength > 15 * 1024 * 1024 || asset.triangles > 50000 || asset.materials > 6 || asset.maxTextureSize > 2048) throw new Error('Generated asset exceeds the graphics budget.');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url.href);
  const root = new Group(); root.add(gltf.scene);
  try {
    let triangles = 0;
    const materials = new Set<Material>();
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      triangles += object.geometry.index ? object.geometry.index.count / 3 : object.geometry.getAttribute('position').count / 3;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      object.castShadow = object.receiveShadow = true;
    });
    if (triangles > 50000 || materials.size > 6) throw new Error('Loaded geometry exceeds the validated asset budget.');
    // Optional glTF extras. The service descriptor stays frozen; extras affect display only.
    const facing: unknown = gltf.scene.userData.forward;
    const yaw: unknown = gltf.scene.userData.facingRadians;
    root.rotation.y = typeof yaw === 'number' && Number.isFinite(yaw) ? yaw : facing === '-z' ? Math.PI : facing === '+x' ? -Math.PI / 2 : facing === '-x' ? Math.PI / 2 : 0;
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root), size = box.getSize(new Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.0001) throw new Error('Generated asset has no usable display bounds.');
    const scale = 2.2 / Math.max(size.x, size.y, size.z);
    const center = box.getCenter(new Vector3());
    // A wrapper offset avoids overwriting GLB articulation/pivots.
    const normalized = new Group(); normalized.add(root); root.scale.setScalar(scale);
    root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    normalized.userData.generatedAsset = asset.assetId;
    return normalized;
  } catch (error) { disposeGenerated(root); throw error; }
}

export function disposeGenerated(root: Group): void {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.clear();
}
