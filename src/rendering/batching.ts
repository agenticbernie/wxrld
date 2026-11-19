import { Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';
import { WHITE_INSTANCE } from './materials';

export type BatchHandle = { root: Group; tint: Color };
type Bucket = { mesh: InstancedMesh<BufferGeometry, MeshStandardMaterial>; entries: { source: Mesh; handle: BatchHandle }[]; capacity: number };
const hiddenMatrix = new Matrix4().makeScale(0, 0, 0);
function isVisible(object: Mesh, root: Group): boolean {
  let current = object.parent;
  if (!object.visible || !root.visible) return false;
  while (current && current !== root) { if (!current.visible) return false; current = current.parent; }
  return true;
}

/** Art stays hierarchical; only the render representation is flattened into per-part instances. */
export class PartBatch {
  readonly group = new Group();
  private buckets = new Map<string, Bucket>();
  private handles = new Set<BatchHandle>();
  private dirty = true;
  constructor(private readonly dynamic: boolean, private readonly initialCapacity = 128) {}

  add(root: Group): BatchHandle {
    const handle = { root, tint: WHITE_INSTANCE.clone() };
    this.handles.add(handle);
    root.traverse(source => {
      if (!(source instanceof Mesh) || !(source.material instanceof MeshStandardMaterial)) return;
      const key = `${source.geometry.uuid}:${source.material.uuid}`;
      let bucket = this.buckets.get(key);
      if (!bucket) {
        const capacity = this.initialCapacity;
        const mesh = new InstancedMesh(source.geometry, source.material, capacity);
        mesh.count = 0; mesh.frustumCulled = false;
        mesh.castShadow = source.castShadow; mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        this.group.add(mesh);
        bucket = { mesh, entries: [], capacity }; this.buckets.set(key, bucket);
      }
      bucket.entries.push({ source, handle });
      if (bucket.entries.length > bucket.capacity) this.grow(bucket);
    });
    this.dirty = true; return handle;
  }
  private grow(bucket: Bucket): void {
    const old = bucket.mesh;
    bucket.capacity *= 2;
    const next = new InstancedMesh(old.geometry, old.material, bucket.capacity);
    next.count = 0; next.frustumCulled = false; next.castShadow = old.castShadow; next.receiveShadow = old.receiveShadow;
    next.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.remove(old); old.dispose(); this.group.add(next); bucket.mesh = next;
  }
  remove(handle: BatchHandle): void {
    this.handles.delete(handle);
    for (const bucket of this.buckets.values()) bucket.entries = bucket.entries.filter(e => e.handle !== handle);
    this.dirty = true;
  }
  invalidate(): void { this.dirty = true; }
  update(): void {
    if (!this.dynamic && !this.dirty) return;
    for (const handle of this.handles) handle.root.updateMatrixWorld(true);
    for (const bucket of this.buckets.values()) {
      let index = 0;
      for (const entry of bucket.entries) {
        if (!isVisible(entry.source, entry.handle.root)) continue;
        bucket.mesh.setMatrixAt(index, entry.source.matrixWorld);
        bucket.mesh.setColorAt(index, entry.handle.tint);
        index++;
      }
      bucket.mesh.count = index;
      if (index === 0) bucket.mesh.setMatrixAt(0, hiddenMatrix);
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
    }
    this.dirty = false;
  }
  setShadows(enabled: boolean): void { for (const bucket of this.buckets.values()) bucket.mesh.castShadow = enabled; }
  get batchCount(): number { return this.buckets.size; }
  dispose(): void {
    for (const bucket of this.buckets.values()) { this.group.remove(bucket.mesh); bucket.mesh.dispose(); }
    this.buckets.clear(); this.handles.clear();
  }
}
