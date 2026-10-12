// Per-part render state for the merged CAD meshes. Every vertex carries the index of the
// physical part it belongs to (_PART). Two small textures, indexed by part, tell the
// shaders whether a part is visible, highlighted or ghosted, and how far it is displaced
// (exploded views, BUILD staging). One texture write updates any number of parts.
import { DataTexture, FloatType, HalfFloatType, NearestFilter, RGBAFormat, UnsignedByteType, Vector2, type Material, type WebGLProgramParametersWithUniforms } from 'three';

export const PART_TEX_WIDTH = 64;

export class PartState {
  readonly count: number;
  readonly size: Vector2;
  readonly state: DataTexture;
  readonly offset: DataTexture;
  private readonly stateData: Uint8Array;
  private readonly offsetData: Float32Array;
  private dirtyState = false;
  private dirtyOffset = false;

  constructor(count: number, halfFloat = false) {
    this.count = count;
    const h = Math.max(1, Math.ceil(count / PART_TEX_WIDTH));
    this.size = new Vector2(PART_TEX_WIDTH, h);
    this.stateData = new Uint8Array(PART_TEX_WIDTH * h * 4);
    for (let i = 0; i < count; i++) this.stateData[4 * i] = 255; // visible by default
    this.state = new DataTexture(this.stateData, PART_TEX_WIDTH, h, RGBAFormat, UnsignedByteType);
    this.state.magFilter = this.state.minFilter = NearestFilter;
    this.state.needsUpdate = true;
    this.offsetData = new Float32Array(PART_TEX_WIDTH * h * 4);
    this.offset = new DataTexture(this.offsetData, PART_TEX_WIDTH, h, RGBAFormat, halfFloat ? HalfFloatType : FloatType);
    this.offset.magFilter = this.offset.minFilter = NearestFilter;
    this.offset.needsUpdate = true;
  }

  setVisible(i: number, v: boolean): void {
    const val = v ? 255 : 0;
    if (this.stateData[4 * i] !== val) { this.stateData[4 * i] = val; this.dirtyState = true; }
  }
  isVisible(i: number): boolean { return this.stateData[4 * i] > 127; }

  setHighlight(i: number, amount: number): void {
    const val = Math.round(Math.max(0, Math.min(1, amount)) * 255);
    if (this.stateData[4 * i + 1] !== val) { this.stateData[4 * i + 1] = val; this.dirtyState = true; }
  }

  setGhost(i: number, v: boolean): void {
    const val = v ? 255 : 0;
    if (this.stateData[4 * i + 2] !== val) { this.stateData[4 * i + 2] = val; this.dirtyState = true; }
  }
  isGhost(i: number): boolean { return this.stateData[4 * i + 2] > 127; }

  /** Dims a part (0 = normal, 1 = strongly faded toward the backdrop) for focus views. */
  setDim(i: number, amount: number): void {
    const val = Math.round(Math.max(0, Math.min(1, amount)) * 255);
    if (this.stateData[4 * i + 3] !== val) { this.stateData[4 * i + 3] = val; this.dirtyState = true; }
  }

  setOffset(i: number, x: number, y: number, z: number): void {
    const o = 4 * i;
    if (this.offsetData[o] !== x || this.offsetData[o + 1] !== y || this.offsetData[o + 2] !== z) {
      this.offsetData[o] = x; this.offsetData[o + 1] = y; this.offsetData[o + 2] = z;
      this.dirtyOffset = true;
    }
  }
  getOffset(i: number): [number, number, number] {
    return [this.offsetData[4 * i], this.offsetData[4 * i + 1], this.offsetData[4 * i + 2]];
  }

  setAll(fn: (i: number) => { visible?: boolean; highlight?: number; ghost?: boolean; dim?: number }): void {
    for (let i = 0; i < this.count; i++) {
      const s = fn(i);
      if (s.visible !== undefined) this.setVisible(i, s.visible);
      if (s.highlight !== undefined) this.setHighlight(i, s.highlight);
      if (s.ghost !== undefined) this.setGhost(i, s.ghost);
      if (s.dim !== undefined) this.setDim(i, s.dim);
    }
  }

  /** Pushes pending changes to the GPU. Call once per frame. */
  flush(): void {
    if (this.dirtyState) { this.state.needsUpdate = true; this.dirtyState = false; }
    if (this.dirtyOffset) { this.offset.needsUpdate = true; this.dirtyOffset = false; }
  }

  uniforms() {
    return { partState: { value: this.state }, partOffset: { value: this.offset }, partTexSize: { value: this.size } };
  }
}

const VERTEX_HEAD = /* glsl */ `
attribute float _part;
uniform sampler2D partState;
uniform sampler2D partOffset;
uniform vec2 partTexSize;
varying float vPartHighlight;
varying float vPartDim;
`;
const VERTEX_BODY = /* glsl */ `
vec2 partUv = (vec2(mod(_part, partTexSize.x), floor(_part / partTexSize.x)) + 0.5) / partTexSize;
vec4 pState = texture2D(partState, partUv);
// Offsets are stored in body-frame metres. Quantised meshes carry a uniform dequantisation
// scale (and no rotation) in their model matrix, so divide it out to move in object space.
transformed += texture2D(partOffset, partUv).xyz / length(modelMatrix[0].xyz);
vPartHighlight = pState.g;
vPartDim = pState.a;
float pHidden = PART_HIDDEN_EXPR;
`;
const VERTEX_TAIL = /* glsl */ `
if (pHidden > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
`;

export interface PartShaderOptions {
  /** GLSL expression over pState deciding when a vertex is culled. */
  hiddenExpr?: string;
  highlightColor?: [number, number, number];
  /** Adds highlight/dim terms to the fragment shader (lit materials only). */
  shade?: boolean;
}

/** Patches a built-in material so it reads the part-state textures. */
export function applyPartShader(material: Material, state: PartState, opts: PartShaderOptions = {}): void {
  const hidden = opts.hiddenExpr ?? 'step(pState.r, 0.5)';
  // Attention blue: distinct from the robot's own orange, black and steel.
  const hl = opts.highlightColor ?? [0.16, 0.46, 1.0];
  const shade = opts.shade ?? true;
  const uniforms = state.uniforms();
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY.replace('PART_HIDDEN_EXPR', hidden)}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_TAIL}`);
    if (shade) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vPartHighlight;\nvarying float vPartDim;\n`)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${hl.join(', ')}), vPartHighlight * 0.55);
          totalEmissiveRadiance += vec3(${hl.join(', ')}) * vPartHighlight * 0.22;`,
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.86, 0.85, 0.83), vPartDim * 0.82);`,
        );
    }
  };
  material.customProgramCacheKey = () => `part-shader:${hidden}:${shade}`;
  material.needsUpdate = true;
}
