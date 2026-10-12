// Workshop lighting: overhead LED panels (rect area lights for soft speculars on metal),
// one shadow-casting key light for grounding, a hemisphere fill and a prefiltered
// environment for reflections. Bright and practical, no coloured mood lighting.
import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  RectAreaLight,
  Scene,
  type WebGLRenderer,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ROOM } from './layout.ts';

export interface Lighting {
  group: Group;
  key: DirectionalLight;
  /** Re-aims the shadow frustum at a point (the robot may walk across the mat). */
  follow(x: number, z: number): void;
  setQuality(level: 'high' | 'low'): void;
}

export function createLighting(scene: Scene, renderer: WebGLRenderer): Lighting {
  RectAreaLightUniformsLib.init();
  const group = new Group();
  group.name = 'lighting';

  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.38;
  pmrem.dispose();

  const hemi = new HemisphereLight(new Color('#f6f3ec'), new Color('#4a4642'), 0.42);
  group.add(hemi);

  // Ceiling LED panels: emissive faces plus rect area lights pointing down.
  const panelMat = new MeshBasicMaterial({ color: new Color('#ffffff') });
  const panels: [number, number][] = [[-1.6, 1.4], [-1.6, -1.4], [0.9, 1.4], [0.9, -1.4], [3.2, 0], [-1.6, 3.2], [0.9, -3.2]];
  for (const [x, z] of panels) {
    const face = new Mesh(new PlaneGeometry(0.6, 1.2), panelMat);
    face.rotation.x = Math.PI / 2;
    face.position.set(x, ROOM.height - 0.01, z);
    group.add(face);
  }
  for (const [x, z] of [[-1.6, 1.4], [-1.6, -1.4], [0.9, 1.4], [0.9, -1.4]] as [number, number][]) {
    const area = new RectAreaLight(new Color('#fff8ef'), 3.4, 0.6, 1.2);
    area.position.set(x, ROOM.height - 0.02, z);
    area.lookAt(x, 0, z);
    group.add(area);
  }

  // Key light: high and slightly in front of the robot, casting the grounding shadow.
  const key = new DirectionalLight(new Color('#fff3e2'), 2.25);
  key.position.set(2.2, 5.0, 1.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const cam = key.shadow.camera;
  cam.left = -1.4; cam.right = 1.4; cam.top = 1.4; cam.bottom = -1.4; cam.near = 1; cam.far = 9;
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 4;
  key.target.position.set(0, 0.5, 0);
  group.add(key, key.target);

  // Rim light from high behind the robot: separates the black parts from the walls.
  const rim = new DirectionalLight(new Color('#dfe9ff'), 0.9);
  rim.position.set(-6, 4.2, -2.5);
  group.add(rim);

  // Window daylight through the glass partition: cool and soft, no shadow.
  const day = new DirectionalLight(new Color('#e6eefb'), 0.45);
  day.position.set(0.5, 2.2, -6);
  group.add(day);

  scene.add(group);
  return {
    group,
    key,
    follow(x, z) {
      key.position.set(x + 2.2, 5.0, z + 1.4);
      key.target.position.set(x, 0.5, z);
      key.target.updateMatrixWorld();
    },
    setQuality(level) {
      key.shadow.mapSize.set(level === 'high' ? 2048 : 1024, level === 'high' ? 2048 : 1024);
      key.shadow.map?.dispose();
      key.shadow.map = null as never;
    },
  };
}
