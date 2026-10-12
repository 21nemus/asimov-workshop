// Original workshop props built from simple geometry: aluminium extrusion frames, benches,
// orange printed support cradles, lockers, a stool, shelves and shelf objects. Generic
// designs inspired by the kind of equipment in Menlo's lab photos, not copies of it.
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { benchTop } from './textures.ts';

export interface PropMaterials {
  aluminium: MeshStandardMaterial;
  darkMetal: MeshStandardMaterial;
  lockerPaint: MeshStandardMaterial;
  printOrange: MeshPhysicalMaterial;
  rubber: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  plastic: (hex: string, rough?: number) => MeshStandardMaterial;
  fabric: (hex: string) => MeshStandardMaterial;
}

export function createPropMaterials(): PropMaterials {
  const cache = new Map<string, MeshStandardMaterial>();
  const plastic = (hex: string, rough = 0.55) => {
    const k = `p:${hex}:${rough}`;
    if (!cache.has(k)) cache.set(k, new MeshStandardMaterial({ color: new Color(hex), roughness: rough, metalness: 0 }));
    return cache.get(k)!;
  };
  const fabric = (hex: string) => {
    const k = `f:${hex}`;
    if (!cache.has(k)) cache.set(k, new MeshStandardMaterial({ color: new Color(hex), roughness: 0.92, metalness: 0 }));
    return cache.get(k)!;
  };
  return {
    aluminium: new MeshStandardMaterial({ color: new Color('#b7bbc0'), roughness: 0.34, metalness: 1 }),
    darkMetal: new MeshStandardMaterial({ color: new Color('#26282c'), roughness: 0.5, metalness: 0.7 }),
    lockerPaint: new MeshStandardMaterial({ color: new Color('#1f2124'), roughness: 0.42, metalness: 0.55 }),
    printOrange: new MeshPhysicalMaterial({ color: new Color('#e07a22'), roughness: 0.46, metalness: 0, sheen: 0.4, sheenColor: new Color('#ffcf9a'), sheenRoughness: 0.5 }),
    rubber: new MeshStandardMaterial({ color: new Color('#1d1e20'), roughness: 0.9, metalness: 0 }),
    wood: new MeshStandardMaterial({ map: benchTop(), roughness: 0.62, metalness: 0 }),
    plastic,
    fabric,
  };
}

function place<T extends Mesh>(m: T, x: number, y: number, z: number): T {
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 40x40 mm T-slot extrusion profile, extruded along +Z then oriented by the caller. */
function extrusionGeometry(length: number, size = 0.04): BufferGeometry {
  const s = size / 2, slot = size * 0.16, lip = size * 0.12;
  const shape = new Shape();
  // Square with a T-slot opening on each face.
  const pts: [number, number][] = [];
  const side = (x0: number, y0: number, dx: number, dy: number, nx: number, ny: number) => {
    // Walk one side: corner, slot entry, slot, slot exit.
    const L = size;
    const a = (L - slot * 2) / 2;
    pts.push([x0, y0]);
    pts.push([x0 + dx * a, y0 + dy * a]);
    pts.push([x0 + dx * a + nx * -lip, y0 + dy * a + ny * -lip]);
    pts.push([x0 + dx * (a + slot * 2) + nx * -lip, y0 + dy * (a + slot * 2) + ny * -lip]);
    pts.push([x0 + dx * (a + slot * 2), y0 + dy * (a + slot * 2)]);
  };
  side(-s, -s, 1, 0, 0, -1);
  side(s, -s, 0, 1, 1, 0);
  side(s, s, -1, 0, 0, 1);
  side(-s, s, 0, -1, -1, 0);
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: length, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.0012, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -length / 2);
  return g;
}

/** A straight extrusion between two points (axis-aligned use only). */
export function extrusion(mat: Material, length: number, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, size = 0.04): Mesh {
  const g = extrusionGeometry(length, size);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  if (axis === 'y') g.rotateX(Math.PI / 2);
  return place(new Mesh(g, mat), x, y, z);
}

/** Workbench: birch top on an aluminium extrusion frame with a lower shelf. */
export function workbench(m: PropMaterials, length: number, depth: number, height: number): Group {
  const g = new Group();
  const top = place(new Mesh(new BoxGeometry(length, 0.03, depth), m.wood), 0, height - 0.015, 0);
  g.add(top);
  const legX = length / 2 - 0.05, legZ = depth / 2 - 0.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(extrusion(m.aluminium, height - 0.03, 'y', sx * legX, (height - 0.03) / 2, sz * legZ));
  for (const sz of [-1, 1]) {
    g.add(extrusion(m.aluminium, length - 0.06, 'x', 0, height - 0.06, sz * legZ));
    g.add(extrusion(m.aluminium, length - 0.06, 'x', 0, 0.16, sz * legZ));
  }
  const shelf = place(new Mesh(new BoxGeometry(length - 0.1, 0.018, depth - 0.1), m.wood), 0, 0.19, 0);
  g.add(shelf);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(place(new Mesh(new CylinderGeometry(0.025, 0.025, 0.012, 16), m.rubber), sx * legX, 0.006, sz * legZ));
  return g;
}

/**
 * Robot support stand: two aluminium posts on weighted feet, each carrying an orange
 * printed U-cradle. Generic design for parking a humanoid by its arms or torso.
 */
export function supportStand(m: PropMaterials): Group {
  const g = new Group();
  const cradleShape = new Shape();
  const w = 0.2, h = 0.1, r = 0.065;
  cradleShape.moveTo(-w / 2, 0);
  cradleShape.lineTo(w / 2, 0);
  cradleShape.lineTo(w / 2, h);
  cradleShape.lineTo(r + 0.012, h);
  cradleShape.absarc(0, h, r, 0, Math.PI, true);
  cradleShape.lineTo(-w / 2, h);
  cradleShape.closePath();
  const cradleGeo = new ExtrudeGeometry(cradleShape, { depth: 0.13, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 3, curveSegments: 24 });
  cradleGeo.translate(0, 0, -0.065);
  for (const sz of [-0.13, 0.13]) {
    g.add(extrusion(m.aluminium, 0.52, 'y', 0, 0.3, sz));
    const foot = new Mesh(new CylinderGeometry(0.09, 0.105, 0.03, 40), m.printOrange);
    g.add(place(foot, 0, 0.015, sz));
    const cradle = new Mesh(cradleGeo, m.printOrange);
    cradle.rotation.y = Math.PI / 2;
    g.add(place(cradle, 0, 0.56, sz));
  }
  g.add(extrusion(m.aluminium, 0.3, 'z', 0, 0.12, 0));
  return g;
}

/** Tall aluminium extrusion gantry with a top beam and a hanging lift strap (slack, unused). */
export function gantry(m: PropMaterials, strapMat: Material): Group {
  const g = new Group();
  const H = 2.35, W = 1.1, D = 0.9;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(extrusion(m.aluminium, H, 'y', (sx * W) / 2, H / 2, (sz * D) / 2));
  }
  for (const sz of [-1, 1]) {
    g.add(extrusion(m.aluminium, W, 'x', 0, H - 0.02, (sz * D) / 2));
    g.add(extrusion(m.aluminium, W, 'x', 0, 0.09, (sz * D) / 2));
  }
  for (const sx of [-1, 1]) g.add(extrusion(m.aluminium, D, 'z', (sx * W) / 2, 0.09, 0));
  g.add(extrusion(m.aluminium, D, 'z', 0, H - 0.02, 0, 0.06));
  // Casters.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wheel = new Mesh(new CylinderGeometry(0.04, 0.04, 0.03, 20), m.rubber);
    wheel.rotation.x = Math.PI / 2;
    g.add(place(wheel, (sx * W) / 2, 0.04, (sz * D) / 2 + 0.04 * sz));
  }
  // Slack strap looping from the top beam, clearly not attached to anything.
  const strap = new Mesh(new TorusGeometry(0.16, 0.012, 6, 40, Math.PI * 1.15), strapMat);
  strap.rotation.z = Math.PI * 0.92;
  g.add(place(strap, 0, H - 0.42, 0));
  const hook = new Mesh(new TorusGeometry(0.035, 0.008, 8, 20), m.darkMetal);
  g.add(place(hook, 0, H - 0.08, 0));
  const chain = new Mesh(new CylinderGeometry(0.006, 0.006, 0.18, 6), m.darkMetal);
  g.add(place(chain, 0, H - 0.16, 0));
  return g;
}

/** A bank of tall metal lockers with handles and vents. */
export function lockers(m: PropMaterials, count = 3): Group {
  const g = new Group();
  const w = 0.42, h = 1.85, d = 0.48;
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * (w + 0.004);
    g.add(place(new Mesh(new BoxGeometry(w, h, d), m.lockerPaint), x, h / 2 + 0.06, 0));
    for (const y of [0.55, 1.4]) {
      const handle = new Mesh(new BoxGeometry(0.02, 0.12, 0.015), m.aluminium);
      g.add(place(handle, x + w / 2 - 0.06, y, d / 2 + 0.01));
      for (let v = 0; v < 4; v++) g.add(place(new Mesh(new BoxGeometry(0.16, 0.006, 0.004), m.darkMetal), x, y + 0.2 + v * 0.02, d / 2 + 0.002));
    }
  }
  g.add(place(new Mesh(new BoxGeometry(count * (w + 0.004), 0.06, d - 0.04), m.darkMetal), 0, 0.03, 0));
  return g;
}

/** Workshop stool with a round seat and footring. */
export function stool(m: PropMaterials): Group {
  const g = new Group();
  g.add(place(new Mesh(new CylinderGeometry(0.17, 0.17, 0.05, 32), m.rubber), 0, 0.66, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new Mesh(new CylinderGeometry(0.012, 0.014, 0.66, 10), m.darkMetal);
    leg.rotation.z = Math.cos(a) * 0.12;
    leg.rotation.x = -Math.sin(a) * 0.12;
    g.add(place(leg, Math.cos(a) * 0.15, 0.33, Math.sin(a) * 0.15));
  }
  const ring = new Mesh(new TorusGeometry(0.17, 0.008, 8, 40), m.darkMetal);
  ring.rotation.x = Math.PI / 2;
  g.add(place(ring, 0, 0.24, 0));
  return g;
}

/** A small wall shelf with brackets. */
export function shelf(m: PropMaterials, length: number): Group {
  const g = new Group();
  g.add(place(new Mesh(new BoxGeometry(length, 0.018, 0.16), m.wood), 0, 0, 0.08));
  for (const sx of [-1, 1]) g.add(place(new Mesh(new BoxGeometry(0.012, 0.1, 0.12), m.darkMetal), (sx * length) / 2.6, -0.055, 0.07));
  return g;
}

/** Merges many small meshes of one material into a single draw call. */
export function mergeInto(meshes: Mesh[], material: Material): Mesh {
  const geos = meshes.map((mesh) => {
    mesh.updateMatrix();
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrix);
    return geo.index ? geo.toNonIndexed() : geo;
  });
  const merged = mergeGeometries(geos, false)!;
  const out = new Mesh(merged, material);
  out.castShadow = true;
  out.receiveShadow = true;
  return out;
}
