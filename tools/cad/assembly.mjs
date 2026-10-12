// Extracts the product tree of a SolidWorks AP214 assembly: products, the
// NEXT_ASSEMBLY_USAGE_OCCURRENCE instances, each instance's placement
// (CONTEXT_DEPENDENT_SHAPE_REPRESENTATION -> ITEM_DEFINED_TRANSFORMATION) and the
// shape representations that hold each product's B-rep. World matrices are
// composed down from the root product. Units are read from the representation
// context and reported; geometry is never parsed here.
import { StepIndex, simpleEntity, complexEntity } from './step-index.mjs';

function vec(index, id) {
  const [type, p] = simpleEntity(index, id);
  if (type === 'CARTESIAN_POINT') return p[1];
  if (type === 'DIRECTION') return p[1];
  throw new Error(`expected point/direction, got ${type} #${id}`);
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** AXIS2_PLACEMENT_3D -> 4x4 column-major matrix (local frame expressed in parent). */
export function placementMatrix(index, id) {
  const [type, p] = simpleEntity(index, id);
  if (type !== 'AXIS2_PLACEMENT_3D') throw new Error(`expected AXIS2_PLACEMENT_3D, got ${type}`);
  const o = vec(index, p[1].ref);
  const z = p[2] ? normalize(vec(index, p[2].ref)) : [0, 0, 1];
  let x = p[3] ? vec(index, p[3].ref) : (Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  // Gram-Schmidt: STEP's ref_direction is projected onto the plane normal to z.
  const d = dot(x, z);
  x = normalize([x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]]);
  const y = cross(z, x);
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
}

export function mul(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + rr] * b[c * 4 + k];
    r[c * 4 + rr] = s;
  }
  return r;
}
export function invertRigid(m) {
  // Rotation transpose, translation -R^T t.
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}
export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function readAssembly(path, log = () => {}) {
  const t0 = Date.now();
  const index = new StepIndex(path);
  log(`indexed ${index.count} entities (max id ${index.maxId}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const products = new Map(); // product id -> {name, description}
  for (const id of index.idsOfType('PRODUCT')) {
    const [, p] = simpleEntity(index, id);
    products.set(id, { id, code: p[0], name: p[1], description: p[2] });
  }
  const pdfToProduct = new Map();
  for (const t of ['PRODUCT_DEFINITION_FORMATION', 'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE']) {
    for (const id of index.idsOfType(t)) {
      const [, p] = simpleEntity(index, id);
      pdfToProduct.set(id, p[2].ref);
    }
  }
  const pds = new Map(); // product_definition id -> {product}
  for (const id of index.idsOfType('PRODUCT_DEFINITION')) {
    const [, p] = simpleEntity(index, id);
    pds.set(id, { pd: id, product: pdfToProduct.get(p[2].ref), shapeReps: [], children: [], parents: [] });
  }
  const nauos = new Map();
  for (const id of index.idsOfType('NEXT_ASSEMBLY_USAGE_OCCURRENCE')) {
    const [, p] = simpleEntity(index, id);
    nauos.set(id, { nauo: id, instanceId: p[0], name: p[1], parent: p[3].ref, child: p[4].ref, matrix: null });
  }
  // PRODUCT_DEFINITION_SHAPE: of a product definition (the part's shape) or of an NAUO (an occurrence).
  const pdsShape = new Map(); // product_definition_shape id -> {pd} | {nauo}
  for (const id of index.idsOfType('PRODUCT_DEFINITION_SHAPE')) {
    const [, p] = simpleEntity(index, id);
    const target = p[2].ref;
    if (pds.has(target)) pdsShape.set(id, { pd: target });
    else if (nauos.has(target)) pdsShape.set(id, { nauo: target });
  }
  for (const id of index.idsOfType('SHAPE_DEFINITION_REPRESENTATION')) {
    const [, p] = simpleEntity(index, id);
    const def = pdsShape.get(p[0].ref);
    if (def?.pd) pds.get(def.pd).shapeReps.push(p[1].ref);
  }
  // Representation -> the B-rep representations it is related to (SHAPE_REPRESENTATION_RELATIONSHIP).
  const repLinks = new Map();
  for (const id of index.idsOfType('SHAPE_REPRESENTATION_RELATIONSHIP')) {
    const [, p] = simpleEntity(index, id);
    const a = p[2].ref, b = p[3].ref;
    if (!repLinks.has(a)) repLinks.set(a, []);
    repLinks.get(a).push(b);
    if (!repLinks.has(b)) repLinks.set(b, []);
    repLinks.get(b).push(a);
  }
  // Placements of occurrences.
  let cdsrCount = 0;
  for (const id of index.idsOfType('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION')) {
    const [, p] = simpleEntity(index, id);
    const relId = p[0].ref;
    const occ = pdsShape.get(p[1].ref);
    if (!occ?.nauo) continue;
    const rel = complexEntity(index, relId);
    const rr = rel.REPRESENTATION_RELATIONSHIP;
    const xf = rel.REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION;
    if (!rr || !xf) throw new Error(`unexpected relationship #${relId}`);
    const idt = xf[0].ref;
    const [t, q] = simpleEntity(index, idt);
    if (t !== 'ITEM_DEFINED_TRANSFORMATION') throw new Error(`unexpected transformation ${t}`);
    const item1 = placementMatrix(index, q[2].ref); // lives in rep_1
    const item2 = placementMatrix(index, q[3].ref); // lives in rep_2
    const n = nauos.get(occ.nauo);
    // Which representation is the child's is not fixed by exporters (SolidWorks writes
    // rep_1 = parent, rep_2 = child). The child frame is placed so that its item lands
    // on the parent's item: M_child->parent = T(item_parent) * T(item_child)^-1.
    const childReps = new Set(pds.get(n.child).shapeReps);
    const rep1 = rr[2].ref, rep2 = rr[3].ref;
    if (childReps.has(rep2)) {
      n.matrix = mul(item1, invertRigid(item2));
      n.childRep = rep2; n.parentRep = rep1; n.childIsRep = 2;
    } else if (childReps.has(rep1)) {
      n.matrix = mul(item2, invertRigid(item1));
      n.childRep = rep1; n.parentRep = rep2; n.childIsRep = 1;
    } else {
      throw new Error(`occurrence #${occ.nauo}: neither representation belongs to the child product`);
    }
    cdsrCount++;
  }
  for (const n of nauos.values()) {
    pds.get(n.parent).children.push(n.nauo);
    pds.get(n.child).parents.push(n.nauo);
  }
  // Units from the first geometric context.
  const units = [];
  for (const id of index.idsOfType('(COMPLEX)')) {
    const t = index.text(id);
    if (t.includes('SI_UNIT') && t.includes('LENGTH_UNIT')) units.push(t.replace(/\s+/g, ' ').slice(0, 200));
    if (units.length > 2) break;
  }
  const roots = [...pds.values()].filter((d) => d.parents.length === 0 && d.children.length > 0);
  log(`products ${products.size}, product definitions ${pds.size}, occurrences ${nauos.size}, placed ${cdsrCount}, roots ${roots.map((r) => products.get(r.product).name).join(', ')}`);
  return { index, products, pds, nauos, repLinks, units, roots };
}

/** Depth-first flattening of the instance tree into leaf occurrences with world matrices. */
export function flatten(asm, rootPd) {
  const out = [];
  function walk(pd, matrix, path) {
    const def = asm.pds.get(pd);
    const name = asm.products.get(def.product).name;
    if (def.children.length === 0) {
      out.push({ pd, product: def.product, name, path: path.slice(), matrix });
      return;
    }
    for (const nid of def.children) {
      const n = asm.nauos.get(nid);
      if (!n.matrix) throw new Error(`occurrence #${nid} has no placement`);
      walk(n.child, mul(matrix, n.matrix), [...path, { nauo: nid, instanceId: n.instanceId, product: asm.products.get(asm.pds.get(n.child).product).name }]);
    }
  }
  walk(rootPd, IDENTITY, []);
  return out;
}
