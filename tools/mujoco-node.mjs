// Shared helpers for running mujoco-js 0.0.7 (MuJoCo 3.3.8) in Node.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import loadMujoco from 'mujoco-js';

let mujocoPromise = null;
export function getMujoco() {
  if (!mujocoPromise) {
    mujocoPromise = loadMujoco().then((mujoco) => {
      mujoco.FS.mkdir('/working');
      mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');
      return mujoco;
    });
  }
  return mujocoPromise;
}

/** Same rule as upstream sceneOverlay.js: one <motor> per class="motor" joint, spliced before </mujoco>. */
export function withActuatorOverlay(xml) {
  if (/<actuator[\s>]/.test(xml)) return xml;
  const joints = [];
  for (const [tag] of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<joint\b[^>]*>/g)) {
    if (!/\bclass="motor"/.test(tag)) continue;
    const name = tag.match(/\bname="([^"]+)"/)?.[1];
    if (name) joints.push(name);
  }
  const block = `  <actuator>\n${joints.map((j) => `    <motor name="${j.replace(/_joint$/, '')}" joint="${j}"/>`).join('\n')}\n  </actuator>\n`;
  const closing = xml.lastIndexOf('</mujoco>');
  return xml.slice(0, closing) + block + xml.slice(closing);
}

/** Writes the sim-model folder into MEMFS under /working/<tag>/ and compiles `xml` (a string) there. */
export async function compileModel(simDir, xml, tag = 'm') {
  const mujoco = await getMujoco();
  const root = `/working/${tag}`;
  if (!mujoco.FS.analyzePath(root).exists) {
    mujoco.FS.mkdir(root);
    mujoco.FS.mkdir(`${root}/xmls`);
    mujoco.FS.mkdir(`${root}/assets`);
    mujoco.FS.mkdir(`${root}/assets/meshes`);
    for (const f of readdirSync(join(simDir, 'assets/meshes'))) {
      mujoco.FS.writeFile(`${root}/assets/meshes/${f}`, new Uint8Array(readFileSync(join(simDir, 'assets/meshes', f))));
    }
  }
  mujoco.FS.writeFile(`${root}/xmls/model.xml`, xml);
  const model = mujoco.MjModel.loadFromXML(`${root}/xmls/model.xml`);
  const data = new mujoco.MjData(model);
  return { mujoco, model, data };
}

export function nameReader(model) {
  const names = new TextDecoder().decode(model.names);
  return (adr) => names.slice(adr, names.indexOf('\0', adr));
}
