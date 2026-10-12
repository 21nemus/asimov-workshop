// The workshop environment: room shell, floor and test mat, pegboard tool wall, glass
// partition, benches and props. Purely visual: nothing here takes part in physics.
import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Object3D,
} from 'three';
import { MAT, ROOM, ZONES } from './layout.ts';
import { concrete, paintedWall, pegboard, rubberTiles, whiteboard } from './textures.ts';
import { createPropMaterials, extrusion, gantry, lockers, shelf, stool, supportStand, workbench, type PropMaterials } from './props.ts';
import { shelfObjects, benchClutter, electronicsDesk } from './clutter.ts';

export interface Workshop {
  group: Group;
  materials: PropMaterials;
  floor: Mesh;
  mat: Mesh;
  /** Objects the camera should never pass through (rough boxes for the camera director). */
  obstacles: Object3D[];
}

function receive<T extends Mesh>(m: T): T {
  m.receiveShadow = true;
  return m;
}

export function createWorkshop(): Workshop {
  const group = new Group();
  group.name = 'workshop';
  const pm = createPropMaterials();
  const W = ROOM.frontX - ROOM.backX, D = ROOM.leftZ - ROOM.rightZ;
  const cx = (ROOM.frontX + ROOM.backX) / 2, cz = (ROOM.leftZ + ROOM.rightZ) / 2;

  // ---- Floor: polished concrete with the black rubber test mat on top.
  const conc = concrete();
  conc.map.repeat.set(W / 4, D / 4);
  conc.roughness.repeat.set(W / 4, D / 4);
  const floor = receive(new Mesh(new PlaneGeometry(W, D), new MeshStandardMaterial({ map: conc.map, roughnessMap: conc.roughness, roughness: 0.55, metalness: 0 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.name = 'floor';
  group.add(floor);

  const rub = rubberTiles();
  const mw = MAT.maxX - MAT.minX, md = MAT.maxZ - MAT.minZ;
  for (const t of [rub.map, rub.roughness, rub.bump]) t.repeat.set(mw / (MAT.tile * 2), md / (MAT.tile * 2));
  const matMesh = receive(new Mesh(
    new BoxGeometry(mw, 0.012, md),
    new MeshStandardMaterial({ map: rub.map, roughnessMap: rub.roughness, bumpMap: rub.bump, bumpScale: 0.6, roughness: 1, metalness: 0 }),
  ));
  // Top surface sits at y = 0 so the robot's feet (and the physics floor) stay at zero.
  matMesh.position.set((MAT.minX + MAT.maxX) / 2, -0.006, (MAT.minZ + MAT.maxZ) / 2);
  matMesh.name = 'test-mat';
  group.add(matMesh);
  floor.position.y = -0.0121;

  // ---- Walls: warm white above a cool grey band (the band ends where the pegboard begins).
  const wallPaint = new MeshStandardMaterial({ map: paintedWall('#efece6'), roughness: 0.92, metalness: 0 });
  const bandPaint = new MeshStandardMaterial({ map: paintedWall('#8d979c'), roughness: 0.85, metalness: 0 });
  const upperH = ROOM.height - ROOM.wainscot;
  const wall = (len: number, rotY: number, x: number, z: number) => {
    const up = receive(new Mesh(new PlaneGeometry(len, upperH), wallPaint));
    up.rotation.y = rotY;
    up.position.set(x, ROOM.wainscot + upperH / 2, z);
    const band = receive(new Mesh(new PlaneGeometry(len, ROOM.wainscot), bandPaint));
    band.rotation.y = rotY;
    band.position.set(x, ROOM.wainscot / 2, z);
    group.add(up, band);
  };
  wall(D, Math.PI / 2, ROOM.backX, cz);
  wall(W, Math.PI, cx, ROOM.leftZ);
  wall(D, -Math.PI / 2, ROOM.frontX, cz);
  const ceiling = new Mesh(new PlaneGeometry(W, D), new MeshStandardMaterial({ color: new Color('#e9e7e2'), roughness: 0.95 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(cx, ROOM.height, cz);
  group.add(ceiling);
  // Skirting along the back and left walls.
  const skirt = new MeshStandardMaterial({ color: new Color('#2a2b2e'), roughness: 0.6 });
  group.add(receive(new Mesh(new BoxGeometry(0.02, 0.08, D), skirt)).translateX(ROOM.backX + 0.01).translateY(0.04).translateZ(cz));
  group.add(receive(new Mesh(new BoxGeometry(W, 0.08, 0.02), skirt)).translateX(cx).translateY(0.04).translateZ(ROOM.leftZ - 0.01));

  // ---- Whiteboard on the left wall, past the assembly bench.
  const board = new Group();
  const boardFace = receive(new Mesh(new PlaneGeometry(2.0, 1.0), new MeshStandardMaterial({ map: whiteboard(), roughness: 0.32, metalness: 0 })));
  const frame = receive(new Mesh(new BoxGeometry(2.06, 1.06, 0.025), pm.aluminium));
  frame.position.z = -0.014;
  const tray = receive(new Mesh(new BoxGeometry(1.4, 0.025, 0.07), pm.aluminium));
  tray.position.set(0, -0.53, 0.03);
  board.add(frame, boardFace, tray);
  board.rotation.y = Math.PI;
  board.position.set(2.35, 1.62, ROOM.leftZ - 0.02);
  board.name = 'whiteboard';
  group.add(board);

  // ---- Pegboard tool wall above the painted band on the back wall.
  const peg = pegboard();
  const pegW = D - 1.2, pegH = ROOM.pegboardTop - ROOM.wainscot;
  for (const t of [peg.map, peg.alpha, peg.bump]) t.repeat.set(pegW, pegH);
  const pegboardMesh = receive(new Mesh(
    new PlaneGeometry(pegW, pegH),
    new MeshStandardMaterial({ map: peg.map, bumpMap: peg.bump, bumpScale: 1.4, alphaMap: peg.alpha, alphaTest: 0.5, roughness: 0.72, side: DoubleSide }),
  ));
  pegboardMesh.rotation.y = Math.PI / 2;
  pegboardMesh.position.set(ROOM.backX + 0.032, ROOM.wainscot + pegH / 2, cz + 0.2);
  pegboardMesh.castShadow = true;
  group.add(pegboardMesh);
  // Dark gap behind the pegboard holes, and a capping strip.
  const cavity = new Mesh(new PlaneGeometry(pegW, pegH), new MeshBasicMaterial({ color: new Color('#1d1b18') }));
  cavity.rotation.y = Math.PI / 2;
  cavity.position.set(ROOM.backX + 0.004, ROOM.wainscot + pegH / 2, cz + 0.2);
  group.add(cavity);
  for (const y of [ROOM.wainscot, ROOM.pegboardTop]) {
    const strip = receive(new Mesh(new BoxGeometry(0.04, 0.03, pegW), pm.aluminium));
    strip.position.set(ROOM.backX + 0.03, y, cz + 0.2);
    group.add(strip);
  }

  // Shelves on the pegboard with original shelf objects.
  const shelves: [number, number, number][] = [[1.92, -2.7, 1.1], [2.32, -1.1, 1.4], [1.92, 0.75, 0.9], [2.3, 2.1, 1.3]];
  for (const [y, z, len] of shelves) {
    const s = shelf(pm, len);
    s.rotation.y = Math.PI / 2;
    s.position.set(ROOM.backX + 0.035, y, z);
    group.add(s);
    const items = shelfObjects(pm, len, z * 13 + y * 7);
    items.rotation.y = Math.PI / 2;
    items.position.set(ROOM.backX + 0.035, y + 0.01, z);
    group.add(items);
  }

  // ---- Glass partition on the right side: aluminium mullions with clear glass.
  // Frosted glass: the space beyond reads as soft shapes, not as an empty void.
  const glass = new MeshPhysicalMaterial({ color: new Color('#f3f6f7'), roughness: 0.4, metalness: 0, transmission: 0.0, transparent: true, opacity: 0.62, depthWrite: false });
  const partition = new Group();
  const panes = 6, paneW = (W - 0.6) / panes;
  for (let k = 0; k <= panes; k++) partition.add(extrusion(pm.aluminium, ROOM.height, 'y', ROOM.backX + 0.3 + k * paneW, ROOM.height / 2, ROOM.rightZ + 0.03, 0.05));
  partition.add(extrusion(pm.aluminium, W - 0.6, 'x', cx, 0.03, ROOM.rightZ + 0.03, 0.05));
  partition.add(extrusion(pm.aluminium, W - 0.6, 'x', cx, 2.25, ROOM.rightZ + 0.03, 0.05));
  const pane = new Mesh(new PlaneGeometry(W - 0.6, ROOM.height), glass);
  pane.position.set(cx, ROOM.height / 2, ROOM.rightZ + 0.03);
  partition.add(pane);
  // Bright gallery beyond the glass, abstract and out of focus by design.
  const beyond = new Mesh(new PlaneGeometry(W + 4, ROOM.height + 1), new MeshBasicMaterial({ color: new Color('#c6ced2') }));
  beyond.position.set(cx, ROOM.height / 2, ROOM.rightZ - 2.5);
  partition.add(beyond);
  for (let k = 0; k < 5; k++) {
    const block = new Mesh(new BoxGeometry(0.8 + (k % 2) * 0.5, 0.7 + (k % 3) * 0.35, 0.3), new MeshBasicMaterial({ color: new Color(k % 2 ? '#9aa5aa' : '#8a959b') }));
    block.position.set(ROOM.backX + 0.8 + k * 1.6, 0.45 + (k % 3) * 0.17, ROOM.rightZ - 1.6);
    partition.add(block);
  }
  group.add(partition);

  // ---- Assembly bench (BUILD) along the left wall.
  const ab = ZONES.assemblyBench;
  const bench = workbench(pm, ab.length, ab.depth, ab.top);
  bench.position.set(ab.x, 0, ab.z);
  bench.name = 'assembly-bench';
  group.add(bench);
  const clutter = benchClutter(pm, ab.length, ab.depth);
  clutter.position.set(ab.x, ab.top, ab.z);
  group.add(clutter);

  // ---- Ankle microscope bench near the glass (daylight side).
  const kb = ZONES.ankleBench;
  const ankleBench = workbench(pm, kb.length, kb.depth, kb.top);
  ankleBench.position.set(kb.x, 0, kb.z);
  ankleBench.name = 'ankle-bench';
  group.add(ankleBench);

  // ---- Electronics desk, gantry, stands, lockers, stool.
  const desk = electronicsDesk(pm);
  desk.position.set(ZONES.electronics.x, 0, ZONES.electronics.z);
  group.add(desk);
  const strapMat = new MeshStandardMaterial({ color: new Color('#7d4fb5'), roughness: 0.85 });
  const g = gantry(pm, strapMat);
  g.position.set(ZONES.gantry.x, 0, ZONES.gantry.z);
  group.add(g);
  const st = supportStand(pm);
  st.position.set(ZONES.stands.x, 0, ZONES.stands.z);
  st.rotation.y = 0.35;
  group.add(st);
  const lk = lockers(pm, 3);
  lk.position.set(ZONES.lockers.x + 0.5, 0, ZONES.lockers.z);
  lk.rotation.y = Math.PI;
  group.add(lk);
  const sl = stool(pm);
  sl.position.set(0.75, 0, 3.05);
  group.add(sl);

  return { group, materials: pm, floor, mat: matMesh, obstacles: [bench, ankleBench, g, lk, desk] };
}
