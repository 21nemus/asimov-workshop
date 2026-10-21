// A mesh rebuilt from a glTF node's geometry. The compressed GLBs use KHR_mesh_quantization: their
// positions are stored as small integers and each node carries the scale and offset that turn them
// back into metres, so the new mesh must take over the node's transform along with its geometry.
import { Mesh, type Material } from 'three';

export function meshFromNode(src: Mesh, material: Material): Mesh {
  const mesh = new Mesh(src.geometry, material);
  src.updateWorldMatrix(true, false);
  mesh.applyMatrix4(src.matrixWorld);
  return mesh;
}
