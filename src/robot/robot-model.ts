// The hardware robot: CAD parts from the full-body assembly, merged per body and material
// class, hung on the MuJoCo kinematic rig. Owns part identity, per-part render state,
// picking and single-part proxies. Never owns simulation state: callers pose the rig.
import {
  Box3,
  BufferGeometry,
  Group,
  LessEqualDepth,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  RGBADepthPacking,
  Ray,
  Vector3,
  type Material,
  type Object3D,
  type Raycaster,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RobotRig } from './rig.ts';
import { PartState, applyPartShader } from './part-state.ts';
import { createRobotMaterials, type MaterialClass } from './materials.ts';

export interface PartInfo {
  i: number;
  occurrence: number;
  name: string;
  partNumber: string | null;
  instance: number;
  module: string;
  cadPath: string;
  body: string;
  cls: MaterialClass;
  kind: 'fabricated' | 'actuator' | 'hardware' | 'fastener' | 'electronics' | 'other';
  material: string | null;
  finish: string | null;
  materialBasis: 'BOM' | 'ILLUSTRATIVE';
  bom: string | null;
  bomPartNumber: string | null;
  model: string | null;
  description: string | null;
  note: string | null;
  assignment: { confidence: string; basis: string; residualMm: number | null };
  center: [number, number, number];
  size: [number, number, number];
  range: { mesh: string; start: number; count: number };
  triangles: number;
  cadTriangles: number;
}

export interface PartsFile {
  source: { repository: string; commit: string; file: string; sha256: string; licence: string };
  conversion: string;
  triangles: { cad: number; shipped: number };
  parts: PartInfo[];
}

export interface PartHit {
  part: PartInfo;
  distance: number;
  point: Vector3;
}

/**
 * X-ray outline for parts still to come: nearly clear where a surface faces the camera,
 * visible at silhouettes, so it marks where a part will go without tinting what is behind it.
 */
function createGhostMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ color: 0xf2e7d6, emissive: 0xf2e7d6, emissiveIntensity: 0.55, transparent: true, opacity: 0.62, depthWrite: false, depthFunc: LessEqualDepth });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      float ghostRim = 1.0 - abs(dot(normalize(vViewPosition), normal));
      diffuseColor.a *= 0.1 + 0.9 * pow(ghostRim, 1.6);`,
    );
  };
  return m;
}

const tmpMatrix = new Matrix4();
const tmpRay = new Ray();
const tmpBox = new Box3();
const tmpV = new Vector3();
const va = new Vector3(), vb = new Vector3(), vc = new Vector3();

export class RobotModel {
  readonly rig = new RobotRig();
  readonly materials = createRobotMaterials();
  parts: PartInfo[] = [];
  source!: PartsFile['source'];
  state!: PartState;
  /** Merged meshes keyed "body|cls". */
  readonly meshes = new Map<string, Mesh>();
  readonly ghostMeshes = new Map<string, Mesh>();
  /**
   * Ghosts draw as one clean translucent layer: a depth-only pass first (in the transparent
   * queue, so solid parts behind are already drawn), then colour only where that depth matches.
   */
  readonly ghostDepthMaterial = new MeshBasicMaterial({ colorWrite: false, transparent: true, opacity: 0, depthWrite: true });
  readonly ghostMaterial = createGhostMaterial();
  private readonly ghostDepthMeshes: Mesh[] = [];
  private depthMaterial!: MeshDepthMaterial;
  /** Parts not shown when the "fasteners" toggle is off etc. */
  readonly byBody = new Map<string, PartInfo[]>();
  loaded = false;

  async load(baseUrl: string, onProgress?: (fraction: number) => void): Promise<void> {
    const [partsFile, gltf] = await Promise.all([
      fetch(`${baseUrl}robot/parts.json`).then((r) => {
        if (!r.ok) throw new Error(`parts table: HTTP ${r.status}`);
        return r.json() as Promise<PartsFile>;
      }),
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${baseUrl}robot/asimov-cad.glb`, (e) => {
        if (e.total) onProgress?.(e.loaded / e.total);
      }),
    ]);
    this.parts = partsFile.parts;
    this.source = partsFile.source;
    for (const p of this.parts) {
      if (!this.byBody.has(p.body)) this.byBody.set(p.body, []);
      this.byBody.get(p.body)!.push(p);
    }
    this.state = new PartState(this.parts.length);
    for (const m of Object.values(this.materials)) applyPartShader(m, this.state);
    applyPartShader(this.ghostMaterial, this.state, { hiddenExpr: 'step(pState.b, 0.5)', shade: false });
    applyPartShader(this.ghostDepthMaterial, this.state, { hiddenExpr: 'step(pState.b, 0.5)', shade: false });
    this.depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    applyPartShader(this.depthMaterial, this.state, { shade: false });

    const bodyNodes: Object3D[] = [];
    gltf.scene.traverse((o) => { if (o.name.startsWith('body:') || (o.userData.body && !o.userData.cls)) bodyNodes.push(o); });
    for (const node of bodyNodes) {
      const bodyName = (node.userData.body as string) ?? node.name.slice(5);
      const target = this.rig.body(bodyName).content;
      for (const child of [...node.children]) {
        const mesh = child as Mesh;
        if (!(mesh as Mesh).isMesh) continue;
        const cls = mesh.userData.cls as MaterialClass;
        mesh.material = this.materials[cls] ?? this.materials.unknown;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = this.depthMaterial;
        mesh.name = `${bodyName}|${cls}`;
        // Partially hidden merged meshes must not be culled by a stale bounding sphere.
        mesh.frustumCulled = false;
        target.add(mesh);
        this.meshes.set(mesh.name, mesh);
        const ghost = new Mesh(mesh.geometry, this.ghostMaterial);
        ghost.name = `ghost:${mesh.name}`;
        ghost.position.copy(mesh.position);
        ghost.quaternion.copy(mesh.quaternion);
        ghost.scale.copy(mesh.scale);
        ghost.renderOrder = 11;
        ghost.frustumCulled = false;
        ghost.visible = false;
        const depth = new Mesh(mesh.geometry, this.ghostDepthMaterial);
        depth.name = `ghost-depth:${mesh.name}`;
        depth.position.copy(mesh.position);
        depth.quaternion.copy(mesh.quaternion);
        depth.scale.copy(mesh.scale);
        depth.renderOrder = 10;
        depth.frustumCulled = false;
        depth.visible = false;
        target.add(depth, ghost);
        this.ghostMeshes.set(mesh.name, ghost);
        this.ghostDepthMeshes.push(depth);
      }
    }
    this.loaded = true;
  }

  /** Shows the ghost overlay pass only while some part is ghosted. */
  setGhostPass(on: boolean): void {
    for (const g of this.ghostMeshes.values()) g.visible = on;
    for (const g of this.ghostDepthMeshes) g.visible = on;
  }

  meshOf(part: PartInfo): Mesh {
    const m = this.meshes.get(part.range.mesh);
    if (!m) throw new Error(`no mesh ${part.range.mesh}`);
    return m;
  }

  /** World-space bounding box of a part (rig pose + any offset applied). */
  partWorldBox(part: PartInfo, out = new Box3()): Box3 {
    const body = this.rig.body(part.body).content;
    body.updateWorldMatrix(true, false);
    const [ox, oy, oz] = this.state.getOffset(part.i);
    const c = tmpV.set(part.center[0] + ox, part.center[1] + oy, part.center[2] + oz);
    out.setFromCenterAndSize(c, new Vector3(...part.size));
    return out.applyMatrix4(body.matrixWorld);
  }

  partWorldCenter(part: PartInfo, out = new Vector3()): Vector3 {
    const body = this.rig.body(part.body).content;
    body.updateWorldMatrix(true, false);
    const [ox, oy, oz] = this.state.getOffset(part.i);
    return out.set(part.center[0] + ox, part.center[1] + oy, part.center[2] + oz).applyMatrix4(body.matrixWorld);
  }

  /**
   * Exact pick against visible parts: a body-frame box test per part, then the part's own
   * triangles (its draw range in the merged mesh). Hidden parts never block a pick.
   */
  pick(raycaster: Raycaster, filter?: (p: PartInfo) => boolean): PartHit | null {
    let best: PartHit | null = null;
    for (const [bodyName, list] of this.byBody) {
      const content = this.rig.body(bodyName).content;
      content.updateWorldMatrix(true, false);
      tmpMatrix.copy(content.matrixWorld).invert();
      tmpRay.copy(raycaster.ray).applyMatrix4(tmpMatrix);
      for (const p of list) {
        if (!this.state.isVisible(p.i) || (filter && !filter(p))) continue;
        const [ox, oy, oz] = this.state.getOffset(p.i);
        tmpBox.setFromCenterAndSize(tmpV.set(p.center[0] + ox, p.center[1] + oy, p.center[2] + oz), new Vector3(p.size[0] + 0.002, p.size[1] + 0.002, p.size[2] + 0.002));
        if (!tmpRay.intersectsBox(tmpBox)) continue;
        const hit = this.rayPart(p, tmpRay, [ox, oy, oz]);
        if (hit === null) continue;
        const point = tmpRay.at(hit, new Vector3()).applyMatrix4(content.matrixWorld);
        const distance = point.distanceTo(raycaster.ray.origin);
        if (!best || distance < best.distance) best = { part: p, distance, point };
      }
    }
    return best;
  }

  /** Ray (body frame) against a part's triangles; returns the ray parameter or null. */
  private rayPart(p: PartInfo, ray: Ray, offset: [number, number, number]): number | null {
    const mesh = this.meshOf(p);
    const geo = mesh.geometry as BufferGeometry;
    const pos = geo.getAttribute('position');
    const index = geo.getIndex()!;
    // The mesh node may carry the glTF dequantisation transform.
    mesh.updateMatrix();
    const local = mesh.matrix;
    let best: number | null = null;
    const end = p.range.start + p.range.count;
    for (let i = p.range.start; i < end; i += 3) {
      va.fromBufferAttribute(pos, index.getX(i)).applyMatrix4(local);
      vb.fromBufferAttribute(pos, index.getX(i + 1)).applyMatrix4(local);
      vc.fromBufferAttribute(pos, index.getX(i + 2)).applyMatrix4(local);
      va.x += offset[0]; va.y += offset[1]; va.z += offset[2];
      vb.x += offset[0]; vb.y += offset[1]; vb.z += offset[2];
      vc.x += offset[0]; vc.y += offset[1]; vc.z += offset[2];
      const hit = ray.intersectTriangle(va, vb, vc, false, tmpV);
      if (hit) {
        const t = hit.distanceTo(ray.origin);
        if (best === null || t < best) best = t;
      }
    }
    return best;
  }

  /**
   * A standalone mesh of one part that shares the merged buffers (no copy): same geometry
   * attributes, its own draw range. Used for isolated views and BUILD placement animation.
   */
  createProxy(p: PartInfo, material?: Material): Mesh {
    const src = this.meshOf(p);
    const geo = new BufferGeometry();
    for (const [name, attr] of Object.entries(src.geometry.attributes)) geo.setAttribute(name, attr);
    geo.setIndex(src.geometry.getIndex());
    geo.setDrawRange(p.range.start, p.range.count);
    geo.boundingSphere = src.geometry.boundingSphere;
    const mesh = new Mesh(geo, material ?? (src.material as Material));
    mesh.matrix.copy(src.matrix);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `proxy:${p.name}#${p.instance}`;
    return mesh;
  }

  /** Group in the part's body frame (follows the rig) holding a proxy, for overlays. */
  attachToBody(p: PartInfo, obj: Object3D): Group {
    const g = new Group();
    g.add(obj);
    this.rig.body(p.body).content.add(g);
    return g;
  }

  partsWhere(fn: (p: PartInfo) => boolean): PartInfo[] {
    return this.parts.filter(fn);
  }
}
