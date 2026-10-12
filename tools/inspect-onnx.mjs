// Inspects the bundled Asimov checkpoint: ONNX graph structure from the protobuf,
// then the same model through ONNX Runtime Web 1.29.0 (wasm backend, in Node) for the
// signatures the browser runtime reports and a deterministic test inference.
// Usage: node tools/inspect-onnx.mjs <policy.onnx>
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ort from 'onnxruntime-web';
import { parseModel } from './onnx-proto.mjs';

const path = process.argv[2];
const bytes = readFileSync(path);
console.log('sha256', createHash('sha256').update(bytes).digest('hex'), 'bytes', bytes.length);
const model = parseModel(new Uint8Array(bytes));
console.log('ir_version', model.irVersion, 'producer', model.producerName, model.producerVersion, 'opsets', JSON.stringify(model.opsets));
console.log('metadata_props', model.metadata);
console.log('doc', model.docString ?? '(none)');
const initNames = new Set(model.graph.initializers.map((t) => t.name));
console.log('graph inputs', model.graph.inputs.filter((i) => !initNames.has(i.name)));
console.log('graph outputs', model.graph.outputs);
const ops = new Map();
for (const n of model.graph.nodes) ops.set(n.op, (ops.get(n.op) ?? 0) + 1);
console.log('ops', Object.fromEntries(ops));
for (const n of model.graph.nodes) console.log(`  ${n.op.padEnd(10)} ${n.inputs.join(', ')} -> ${n.outputs.join(', ')} ${n.attrs.map((a) => `${a.name}=${a.f ?? a.i ?? a.s ?? (a.t ? `tensor${JSON.stringify(a.t.dims)}` : '')}`).join(' ')}`);
for (const t of model.graph.initializers) {
  const d = t.data;
  let stats = '';
  if (d && typeof d[0] === 'number' && d.length) {
    let mn = Infinity, mx = -Infinity, s = 0;
    for (const v of d) { mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; }
    stats = `min ${mn.toFixed(4)} max ${mx.toFixed(4)} mean ${(s / d.length).toFixed(5)}`;
  }
  console.log(`  init ${t.name} ${t.type} [${t.dims}] ${stats}`);
}

ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
console.log('ORT inputNames', session.inputNames, 'outputNames', session.outputNames);
console.log('ORT inputMetadata', JSON.stringify(session.inputMetadata));
console.log('ORT outputMetadata', JSON.stringify(session.outputMetadata));
// Deterministic probes: zeros, and an upright standing observation (gravity -1 on z, everything else zero).
for (const [label, fill] of [['zeros', () => 0], ['upright', (i) => (i === 5 ? -1 : 0)]]) {
  const obs = Float32Array.from({ length: 78 }, (_, i) => fill(i));
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', obs, [1, 78]) });
  const a = out[session.outputNames[0]];
  console.log(`action(${label}) dims ${a.dims}:`, Array.from(a.data).map((v) => +v.toFixed(5)).join(' '));
}
