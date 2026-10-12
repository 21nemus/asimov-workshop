// Workshop floor plan (three.js world, metres, Y up). The robot stands at HOME, at the start
// of the test lane, and faces +X down the mat. Inspired by the type of space in Menlo's lab
// photos; not a replica of it.
export const ROOM = {
  backX: -3.6,
  frontX: 4.6,
  leftZ: 4.0, // camera-left when looking at the robot from the front
  rightZ: -4.0, // glass partition side
  height: 3.1,
  /** Lower painted band of the back wall; the pegboard starts above it. */
  wainscot: 1.18,
  pegboardTop: 2.62,
};

/** Black rubber test mat (TEST walking area). */
export const MAT = { minX: -2.4, maxX: 3.6, minZ: -2.0, maxZ: 2.0, tile: 0.5 };

/**
 * Where the simulation's world origin is drawn: the robot's home spot and the TEST start line.
 * The simulated floor is flat and unbounded, so this is a pure display offset.
 */
export const HOME = { x: -1.2, z: 0 };

/** The stretch of mat a TEST run may use before it is paused (display limit, not physics). */
export const TEST_LANE = { endX: MAT.maxX - 0.35, halfWidth: MAT.maxZ - 0.3 };

/** Zones the camera director and modes refer to. */
export const ZONES = {
  robot: HOME,
  assemblyBench: { x: -0.9, z: 3.42, top: 0.92, length: 2.4, depth: 0.74 },
  ankleBench: { x: 2.05, z: -3.42, top: 0.94, length: 1.5, depth: 0.7 },
  gantry: { x: -2.75, z: 2.15 },
  stands: { x: -3.0, z: -3.1 },
  lockers: { x: -3.05, z: 3.62 },
  electronics: { x: -1.35, z: -3.52 },
};
