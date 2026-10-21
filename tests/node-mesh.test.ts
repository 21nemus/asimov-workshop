// UNDERSTAND's simulation view rebuilds the MJCF link meshes from the compressed sim-links.glb.
// Its positions are quantised, so each node's scale and offset must carry over to the new mesh;
// without them every link was drawn 10 to 25 times too large.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { meshFromNode } from '../src/understand/node-mesh.ts';

test('a mesh rebuilt from a node keeps the node transform', () => {
  const scene = new Group();
  const src = new Mesh(new BoxGeometry(2, 2, 2));
  src.position.set(-0.058, 0, -0.012);
  src.scale.setScalar(0.092);
  scene.add(src);
  const mesh = meshFromNode(src, new MeshBasicMaterial());
  assert.ok(mesh.position.distanceTo(new Vector3(-0.058, 0, -0.012)) < 1e-9);
  assert.ok(Math.abs(mesh.scale.x - 0.092) < 1e-9);
  assert.equal(mesh.geometry, src.geometry);
});

test('sim-links.glb is quantised: every node carries a scale below 1', () => {
  const glb = readFileSync('public/robot/sim-links.glb');
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  assert.ok(json.extensionsRequired.includes('KHR_mesh_quantization'));
  for (const node of json.nodes) assert.ok(node.scale && node.scale[0] < 1, node.name);
});
