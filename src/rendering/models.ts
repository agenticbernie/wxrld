import { DoubleSide, Group, Mesh, Vector3, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { Rng } from '../core/rng';
import type { ActorArchetype, RelicRecipeId, ResourceKind, Tier } from '../types/game';
import { GeometryLibrary, POINT_UP } from './geometry';
import type { Palette } from './materials';

export type ModelKit = { geo: GeometryLibrary; mat: Palette };
export type Rig = { root: Group; torso: Group; head: Group; leftArm: Group; rightArm: Group; leftLeg: Group; rightLeg: Group; weapon: Group; bow: Group | null; cape: Group; wings: Group[]; archetype: ActorArchetype | 'player'; scale: number };
export type ResourceModel = { root: Group; stages: Group[]; kind: ResourceKind };
type Triple = readonly [number, number, number];

export function part(parent: Group, geometry: BufferGeometry, material: MeshStandardMaterial, position: Triple, scale: Triple, rotation?: Triple): Mesh {
  const mesh = new Mesh(geometry, material); mesh.position.set(...position); mesh.scale.set(...scale);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function branch(parent: Group, kit: ModelKit, a: Triple, b: Triple, width: number, material = kit.mat.bark): Mesh {
  const av = new Vector3(...a), bv = new Vector3(...b), delta = bv.sub(av);
  const mesh = part(parent, kit.geo.branch, material, a, [width, delta.length(), width]);
  mesh.quaternion.setFromUnitVectors(POINT_UP, delta.normalize()); return mesh;
}
function pivot(parent: Group, position: Triple): Group { const g = new Group(); g.position.set(...position); parent.add(g); return g; }

export function tree(kit: ModelKit, seed: number, ancient = false): ResourceModel {
  const rng = new Rng(seed), root = new Group(), stages: Group[] = [];
  const height = ancient ? 16 : 5.5 + rng.next() * 3.5, width = ancient ? 2.1 : 0.65 + rng.next() * 0.35;
  const bend = (rng.next() - 0.5) * height * 0.16;
  const base = pivot(root, [0, 0, 0]); stages.push(base);
  branch(base, kit, [0, 0, 0], [bend * 0.3, height * 0.35, 0.16], width);
  branch(base, kit, [bend * 0.3, height * 0.35, 0.16], [bend, height * 0.7, -0.2], width * 0.7, kit.mat.barkLight);
  branch(base, kit, [bend, height * 0.7, -0.2], [bend * 0.8, height, 0], width * 0.4);
  for (let j = 0; j < 5; j++) {
    const a = j * Math.PI * 0.4 + rng.next() * 0.4;
    branch(base, kit, [Math.cos(a) * width * 2.3, 0.03, Math.sin(a) * width * 2.3], [0, width * 1.7, 0], width * 0.55);
    // Irregular knots protrude from the trunk rather than a smooth pole silhouette.
    if (j < 2) part(base, kit.geo.rock, kit.mat.bark, [width * 0.5, height * (0.2 + j * 0.2), 0], [width * 0.8, width * 0.7, width * 0.8]);
  }
  for (let tier = 0; tier < 3; tier++) {
    const crown = pivot(root, [0, 0, 0]); stages.push(crown);
    for (let j = 0; j < 2; j++) {
      const a = j * Math.PI + tier * 2.1 + rng.next(), r = (ancient ? 3.8 : 1.7) * (1 - tier * 0.16);
      const x = bend + Math.cos(a) * r * 0.6, z = Math.sin(a) * r * 0.6, y = height * (0.65 + tier * 0.11);
      branch(crown, kit, [bend * 0.6, y - 1.1, 0], [x, y, z], width * 0.28);
      part(crown, kit.geo.crown, j % 2 ? kit.mat.leafLight : kit.mat.leaf, [x, y, z], [r * 1.8, r * 1.25, r * 1.5], [0.05, a, 0.1]);
      if (ancient) branch(crown, kit, [x, y - 0.4, z], [x - 0.4, y - 4, z + 0.2], 0.045, kit.mat.leaf);
    }
  }
  return { root, stages, kind: 'tree' };
}

export function resource(kit: ModelKit, kind: ResourceKind, seed: number): ResourceModel {
  if (kind === 'tree') return tree(kit, seed);
  const rng = new Rng(seed), root = new Group(), stages: Group[] = [];
  const material = kind === 'cursed' ? kit.mat.darkRock : kit.mat.rock;
  for (let layer = 0; layer < 4; layer++) {
    const group = pivot(root, [0, 0, 0]); stages.push(group);
    for (let j = 0; j < (layer === 0 ? 3 : 2); j++) {
      const a = j * 2.6 + layer * 1.6, r = layer === 0 ? 0.5 : 0.65;
      const s = 0.6 + rng.next() * 0.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 0.25 + layer * 0.2;
      part(group, kit.geo.rock, material, [x, y, z], [s * 1.2, s * 0.75, s], [rng.next(), a, rng.next() * 0.4]);
      if (kind === 'gold') {
        part(group, kit.geo.slab, kit.mat.gold, [x + 0.15, y + s * 0.3, z - 0.2], [0.07, 0.26 + rng.next() * 0.2, 0.35], [0.3, a, 0.6]);
      } else if (kind === 'cursed') {
        part(group, kit.geo.shard, kit.mat.crystal, [x, y, z], [0.7, 1.2 + rng.next() * 1.4, 0.65], [(rng.next() - 0.5) * 0.45, a, (rng.next() - 0.5) * 0.5]);
      }
    }
  }
  if (kind === 'cursed') part(stages[0] ?? root, kit.geo.rock, kit.mat.crystal, [0, 0.5, 0], [0.7, 0.7, 0.7]);
  return { root, stages, kind };
}

function limb(parent: Group, kit: ModelKit, position: Triple, length: number, width: number, material: MeshStandardMaterial, leg: boolean): Group {
  const group = pivot(parent, position);
  part(group, kit.geo.branch, material, [0, 0, 0], [width, length * 0.56, width], [0, 0, Math.PI]);
  part(group, kit.geo.joint, kit.mat.leather, [0, -length * 0.55, 0], [width * 0.8, width * 0.5, width * 0.8]);
  part(group, kit.geo.slab, leg ? kit.mat.leather : material, [0, -length * 0.82, 0.02], [width * 0.68, length * 0.38, width * 0.68], [0.08, 0, 0]);
  if (leg) part(group, kit.geo.slab, kit.mat.darkRock, [0, -length, 0.13], [width, 0.2, width * 1.6]);
  else part(group, kit.geo.rock, material, [0, -length, 0], [width * 0.8, width * 0.8, width * 0.8]);
  return group;
}

export function actor(kit: ModelKit, archetype: ActorArchetype | 'player'): Rig {
  const root = new Group(), torso = pivot(root, [0, 1.3, 0]), head = pivot(torso, [0, 0.63, 0]);
  const player = archetype === 'player', goblin = archetype === 'goblin-stalker', golem = archetype === 'stone-golem', hunter = archetype === 'relic-hunter', boss = archetype === 'rootbound-sovereign', wyvern = archetype === 'blood-wyvern';
  const bodyMat = goblin ? kit.mat.goblin : golem ? kit.mat.rock : boss ? kit.mat.bark : wyvern ? kit.mat.redCloth : kit.mat.armor;
  const chestWidth = golem ? 1.1 : boss ? 0.95 : goblin ? 0.55 : 0.66;
  part(torso, kit.geo.slab, bodyMat, [0, 0, 0], [chestWidth, 0.75, 0.44], [goblin ? 0.18 : 0, 0, 0]);
  part(torso, kit.geo.slab, kit.mat.leather, [0, -0.38, 0], [chestWidth * 0.8, 0.16, 0.46]);
  part(torso, kit.geo.slab, player ? kit.mat.gold : golem ? kit.mat.cyan : kit.mat.bone, [0, 0.1, 0.24], [0.12, 0.46, 0.07], [0, 0, -0.3]);
  part(head, kit.geo.rock, goblin ? kit.mat.goblin : player ? kit.mat.skin : bodyMat, [0, 0.03, 0], [0.45, 0.48, 0.4]);
  part(head, kit.geo.slab, player ? kit.mat.darkRock : kit.mat.bone, [0, 0.14, -0.07], [0.44, 0.18, 0.4], [0.1, 0, 0]);
  for (const s of [-1, 1]) {
    part(head, kit.geo.slab, goblin ? kit.mat.goblin : kit.mat.gold, [s * 0.16, -0.04, 0.23], [goblin ? 0.16 : 0.06, goblin ? 0.25 : 0.04, 0.06], [0, 0, s * 0.3]);
    if (goblin) part(head, kit.geo.shard, kit.mat.goblin, [s * 0.18, 0.13, 0], [0.6, 0.65, 0.5], [0, 0, -s * 1.15]);
  }
  const leftArm = limb(torso, kit, [-chestWidth * 0.66, 0.26, 0], 0.8, golem ? 0.45 : 0.22, bodyMat, false);
  const rightArm = limb(torso, kit, [chestWidth * 0.66, 0.26, 0], 0.8, golem ? 0.45 : 0.22, bodyMat, false);
  const leftLeg = limb(root, kit, [-0.21, 0.9, 0], 0.8, golem ? 0.42 : 0.24, bodyMat, true);
  const rightLeg = limb(root, kit, [0.21, 0.9, 0], 0.8, golem ? 0.42 : 0.24, bodyMat, true);
  const weapon = pivot(rightArm, [0, -0.76, 0.05]), cape = pivot(torso, [0, 0.22, -0.24]);
  let bow: Group | null = null;
  if (player) {
    bow = pivot(leftArm, [0, -0.72, 0.08]);
    for (let i = 0; i < 4; i++) {
      const a = -1.15 + i * 0.575, b = a + 0.575;
      branch(bow, kit, [Math.cos(a) * 0.3, Math.sin(a) * 0.65, 0], [Math.cos(b) * 0.3, Math.sin(b) * 0.65, 0], 0.065, kit.mat.barkLight);
    }
    branch(bow, kit, [0.12, -0.59, 0], [0.12, 0.59, 0], 0.009, kit.mat.bone);
    part(bow, kit.geo.slab, kit.mat.gold, [0.3, 0, 0], [0.08, 0.15, 0.08]);
    bow.visible = false;
  }
  if (!golem && !boss && !wyvern) {
    branch(weapon, kit, [0, -0.25, 0], [0, 0.65, 0], 0.11, kit.mat.bark);
    part(weapon, kit.geo.blade, hunter ? kit.mat.silver : player ? kit.mat.bone : kit.mat.rock, [0, 0.1, 0], [hunter ? 1.3 : 1, hunter ? 1.2 : 0.65, 1], [0, 0, goblin ? -0.18 : 0]);
    part(weapon, kit.geo.slab, kit.mat.gold, [0, 0.1, 0], [0.36, 0.08, 0.12]);
  }
  if (player || hunter) {
    for (const s of [-1, 1]) part(cape, kit.geo.slab, hunter ? kit.mat.redCloth : kit.mat.cloth, [s * 0.2, -0.48, -0.08], [0.38, 1.03, 0.07], [-0.13, 0, -s * 0.13]);
    part(torso, kit.geo.slab, kit.mat.armor, [-0.4, 0.34, 0], [0.4, 0.2, 0.6], [0.1, 0, -0.2]);
    part(torso, kit.geo.rock, kit.mat.leather, [0.35, -0.34, -0.03], [0.35, 0.34, 0.35]);
    // Back-mounted quiver with separate fletchings.
    branch(torso, kit, [-0.25, -0.2, -0.3], [-0.16, 0.55, -0.4], 0.25, kit.mat.leather);
    for (let i = 0; i < 3; i++) part(torso, kit.geo.shard, kit.mat.bone, [-0.2 + i * 0.05, 0.5, -0.4], [0.13, 0.24, 0.1], [0, 0, -0.12]);
  }
  if (golem) {
    for (const s of [-1, 1]) {
      part(torso, kit.geo.slab, kit.mat.darkRock, [s * 0.42, 0.33, 0], [0.63, 0.2, 0.68], [0, 0, s * 0.15]);
      part(torso, kit.geo.slab, kit.mat.rock, [s * 0.35, -0.14, 0.28], [0.52, 0.22, 0.15], [0, s * 0.1, s * 0.1]);
      part(s === -1 ? leftArm : rightArm, kit.geo.rock, kit.mat.darkRock, [0, -0.8, 0.05], [0.8, 0.8, 0.8]);
      part(head, kit.geo.slab, kit.mat.cyan, [s * 0.13, 0.02, 0.27], [0.065, 0.1, 0.05]);
    }
    part(torso, kit.geo.slab, kit.mat.cyan, [0, -0.03, 0.24], [0.04, 0.55, 0.035], [0, 0, 0.35]);
  }
  const wings: Group[] = [];
  if (wyvern) {
    torso.rotation.x = 0.55;
    part(head, kit.geo.slab, kit.mat.redCloth, [0, -0.08, 0.3], [0.4, 0.25, 0.75], [0.15, 0, 0]);
    for (const s of [-1, 1]) {
      const w = pivot(torso, [s * 0.26, 0.35, -0.04]); wings.push(w);
      // Mirror the geometry in a rig transform; DoubleSide preserves the membrane.
      w.scale.x = s; kit.mat.redCloth.side = DoubleSide;
      part(w, kit.geo.wing, kit.mat.redCloth, [0, 0, 0], [1, 1, 1]);
      branch(w, kit, [0, 0, 0], [1.5, 0.7, 0], 0.075, kit.mat.bone);
      for (const endpoint of [[2.8, 0.1, 0], [2.2, -0.4, 0.06], [0.8, -0.7, 0.03]] as const) branch(w, kit, [1.5, 0.7, 0], endpoint, 0.045, kit.mat.bone);
      part(head, kit.geo.shard, kit.mat.bone, [s * 0.19, 0.16, -0.05], [0.45, 0.7, 0.4], [-0.65, 0, -s * 0.25]);
    }
    for (let i = 0; i < 5; i++) branch(torso, kit, [0, -0.35 - i * 0.1, -0.2 - i * 0.4], [Math.sin(i) * 0.2, -0.4 - i * 0.13, -0.6 - i * 0.4], 0.18 - i * 0.025, kit.mat.redCloth);
  }
  if (boss) {
    part(torso, kit.geo.rock, kit.mat.crystal, [0, 0.12, 0.27], [0.5, 0.75, 0.35]);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        branch(torso, kit, [s * 0.45, -0.36 + i * 0.23, 0.2], [s * 0.14, -0.25 + i * 0.23, 0.4], 0.15);
        branch(head, kit, [s * 0.15, 0.2, 0], [s * (0.6 + i * 0.2), 0.85 + i * 0.34, -0.1], 0.17 - i * 0.035);
        branch(head, kit, [s * (0.45 + i * 0.2), 0.65 + i * 0.3, -0.1], [s * (0.7 + i * 0.2), 0.85 + i * 0.2, 0.2], 0.065);
        part(torso, kit.geo.rock, kit.mat.darkRock, [s * 0.4, i * 0.25 - 0.2, -0.1], [0.6, 0.5, 0.5]);
      }
      const arm = s === -1 ? leftArm : rightArm;
      for (let i = 0; i < 3; i++) branch(arm, kit, [s * 0.15, -0.7, 0], [s * 0.2 + (i - 1) * 0.14, -1.3, 0.2 + i * 0.06], 0.085);
      branch(s === -1 ? leftLeg : rightLeg, kit, [0, -0.65, 0], [s * 0.4, -0.83, 0.6], 0.25);
    }
  }
  const scale = boss ? 3.3 : golem ? 1.65 : wyvern ? 1.4 : goblin ? 0.85 : hunter ? 1.13 : 1;
  root.scale.setScalar(scale);
  return { root, torso, head, leftArm, rightArm, leftLeg, rightLeg, weapon, bow, cape, wings, archetype, scale };
}

export function poseRig(rig: Rig, clock: number, moving: boolean, mode: 'idle' | 'chase' | 'windup' | 'attack' | 'recover' | 'dead', progress: number, swing: number, reducedMotion: boolean): void {
  const stride = Math.sin(clock * (rig.archetype === 'stone-golem' ? 4 : 9)) * (moving ? 0.65 : 0.025);
  rig.leftLeg.rotation.x = stride; rig.rightLeg.rotation.x = -stride;
  rig.leftArm.rotation.x = -stride * 0.5; rig.rightArm.rotation.x = stride * 0.5;
  rig.torso.position.y = 1.3 + Math.abs(Math.sin(clock * 9)) * (moving ? 0.045 : 0.008);
  rig.torso.rotation.z = moving ? stride * 0.045 : 0;
  rig.cape.rotation.x = (moving ? -0.16 : 0) + Math.sin(clock * 2) * (reducedMotion ? 0.01 : 0.035);
  rig.rightArm.rotation.z = -0.12; rig.leftArm.rotation.z = 0.1;
  if (mode === 'windup') {
    rig.rightArm.rotation.x = -1.5 * progress; rig.leftArm.rotation.x = -0.5 * progress;
    rig.torso.rotation.z = -0.2 * progress;
  } else if (mode === 'attack' || swing > 0) {
    const attack = swing > 0 ? swing : Math.min(1, progress + 0.3);
    rig.rightArm.rotation.x = -1.3 + attack * 2.8;
    rig.rightArm.rotation.z = -1.1 * Math.sin(attack * Math.PI);
    rig.torso.rotation.y = Math.sin(attack * Math.PI) * 0.35;
  } else { rig.torso.rotation.y = 0; }
  if (rig.archetype === 'stone-golem' && (mode === 'windup' || mode === 'attack')) rig.leftArm.rotation.x = rig.rightArm.rotation.x;
  for (let i = 0; i < rig.wings.length; i++) {
    const w = rig.wings[i]; if (w) w.rotation.z = Math.sin(clock * 5.5) * (reducedMotion ? 0.08 : 0.28) * (i ? -1 : 1);
  }
  rig.root.rotation.z = mode === 'dead' ? Math.min(1.45, progress * 1.5) : 0;
}

export function setWeaponTier(rig: Rig, kit: ModelKit, tier: Tier): void {
  rig.weapon.traverse(object => {
    if (object instanceof Mesh && object.geometry === kit.geo.blade) object.material = tier === 'cursed' ? kit.mat.crystal : tier === 'stone' ? kit.mat.silver : kit.mat.bone;
  });
}

export function chest(kit: ModelKit): { root: Group; lid: Group } {
  const root = new Group();
  for (let i = 0; i < 4; i++) part(root, kit.geo.slab, i % 2 ? kit.mat.barkLight : kit.mat.bark, [(i - 1.5) * 0.32, 0.36, 0], [0.3, 0.68, 0.85]);
  for (const x of [-0.49, 0.49]) {
    part(root, kit.geo.slab, kit.mat.gold, [x, 0.37, 0], [0.08, 0.8, 0.92]);
    part(root, kit.geo.slab, kit.mat.darkRock, [x, 0.06, 0], [0.18, 0.12, 1.02]);
  }
  const lid = pivot(root, [0, 0.76, -0.42]);
  for (let i = 0; i < 4; i++) part(lid, kit.geo.slab, i % 2 ? kit.mat.barkLight : kit.mat.bark, [(i - 1.5) * 0.32, 0.06, 0.42], [0.3, 0.2, 0.85]);
  for (const x of [-0.49, 0.49]) part(lid, kit.geo.slab, kit.mat.gold, [x, 0.12, 0.42], [0.08, 0.16, 0.95]);
  part(root, kit.geo.slab, kit.mat.gold, [0, 0.5, 0.49], [0.3, 0.3, 0.09]);
  part(root, kit.geo.shard, kit.mat.ember, [0, 0.47, 0.55], [0.2, 0.2, 0.12]);
  return { root, lid };
}

export function altar(kit: ModelKit, radius = 3.2, cursed = false): Group {
  const root = new Group();
  part(root, kit.geo.joint, kit.mat.darkRock, [0, 0.12, 0], [radius * 2, 0.24, radius * 2]);
  part(root, kit.geo.joint, kit.mat.rock, [0, 0.31, 0], [radius * 1.78, 0.22, radius * 1.78]);
  part(root, kit.geo.ring, kit.mat.gold, [0, 0.44, 0], [radius * 0.77, radius * 0.77, 0.8], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, x = Math.cos(a), z = Math.sin(a);
    part(root, kit.geo.slab, kit.mat.darkRock, [x * radius * 0.9, 0.7, z * radius * 0.9], [0.6, 0.7 + (i % 3) * 0.28, 0.5], [0.1, -a, (i % 2 ? 1 : -1) * 0.1]);
    part(root, kit.geo.slab, cursed ? kit.mat.crystal : kit.mat.cyan, [x * radius * 0.58, 0.45, z * radius * 0.58], [0.13, 0.035, 0.45], [0, -a + Math.PI / 2, 0]);
  }
  return root;
}

export function totem(kit: ModelKit): Group {
  const root = new Group();
  for (let i = 0; i < 4; i++) part(root, kit.geo.rock, kit.mat.darkRock, [0, 0.5 + i * 0.72, 0], [1.4 - i * 0.13, 0.82, 1.1 - i * 0.1], [0, i * 0.45, i % 2 ? 0.1 : -0.1]);
  part(root, kit.geo.shard, kit.mat.crystal, [0, 1.35, 0.6], [1.2, 1.25, 0.7], [0.16, 0, 0]);
  for (const s of [-1, 1]) {
    branch(root, kit, [s * 1.3, 0, 0.3], [s * 0.5, 2.6, 0], 0.45);
    branch(root, kit, [s * 0.5, 2.5, 0], [s * 1.3, 3.7, 0.2], 0.2);
    branch(root, kit, [s * 0.8, 3, 0.05], [s * 1.7, 3.1, -0.1], 0.15);
  }
  return root;
}

export function relic(kit: ModelKit, recipe: RelicRecipeId, seed: number, rank: number): Group {
  const root = new Group(), rng = new Rng(seed);
  const trim = recipe === 'moon-sigil' ? kit.mat.silver : recipe === 'rootheart' ? kit.mat.barkLight : kit.mat.gold;
  const core = recipe === 'moon-sigil' ? kit.mat.crystal : recipe === 'rootheart' ? kit.mat.cyan : kit.mat.ember;
  const twist = rng.next() * Math.PI;
  part(root, kit.geo.rock, core, [0, 0, 0], [0.48, 0.62, 0.44], [0.3, twist, 0.2]);
  if (recipe === 'moon-sigil') {
    for (let i = 0; i < 2 + rank; i++) part(root, kit.geo.ring, trim, [0.05 * i, 0, 0], [0.63 + i * 0.1, 0.63 + i * 0.1, 0.7], [i * 0.4, twist + i * 0.7, 0.25]);
  } else {
    for (let i = 0; i < 4 + rank; i++) {
      const a = i * Math.PI * 2 / (4 + rank) + twist, r = 0.5 + rng.next() * 0.12;
      branch(root, kit, [Math.cos(a) * r, -0.45, Math.sin(a) * r], [Math.cos(a + 0.4) * r, 0.5 + rng.next() * 0.2, Math.sin(a + 0.4) * r], 0.17, trim);
      if (recipe === 'ember-fang') part(root, kit.geo.blade, trim, [Math.cos(a) * r, -0.2, Math.sin(a) * r], [0.7, 0.65, 0.8], [0, -a, -0.28]);
      else branch(root, kit, [Math.cos(a) * r, 0, Math.sin(a) * r], [Math.cos(a + 0.7) * 0.25, 0.35, Math.sin(a + 0.7) * 0.25], 0.12, trim);
    }
  }
  for (let i = 0; i < rank; i++) part(root, kit.geo.shard, core, [(i - (rank - 1) / 2) * 0.27, 0.62, 0], [0.28, 0.3, 0.28], [0.1, twist, 0]);
  root.scale.setScalar(1.35 + rank * 0.12); return root;
}
