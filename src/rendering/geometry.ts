import { BufferAttribute, BufferGeometry, CylinderGeometry, DodecahedronGeometry, ExtrudeGeometry, Shape, TorusGeometry, Vector3 } from 'three';

function bevel(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(-0.4, -0.4); shape.lineTo(0.4, -0.4); shape.lineTo(0.4, 0.4); shape.lineTo(-0.4, 0.4); shape.closePath();
  const geo = new ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 1, steps: 1, curveSegments: 1 });
  geo.translate(0, 0, -0.4);
  geo.computeVertexNormals();
  return geo;
}
function angularCrown(): BufferGeometry {
  const sides = 7, positions: number[] = [], indices: number[] = [];
  for (let ring = 0; ring < 4; ring++) for (let j = 0; j < sides; j++) {
    const a = j / sides * Math.PI * 2 + ring * 0.22;
    const radius = [0.16, 0.85, 0.76, 0.07][ring] ?? 0.1;
    const uneven = 1 + Math.sin(j * 11.4 + ring * 3.2) * 0.17;
    positions.push(Math.cos(a) * radius * uneven, [-0.48, -0.18, 0.19, 0.62][ring] ?? 0, Math.sin(a) * radius * uneven);
  }
  for (let r = 0; r < 3; r++) for (let j = 0; j < sides; j++) {
    const a = r * sides + j, b = r * sides + (j + 1) % sides, c = a + sides, d = b + sides;
    indices.push(a, c, b, b, c, d);
  }
  for (let j = 1; j < sides - 1; j++) { indices.push(0, j + 1, j); indices.push(21, 21 + j, 22 + j); }
  const geo = new BufferGeometry(); geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3)); geo.setIndex(indices); geo.computeVertexNormals();
  return geo;
}
function fracturedRock(): BufferGeometry {
  const geo = new DodecahedronGeometry(0.7, 0);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const scale = 1 + Math.sin(x * 9.1 + y * 6.3 + z * 12.8) * 0.16;
    pos.setXYZ(i, x * scale, y * scale * 0.85, z * scale);
  }
  geo.computeVertexNormals();
  return geo;
}
function blade(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(-0.11, 0); shape.lineTo(-0.15, 0.72); shape.lineTo(0.025, 1.25); shape.lineTo(0.13, 0.72); shape.lineTo(0.09, 0); shape.closePath();
  const geo = new ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 1, steps: 1, curveSegments: 1 });
  geo.translate(0, 0, -0.025); geo.computeVertexNormals(); return geo;
}
function wing(): BufferGeometry {
  const positions = [0, 0, 0, 0.5, 0.3, 0.08, 1.5, 0.7, 0, 2.8, 0.1, 0, 2.2, -0.4, 0.06, 1.4, -0.2, 0.05, 0.8, -0.7, 0.03, 0.4, -0.2, 0.04];
  const geo = new BufferGeometry(); geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex([0, 1, 7, 1, 5, 7, 1, 2, 5, 2, 4, 5, 2, 3, 4, 5, 6, 7]); geo.computeVertexNormals(); return geo;
}
function grassClump(): BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  for (let j = 0; j < 5; j++) {
    const a = j * 2.399, x = Math.cos(a) * 0.2, z = Math.sin(a) * 0.2;
    const h = 0.5 + Math.sin(j * 9) * 0.12, dx = Math.cos(a) * 0.09, dz = Math.sin(a) * 0.09, i = positions.length / 3;
    positions.push(x - dx, 0, z - dz, x + dx, 0, z + dz, x + dx * 3, h, z + dz * 3);
    indices.push(i, i + 1, i + 2, i + 2, i + 1, i);
  }
  const geo = new BufferGeometry(); geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3)); geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}

/** A small reusable geometry vocabulary; shape detail comes from articulated composition. */
export class GeometryLibrary {
  readonly slab = bevel();
  readonly rock = fracturedRock();
  readonly crown = angularCrown();
  readonly branch = new CylinderGeometry(0.42, 0.7, 1, 7, 1).translate(0, 0.5, 0);
  readonly joint = new CylinderGeometry(0.46, 0.5, 1, 8, 1);
  readonly shard = new CylinderGeometry(0.02, 0.32, 1, 5, 1).translate(0, 0.5, 0);
  readonly blade = blade();
  readonly ring = new TorusGeometry(1, 0.075, 4, 24);
  readonly wing = wing();
  readonly grass = grassClump();
  dispose(): void { for (const geo of Object.values(this)) if (geo instanceof BufferGeometry) geo.dispose(); }
}
export const POINT_UP = new Vector3(0, 1, 0);
