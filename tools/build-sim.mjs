// Builds the simulation inputs shipped with ASIMOV WORKSHOP from the pinned asimov-1 sim-model:
//   public/sim/asimov_1.physics.xml   physics-only MJCF (visual mesh geoms removed; verified
//                                     bit-identical by tools/check-physics-equivalence.mjs)
//   src/data/kinematics.json          the compiled kinematic tree (MuJoCo 3.3.8 compile of the
//                                     same MJCF): bodies, joints, collision geoms, sites, masses
// Usage: node tools/build-sim.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { compileModel, withActuatorOverlay, nameReader } from './mujoco-node.mjs';
import { physicsOnlyXml } from './physics-model.mjs';

const pins = JSON.parse(readFileSync('references/pins.json', 'utf8'));
const pin = pins.sources.find((s) => s.id === 'asimov-1@viewer-submodule');
const simDir = join('.reference-cache', `asimov-1@${pin.commit.slice(0, 7)}`, 'sim-model');
const xmlPath = join(simDir, 'xmls/asimov_1.xml');
const xml = readFileSync(xmlPath, 'utf8');
const sha = createHash('sha256').update(xml).digest('hex');
const expected = pin.files['sim-model/xmls/asimov_1.xml'].sha256;
if (sha !== expected) throw new Error(`asimov_1.xml sha256 ${sha} does not match pin ${expected}`);

const { mujoco, model, data } = await compileModel(simDir, withActuatorOverlay(xml), 'kin');
const name = nameReader(model);
mujoco.mj_forward(model, data);
const r = (v, d = 9) => +v.toFixed(d);
const bodies = [];
for (let b = 0; b < model.nbody; b++) {
  const jnt = model.body_jntadr[b];
  const joints = [];
  for (let j = jnt; j >= 0 && j < jnt + model.body_jntnum[b]; j++) {
    joints.push({
      id: j, name: name(model.name_jntadr[j]), type: ['free', 'ball', 'slide', 'hinge'][model.jnt_type[j]],
      axis: [0, 1, 2].map((k) => r(model.jnt_axis[3 * j + k])), pos: [0, 1, 2].map((k) => r(model.jnt_pos[3 * j + k])),
      range: model.jnt_limited[j] ? [r(model.jnt_range[2 * j]), r(model.jnt_range[2 * j + 1])] : null,
      qpos0: r(model.qpos0[model.jnt_qposadr[j]]), qposadr: model.jnt_qposadr[j], dofadr: model.jnt_dofadr[j],
      armature: r(model.dof_armature[model.jnt_dofadr[j]]),
    });
  }
  bodies.push({
    id: b, name: name(model.name_bodyadr[b]), parent: model.body_parentid[b],
    pos: [0, 1, 2].map((k) => r(model.body_pos[3 * b + k])), quat: [0, 1, 2, 3].map((k) => r(model.body_quat[4 * b + k])),
    mass: r(model.body_mass[b], 6), ipos: [0, 1, 2].map((k) => r(model.body_ipos[3 * b + k])),
    joints,
    // World pose at qpos0 (MJCF reference configuration), used to register CAD parts.
    xpos0: [0, 1, 2].map((k) => r(data.xpos[3 * b + k])), xquat0: [0, 1, 2, 3].map((k) => r(data.xquat[4 * b + k])),
  });
}
const geoms = [];
for (let g = 0; g < model.ngeom; g++) {
  const collides = model.geom_contype[g] !== 0 || model.geom_conaffinity[g] !== 0;
  geoms.push({
    id: g, name: name(model.name_geomadr[g]), body: model.geom_bodyid[g], collides,
    type: ['plane', 'hfield', 'sphere', 'capsule', 'ellipsoid', 'cylinder', 'box', 'mesh', 'sdf'][model.geom_type[g]],
    size: [0, 1, 2].map((k) => r(model.geom_size[3 * g + k])), pos: [0, 1, 2].map((k) => r(model.geom_pos[3 * g + k])),
    quat: [0, 1, 2, 3].map((k) => r(model.geom_quat[4 * g + k])),
    friction: [0, 1, 2].map((k) => r(model.geom_friction[3 * g + k], 6)), priority: model.geom_priority[g], condim: model.geom_condim[g],
    mesh: model.geom_type[g] === 7 ? name(model.name_meshadr[model.geom_dataid[g]]) : null,
  });
}
const sites = [];
for (let s = 0; s < model.nsite; s++) sites.push({ name: name(model.name_siteadr[s]), body: model.site_bodyid[s], pos: [0, 1, 2].map((k) => r(model.site_pos[3 * s + k])) });
const meshFiles = {};
for (const m of xml.matchAll(/<mesh\s+name="([^"]+)"\s+file="([^"]+)"/g)) meshFiles[m[1]] = m[2];

const kin = {
  source: { repository: pin.repository, commit: pin.commit, path: 'sim-model/xmls/asimov_1.xml', sha256: sha, compiledWith: `MuJoCo ${mujoco.mj_versionString()} (mujoco-js 0.0.7)` },
  frame: 'MuJoCo world frame: metres, Z up, X forward (robot faces +X), Y to the robot\'s left',
  timestep: model.opt.timestep,
  totalMass: r(model.body_subtreemass[1], 6),
  nq: model.nq, nv: model.nv, nu: model.nu,
  bodies, geoms, sites, meshFiles,
};
mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/kinematics.json', JSON.stringify(kin, null, 1));

const phys = physicsOnlyXml(xml);
const header = `<!--\n  Derived from ${pin.repository} @ ${pin.commit}\n  sim-model/xmls/asimov_1.xml (sha256 ${sha}), CERN-OHL-S-2.0.\n  Modified by ASIMOV WORKSHOP on 2026-10-09: removed ${phys.removedGeoms} visual mesh geoms (contype 0, conaffinity 0,\n  density 0) and ${phys.removedMeshes} mesh assets, and comments. Dynamics verified bit-identical to the original over\n  3000 steps by tools/check-physics-equivalence.mjs. No other change.\n-->\n`;
mkdirSync('public/sim', { recursive: true });
writeFileSync('public/sim/asimov_1.physics.xml', header + phys.xml.replace(/\n\s*\n+/g, '\n'));
console.log(`kinematics: ${bodies.length} bodies, ${geoms.filter((g) => g.collides).length} collision geoms, total mass ${kin.totalMass} kg`);
console.log(`physics MJCF: removed ${phys.removedGeoms} geoms, ${phys.removedMeshes} meshes`);
