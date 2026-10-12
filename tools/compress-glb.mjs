#!/usr/bin/env node
// Re-encodes a glTF with EXT_meshopt_compression using meshopt filters (octahedral normals),
// keeping vertex and index order unchanged (per-part draw ranges are index ranges).
// Usage: node tools/compress-glb.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { statSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: compress-glb.mjs in.glb out.glb');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const before = doc.getRoot().listMeshes().map((m) => m.listPrimitives().map((p) => [p.getAttribute('POSITION').getCount(), p.getIndices()?.getCount() ?? 0]));
if (!doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_mesh_quantization')) {
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeGeneric: 16 }));
}
doc.createExtension(KHRMeshQuantization).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(output, doc);
const after = (await io.read(output)).getRoot().listMeshes().map((m) => m.listPrimitives().map((p) => [p.getAttribute('POSITION').getCount(), p.getIndices()?.getCount() ?? 0]));
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('vertex or index counts changed');
console.log(`${input} ${(statSync(input).size / 1024).toFixed(0)} KB -> ${output} ${(statSync(output).size / 1024).toFixed(0)} KB`);
