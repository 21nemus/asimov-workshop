import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { cloneDocument } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import table from '../public/robot/parts.json' with { type: 'json' };
import fixture from './fixtures/thigh-housings.json' with { type: 'json' };

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('public/robot/asimov-cad.glb');

test('every CAD triangle belongs to its complete, contiguous part range', () => {
  let triangles = 0, covered = 0;
  assert.equal(table.parts.length, 1184);
  for (const mesh of doc.getRoot().listMeshes()) {
    const prim = mesh.listPrimitives()[0], positions = prim.getAttribute('POSITION')!, ids = prim.getAttribute('_PART')!;
    const indices = prim.getIndices()!.getArray()!;
    const parts = table.parts.filter(p => p.range.mesh === mesh.getName());
    let end = 0;
    for (const p of parts) {
      assert.equal(p.i, table.parts.indexOf(p));
      assert.equal(p.range.start, end, `${p.name} gap or overlap`);
      assert.equal(p.range.count % 3, 0);
      assert.equal(p.range.count, p.triangles * 3);
      end += p.range.count; covered++;
      for (let j = p.range.start; j < end; j++) {
        const v = indices[j];
        if (!Number.isInteger(v) || v < 0 || v >= positions.getCount()) assert.fail(`${p.name}: invalid index ${v}`);
        if (ids.getScalar(v) !== p.i) assert.fail(`${p.name}: triangle references another part`);
      }
    }
    assert.equal(end, indices.length, `${mesh.getName()}: uncovered indices`);
    triangles += indices.length / 3;
  }
  assert.equal(covered, table.parts.length);
  assert.equal(triangles, table.triangles.shipped);
});

for (const f of fixture.parts) {
  test(`${f.name} remains inside its CAD trim bounds after decoding`, () => {
    const p = table.parts[f.part];
    assert.equal(p.name, f.name); assert.equal(p.body, f.body);
    const node = doc.getRoot().listNodes().find(n => n.getMesh()?.getName() === p.range.mesh)!;
    const prim = node.getMesh()!.listPrimitives()[0], pos = prim.getAttribute('POSITION')!, indices = prim.getIndices()!.getArray()!;
    // Includes the mesh's quantization scale/translation, then reverses the
    // original CAD-to-body registration. Bounds are in original CAD millimetres.
    const toCad = new Matrix4().fromArray(f.cadToBody).invert().multiply(new Matrix4().fromArray(node.getWorldMatrix()));
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], v = new Vector3(), xyz: number[] = [];
    for (const i of new Set<number>(indices.slice(p.range.start, p.range.start + p.range.count))) {
      pos.getElement(i, xyz); v.fromArray(xyz).applyMatrix4(toCad).multiplyScalar(1000);
      for (const [k, x] of v.toArray().entries()) { assert.ok(Number.isFinite(x)); lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x); }
    }
    for (let k = 0; k < 3; k++) {
      assert.ok(lo[k] >= f.boundsMm[k] - fixture.toleranceMm, `${f.name} axis ${k} min ${lo[k]} crosses CAD trim`);
      assert.ok(hi[k] <= f.boundsMm[k + 3] + fixture.toleranceMm, `${f.name} axis ${k} max ${hi[k]} crosses CAD trim`);
      // Also reject empty or substantially truncated housings.
      assert.ok(Math.abs(lo[k] - f.boundsMm[k]) < 0.15, `${f.name} missing lower extent on ${k}`);
      assert.ok(Math.abs(hi[k] - f.boundsMm[k + 3]) < 0.15, `${f.name} missing upper extent on ${k}`);
    }
  });
}

test('meshopt round trip preserves CAD vertices, part identities, transforms and oriented triangles', async () => {
  const copy = cloneDocument(doc);
  const bytes = await io.writeBinary(copy);
  const decoded = await io.readBinary(bytes);
  const meshes = decoded.getRoot().listMeshes();
  for (const [k, mesh] of doc.getRoot().listMeshes().entries()) {
    const a = mesh.listPrimitives()[0], b = meshes[k].listPrimitives()[0];
    assert.deepEqual(a.getAttribute('POSITION')!.getArray(), b.getAttribute('POSITION')!.getArray());
    assert.deepEqual(a.getAttribute('_PART')!.getArray(), b.getAttribute('_PART')!.getArray());
    const ai = a.getIndices()!.getArray()!, bi = b.getIndices()!.getArray()!;
    assert.equal(ai.length, bi.length);
    for (let i = 0; i < ai.length; i += 3) {
      // meshopt may rotate a triangle's starting vertex, preserving winding.
      let equal = false;
      for (let shift = 0; shift < 3; shift++) if ([0, 1, 2].every(j => ai[i + j] === bi[i + (j + shift) % 3])) equal = true;
      if (!equal) assert.fail(`${mesh.getName()}: changed triangle ${i / 3}`);
    }
  }
  assert.deepEqual(doc.getRoot().listNodes().map(n => n.getMatrix()), decoded.getRoot().listNodes().map(n => n.getMatrix()));
  // Exercise an uncompressed glTF representation of the same decoded asset too.
  copy.getRoot().listExtensionsUsed().find(e => e.extensionName === EXTMeshoptCompression.EXTENSION_NAME)!.dispose();
  const plain = await io.readBinary(await io.writeBinary(copy));
  assert.deepEqual(plain.getRoot().listMeshes().map(m => m.listPrimitives()[0].getIndices()!.getArray()), doc.getRoot().listMeshes().map(m => m.listPrimitives()[0].getIndices()!.getArray()));
});
