// Headless probe: loads mujoco-js 0.0.7 in Node, compiles the pinned Asimov MJCF
// (with the upstream viewer's in-memory actuator overlay) and prints model facts.
// Usage: node tools/probe-mujoco.mjs <path-to-sim-model-dir>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import loadMujoco from 'mujoco-js';

const simDir = process.argv[2];
if (!simDir) throw new Error('usage: probe-mujoco.mjs <sim-model dir>');

const mujoco = await loadMujoco();
mujoco.FS.mkdir('/working');
mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');
mujoco.FS.mkdir('/working/xmls');
mujoco.FS.mkdir('/working/assets');
mujoco.FS.mkdir('/working/assets/meshes');
for (const f of readdirSync(join(simDir, 'assets/meshes'))) {
  mujoco.FS.writeFile(`/working/assets/meshes/${f}`, new Uint8Array(readFileSync(join(simDir, 'assets/meshes', f))));
}
let xml = readFileSync(join(simDir, 'xmls/asimov_1.xml'), 'utf8');
// Same overlay rule as upstream sceneOverlay.js: one <motor> per class="motor" joint.
const motorJoints = [];
for (const [tag] of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<joint\b[^>]*>/g)) {
  if (!/\bclass="motor"/.test(tag)) continue;
  motorJoints.push(tag.match(/\bname="([^"]+)"/)[1]);
}
const block = `  <actuator>\n${motorJoints.map((j) => `    <motor name="${j.replace(/_joint$/, '')}" joint="${j}"/>`).join('\n')}\n  </actuator>\n`;
const closing = xml.lastIndexOf('</mujoco>');
xml = xml.slice(0, closing) + block + xml.slice(closing);
mujoco.FS.writeFile('/working/xmls/asimov_1.with-actuators.xml', xml);

const model = mujoco.MjModel.loadFromXML('/working/xmls/asimov_1.with-actuators.xml');
const data = new mujoco.MjData(model);
const names = new TextDecoder().decode(model.names);
const nameAt = (adr) => names.slice(adr, names.indexOf('\0', adr));

console.log('mj_versionString:', mujoco.mj_versionString(), 'mj_version:', mujoco.mj_version());
console.log({ nq: model.nq, nv: model.nv, nu: model.nu, nbody: model.nbody, njnt: model.njnt, ngeom: model.ngeom, nmesh: model.nmesh, nsensor: model.nsensor });
console.log('timestep', model.opt.timestep, 'integrator', model.opt.integrator, 'solver', model.opt.solver, 'iterations', model.opt.iterations, 'cone', model.opt.cone);
let mass = 0;
for (let b = 0; b < model.nbody; b++) mass += model.body_mass[b];
console.log('total mass (kg):', mass.toFixed(4), ' body_subtreemass[1]:', model.body_subtreemass[1].toFixed(4));
const rows = [];
for (let j = 0; j < model.njnt; j++) {
  rows.push({
    j, name: nameAt(model.name_jntadr[j]), type: model.jnt_type[j], qposadr: model.jnt_qposadr[j], dofadr: model.jnt_dofadr[j],
    limited: model.jnt_limited[j], range: [model.jnt_range[2 * j], model.jnt_range[2 * j + 1]],
    axis: [model.jnt_axis[3 * j], model.jnt_axis[3 * j + 1], model.jnt_axis[3 * j + 2]],
    qpos0: model.qpos0[model.jnt_qposadr[j]], armature: model.dof_armature[model.jnt_dofadr[j]], damping: model.dof_damping[model.jnt_dofadr[j]],
  });
}
console.table(rows.map((r) => ({ ...r, range: r.range.map((v) => +v.toFixed(4)).join('..'), axis: r.axis.map((v) => +v.toFixed(4)).join(','), qpos0: +r.qpos0.toFixed(4) })));
const act = [];
for (let a = 0; a < model.nu; a++) act.push({ a, name: nameAt(model.name_actuatoradr[a]), joint: model.actuator_trnid[2 * a], ctrlrange: [model.actuator_ctrlrange[2 * a], model.actuator_ctrlrange[2 * a + 1]].join('..'), ctrllimited: model.actuator_ctrllimited[a], gear: model.actuator_gear[6 * a] });
console.table(act);
const geoms = [];
for (let g = 0; g < model.ngeom; g++) {
  if (model.geom_contype[g] === 0 && model.geom_conaffinity[g] === 0) continue;
  geoms.push({ g, name: nameAt(model.name_geomadr[g]), body: nameAt(model.name_bodyadr[model.geom_bodyid[g]]), type: model.geom_type[g], size: [0, 1, 2].map((i) => +model.geom_size[3 * g + i].toFixed(4)).join(','), friction: [0, 1, 2].map((i) => +model.geom_friction[3 * g + i].toFixed(4)).join(','), priority: model.geom_priority[g], condim: model.geom_condim[g] });
}
console.table(geoms);
mujoco.mj_forward(model, data);
console.log('qpos0 root:', Array.from(data.qpos.slice(0, 7)));
data.delete();
model.delete();
