const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export type GlbInspection = { byteLength: number; triangles: number; materials: number; maxTextureSize: number };
export function inspectGlb(bytes: Uint8Array): GlbInspection {
  if (bytes.byteLength < 20 || bytes.byteLength > 15 * 1024 * 1024) throw new Error('GLB file size is outside the accepted budget.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new Error('Invalid GLB 2.0 header.');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > bytes.byteLength) throw new Error('GLB JSON chunk is invalid.');
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim());
  if (!isRecord(parsed) || !isRecord(parsed.asset) || parsed.asset.version !== '2.0') throw new Error('Invalid glTF asset declaration.');
  for (const name of ['buffers', 'images']) {
    const entries = parsed[name];
    if (Array.isArray(entries) && entries.some(item => !isRecord(item) || 'uri' in item)) throw new Error('Only self-contained GLB resources are accepted.');
  }
  if (Array.isArray(parsed.extensionsRequired) && parsed.extensionsRequired.length > 0) throw new Error('GLB requires an unsupported extension or decoder.');
  const accessors = Array.isArray(parsed.accessors) ? parsed.accessors : [];
  let triangles = 0;
  for (const mesh of Array.isArray(parsed.meshes) ? parsed.meshes : []) {
    if (!isRecord(mesh) || !Array.isArray(mesh.primitives)) throw new Error('Invalid mesh primitives.');
    for (const primitive of mesh.primitives) {
      if (!isRecord(primitive) || !isRecord(primitive.attributes)) throw new Error('Invalid mesh attributes.');
      const index = primitive.indices ?? primitive.attributes.POSITION;
      if (!numeric(index) || !Number.isInteger(index)) throw new Error('Invalid mesh accessor index.');
      const accessor: unknown = accessors[index];
      if (!isRecord(accessor) || !numeric(accessor.count) || !Number.isInteger(accessor.count)) throw new Error('Invalid accessor count.');
      const mode = primitive.mode ?? 4;
      if (mode !== 4) throw new Error('Only triangulated GLB meshes are accepted.');
      triangles += accessor.count / 3;
    }
  }
  const materials = Array.isArray(parsed.materials) ? parsed.materials.length : 0;
  if (triangles > 50000 || materials > 6) throw new Error('GLB geometry or material budget exceeded.');
  for (const node of Array.isArray(parsed.nodes) ? parsed.nodes : []) {
    if (!isRecord(node)) throw new Error('Invalid glTF node.');
    for (const key of ['matrix', 'translation', 'rotation', 'scale']) if (Array.isArray(node[key]) && node[key].some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Non-finite glTF transform.');
  }
  if (Array.isArray(parsed.images) && parsed.images.length > 0) throw new Error('Texture decoding and dimensions require a reviewed asset validator before textured remote assets can be enabled.');
  return { byteLength: bytes.byteLength, triangles: Math.ceil(triangles), materials, maxTextureSize: 0 };
}
