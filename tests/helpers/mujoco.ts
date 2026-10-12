// Test helper: compiles the shipped physics-only MJCF with mujoco-js in Node.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface MjHandle {
  mujoco: any;
  model: any;
  data: any;
}

let cached: Promise<any> | null = null;

export async function loadMujocoNode(): Promise<any> {
  if (!cached) {
    cached = (async () => {
      const mod = await import('mujoco-js');
      const mujoco = await (mod.default as any)();
      mujoco.FS.mkdir('/working');
      mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');
      return mujoco;
    })();
  }
  return cached;
}

export async function compileShipped(withActuators = true): Promise<MjHandle> {
  const mujoco = await loadMujocoNode();
  let xml = readFileSync(new URL('../../public/sim/asimov_1.physics.xml', import.meta.url), 'utf8');
  if (withActuators) {
    const { withActuatorOverlay } = await import('../../src/simulation/model-overlay.ts');
    xml = withActuatorOverlay(xml);
  }
  const name = `/working/t${Math.random().toString(36).slice(2)}.xml`;
  mujoco.FS.writeFile(name, xml);
  const model = mujoco.MjModel.loadFromXML(name);
  const data = new mujoco.MjData(model);
  return { mujoco, model, data };
}

export { require };
