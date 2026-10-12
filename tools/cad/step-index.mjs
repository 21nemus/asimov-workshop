// Minimal ISO-10303-21 (STEP) indexer for very large files.
//
// It records where every entity starts and ends (byte offsets into one Buffer) and
// its type, without materialising the geometry. Structural entities are parsed on
// demand by the callers (assembly tree, transforms, colours, per-product closure).
// Built for the 520 MB SolidWorks AP214 export of the Asimov 1 full-body assembly,
// which does not fit through OpenCascade in one pass on an 8 GB machine.
import { readFileSync } from 'node:fs';

const HASH = 0x23, SEMI = 0x3b, QUOTE = 0x27, NL = 0x0a, CR = 0x0d, SPACE = 0x20, EQ = 0x3d, LPAREN = 0x28;

export class StepIndex {
  constructor(path) {
    this.path = path;
    this.buf = readFileSync(path);
    const buf = this.buf;
    // First pass: find the DATA section and the largest id so typed arrays can be sized.
    const dataAt = buf.indexOf('\nDATA;');
    if (dataAt < 0) throw new Error('no DATA section');
    this.headerText = buf.subarray(0, dataAt + 1).toString('latin1');
    let maxId = 0;
    const starts = [];
    for (let i = dataAt + 6; i < buf.length; i++) {
      if (buf[i] === HASH && (buf[i - 1] === NL || buf[i - 1] === CR)) {
        let id = 0, j = i + 1;
        while (buf[j] >= 0x30 && buf[j] <= 0x39) id = id * 10 + (buf[j++] - 0x30);
        if (id > maxId) maxId = id;
        starts.push(i);
        // Skip to the end of this entity (a ';' outside quotes).
        let inStr = false;
        for (; j < buf.length; j++) {
          const c = buf[j];
          if (c === QUOTE) inStr = !inStr;
          else if (c === SEMI && !inStr) break;
        }
        i = j;
      }
    }
    this.maxId = maxId;
    this.start = new Uint32Array(maxId + 1);
    this.end = new Uint32Array(maxId + 1);
    this.type = new Uint16Array(maxId + 1);
    this.typeNames = [''];
    const typeCode = new Map();
    for (const s of starts) {
      let id = 0, j = s + 1;
      while (buf[j] >= 0x30 && buf[j] <= 0x39) id = id * 10 + (buf[j++] - 0x30);
      while (buf[j] === SPACE || buf[j] === EQ) j++;
      let name;
      if (buf[j] === LPAREN) name = '(COMPLEX)';
      else {
        let k = j;
        while ((buf[k] >= 0x41 && buf[k] <= 0x5a) || buf[k] === 0x5f || (buf[k] >= 0x30 && buf[k] <= 0x39)) k++;
        name = buf.toString('latin1', j, k);
      }
      let code = typeCode.get(name);
      if (code === undefined) { code = this.typeNames.length; this.typeNames.push(name); typeCode.set(name, code); }
      let inStr = false, k = j;
      for (; k < buf.length; k++) {
        const c = buf[k];
        if (c === QUOTE) inStr = !inStr;
        else if (c === SEMI && !inStr) break;
      }
      this.start[id] = s;
      this.end[id] = k + 1;
      this.type[id] = code;
    }
    this.count = starts.length;
  }

  typeOf(id) { return this.typeNames[this.type[id]]; }
  has(id) { return id > 0 && id <= this.maxId && this.end[id] > 0; }
  text(id) { return this.buf.toString('latin1', this.start[id], this.end[id]); }
  /** Parameter text: everything after "#id = " up to and excluding the final ';'. */
  body(id) {
    const t = this.text(id);
    return t.slice(t.indexOf('=') + 1, t.lastIndexOf(';')).trim();
  }
  /** Every #reference inside an entity, in order. */
  refs(id) {
    const out = [];
    const buf = this.buf;
    let j = this.start[id] + 1;
    while (buf[j] >= 0x30 && buf[j] <= 0x39) j++;
    let inStr = false;
    for (const e = this.end[id]; j < e; j++) {
      const c = buf[j];
      if (c === QUOTE) inStr = !inStr;
      else if (c === HASH && !inStr) {
        let v = 0, k = j + 1;
        while (buf[k] >= 0x30 && buf[k] <= 0x39) v = v * 10 + (buf[k++] - 0x30);
        out.push(v);
        j = k - 1;
      }
    }
    return out;
  }
  idsOfType(name) {
    const code = this.typeNames.indexOf(name);
    const out = [];
    if (code < 0) return out;
    for (let id = 1; id <= this.maxId; id++) if (this.type[id] === code) out.push(id);
    return out;
  }
}

/** Parses a STEP parameter list into nested JS values: strings, numbers, refs {ref}, enums {enum}, null for $ and *. */
export function parseParams(text) {
  let i = 0;
  const s = text;
  function ws() { while (i < s.length && /\s/.test(s[i])) i++; }
  function value() {
    ws();
    const c = s[i];
    if (c === '(') {
      i++;
      const list = [];
      ws();
      if (s[i] === ')') { i++; return list; }
      for (;;) {
        list.push(value());
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ')') { i++; return list; }
        throw new Error(`bad list at ${i}: ${s.slice(i, i + 40)}`);
      }
    }
    if (c === "'") {
      let out = '';
      i++;
      for (;;) {
        if (s[i] === "'" && s[i + 1] === "'") { out += "'"; i += 2; continue; }
        if (s[i] === "'") { i++; break; }
        out += s[i++];
      }
      return out;
    }
    if (c === '#') {
      i++;
      let n = '';
      while (/[0-9]/.test(s[i])) n += s[i++];
      return { ref: Number(n) };
    }
    if (c === '.') {
      i++;
      let n = '';
      while (s[i] !== '.') n += s[i++];
      i++;
      return { enum: n };
    }
    if (c === '$' || c === '*') { i++; return null; }
    // Typed parameter such as LENGTH_MEASURE(1.0) or a bare number.
    let tok = '';
    while (i < s.length && /[A-Za-z0-9_.+\-Ee]/.test(s[i])) tok += s[i++];
    ws();
    if (s[i] === '(') {
      const inner = value();
      return { typed: tok, value: inner };
    }
    const n = Number(tok);
    if (Number.isFinite(n)) return n;
    throw new Error(`bad token ${tok} at ${i}`);
  }
  return value();
}

/** For a simple entity "TYPE ( ... )" returns [TYPE, params[]]. */
export function simpleEntity(index, id) {
  const b = index.body(id);
  const p = b.indexOf('(');
  return [b.slice(0, p).trim(), parseParams(b.slice(p))];
}

/** For a complex entity "( A(...) B(...) )" returns a map of partial entity name -> params[]. */
export function complexEntity(index, id) {
  const b = index.body(id);
  const out = {};
  let i = b.indexOf('(') + 1;
  while (i < b.length) {
    while (i < b.length && /\s/.test(b[i])) i++;
    if (b[i] === ')') break;
    let name = '';
    while (/[A-Z0-9_]/.test(b[i])) name += b[i++];
    while (/\s/.test(b[i])) i++;
    // Match the parenthesised parameter list.
    let depth = 0, j = i, inStr = false;
    for (; j < b.length; j++) {
      const c = b[j];
      if (c === "'") inStr = !inStr;
      else if (!inStr && c === '(') depth++;
      else if (!inStr && c === ')') { depth--; if (depth === 0) break; }
    }
    out[name] = parseParams(b.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}
