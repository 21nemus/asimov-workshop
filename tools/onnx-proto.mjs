// Minimal ONNX ModelProto reader (protobuf wire format), enough to list the graph,
// its tensors and metadata without extra dependencies. Field numbers follow onnx.proto.
const TYPES = { 1: 'float32', 2: 'uint8', 3: 'int8', 6: 'int32', 7: 'int64', 9: 'bool', 10: 'float16', 11: 'float64' };

function reader(buf) {
  let pos = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  function varint() {
    let result = 0n, shift = 0n;
    for (;;) {
      const b = buf[pos++];
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7n;
    }
    return result;
  }
  function* fields() {
    while (pos < buf.length) {
      const key = Number(varint());
      const field = key >>> 3, wire = key & 7;
      if (wire === 0) yield [field, varint()];
      else if (wire === 1) { const v = view.getFloat64(pos, true); pos += 8; yield [field, v]; }
      else if (wire === 2) { const len = Number(varint()); const sub = buf.subarray(pos, pos + len); pos += len; yield [field, sub]; }
      else if (wire === 5) { const v = view.getFloat32(pos, true); pos += 4; yield [field, v]; }
      else throw new Error(`wire type ${wire}`);
    }
  }
  return { fields };
}
const str = (b) => new TextDecoder().decode(b);

function parseDim(b) {
  const d = {};
  for (const [f, v] of reader(b).fields()) { if (f === 1) d.value = Number(v); if (f === 2) d.param = str(v); }
  return d.value ?? d.param ?? '?';
}
function parseValueInfo(b) {
  const out = { name: '', type: null, shape: [] };
  for (const [f, v] of reader(b).fields()) {
    if (f === 1) out.name = str(v);
    if (f === 2) for (const [tf, tv] of reader(v).fields()) {
      if (tf === 1) for (const [ttf, ttv] of reader(tv).fields()) {
        if (ttf === 1) out.type = TYPES[Number(ttv)] ?? Number(ttv);
        if (ttf === 2) for (const [sf, sv] of reader(ttv).fields()) if (sf === 1) out.shape.push(parseDim(sv));
      }
    }
  }
  return out;
}
function parseTensor(b) {
  const t = { name: '', dims: [], type: null, raw: null, floats: [] };
  for (const [f, v] of reader(b).fields()) {
    if (f === 1) t.dims.push(Number(v));
    if (f === 2) t.type = TYPES[Number(v)] ?? Number(v);
    if (f === 8) t.name = str(v);
    if (f === 9) t.raw = v;
    if (f === 4) {
      if (v instanceof Uint8Array) { const dv = new DataView(v.buffer, v.byteOffset, v.byteLength); for (let i = 0; i < v.byteLength; i += 4) t.floats.push(dv.getFloat32(i, true)); }
      else t.floats.push(v);
    }
    if (f === 7) t.int64 = (t.int64 ?? []).concat(v instanceof Uint8Array ? [] : [Number(v)]);
  }
  if (t.raw && t.type === 'float32') {
    const copy = new Uint8Array(t.raw);
    t.data = new Float32Array(copy.buffer, 0, copy.byteLength / 4);
  } else if (t.floats.length) t.data = Float32Array.from(t.floats);
  if (t.raw && t.type === 'int64') {
    const copy = new Uint8Array(t.raw);
    t.data = Array.from(new BigInt64Array(copy.buffer, 0, copy.byteLength / 8), Number);
  }
  return t;
}
function parseAttribute(b) {
  const a = { name: '' };
  for (const [f, v] of reader(b).fields()) {
    if (f === 1) a.name = str(v);
    if (f === 2) a.f = v;
    if (f === 3) a.i = Number(v);
    if (f === 4) a.s = str(v);
    if (f === 5) a.t = parseTensor(v);
    if (f === 20) a.type = Number(v);
  }
  return a;
}
function parseNode(b) {
  const n = { inputs: [], outputs: [], name: '', op: '', attrs: [] };
  for (const [f, v] of reader(b).fields()) {
    if (f === 1) n.inputs.push(str(v));
    if (f === 2) n.outputs.push(str(v));
    if (f === 3) n.name = str(v);
    if (f === 4) n.op = str(v);
    if (f === 5) n.attrs.push(parseAttribute(v));
  }
  return n;
}
export function parseModel(buf) {
  const model = { opsets: [], metadata: {}, graph: { nodes: [], initializers: [], inputs: [], outputs: [] } };
  for (const [f, v] of reader(buf).fields()) {
    if (f === 1) model.irVersion = Number(v);
    if (f === 2) model.producerName = str(v);
    if (f === 3) model.producerVersion = str(v);
    if (f === 4) model.domain = str(v);
    if (f === 5) model.modelVersion = Number(v);
    if (f === 6) model.docString = str(v);
    if (f === 8) { const o = {}; for (const [of, ov] of reader(v).fields()) { if (of === 1) o.domain = str(ov); if (of === 2) o.version = Number(ov); } model.opsets.push(o); }
    if (f === 14) { let k = '', val = ''; for (const [mf, mv] of reader(v).fields()) { if (mf === 1) k = str(mv); if (mf === 2) val = str(mv); } model.metadata[k] = val; }
    if (f === 7) for (const [gf, gv] of reader(v).fields()) {
      if (gf === 1) model.graph.nodes.push(parseNode(gv));
      if (gf === 2) model.graph.name = str(gv);
      if (gf === 5) model.graph.initializers.push(parseTensor(gv));
      if (gf === 11) model.graph.inputs.push(parseValueInfo(gv));
      if (gf === 12) model.graph.outputs.push(parseValueInfo(gv));
    }
  }
  return model;
}
