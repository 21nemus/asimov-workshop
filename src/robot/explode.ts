// Exploded view: bodies move out from the robot's centre and parts out from their body's centre.
// Offsets are per part, in each part's body frame, for the current display pose.
import { Quaternion, Vector3 } from 'three';
import type { RobotModel } from './robot-model.ts';

export function explodeVectors(robot: RobotModel, bodySpread = 0.7, partSpread = 1.6): Float32Array {
  const out = new Float32Array(robot.parts.length * 3);
  const bodyCentre = new Map<string, Vector3>();
  for (const [name, list] of robot.byBody) {
    const c = new Vector3();
    for (const p of list) c.add(robot.partWorldCenter(p, new Vector3()));
    bodyCentre.set(name, c.divideScalar(list.length));
  }
  const centre = new Vector3();
  for (const c of bodyCentre.values()) centre.add(c);
  centre.divideScalar(bodyCentre.size);
  const q = new Quaternion();
  for (const p of robot.parts) {
    const bc = bodyCentre.get(p.body)!;
    const world = bc.clone().sub(centre).multiplyScalar(bodySpread).add(robot.partWorldCenter(p, new Vector3()).sub(bc).multiplyScalar(partSpread));
    robot.rig.body(p.body).content.getWorldQuaternion(q);
    world.applyQuaternion(q.invert());
    out.set([world.x, world.y, world.z], 3 * p.i);
  }
  return out;
}

export function applyExplode(robot: RobotModel, dirs: Float32Array, e: number): void {
  for (const p of robot.parts) robot.state.setOffset(p.i, dirs[3 * p.i] * e, dirs[3 * p.i + 1] * e, dirs[3 * p.i + 2] * e);
}
