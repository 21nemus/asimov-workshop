// Robot materials, one per material class. Classes come from the BOM finish column where
// it exists (SOURCE SPEC: the process and finish), with hue and roughness chosen to match
// the supplied lab photos (ILLUSTRATIVE: the exact colour is not specified anywhere).
// Off-the-shelf parts without a finish in the BOM are ILLUSTRATIVE throughout.
import { CanvasTexture, Color, MeshPhysicalMaterial, RepeatWrapping, type Texture } from 'three';

export type MaterialClass =
  | 'pa12-black' | 'shell-paint' | 'al-anodized' | 'slm-steel' | 'stainless-bar' | 'actuator'
  | 'hardware-alu' | 'hardware-steel' | 'fastener-black' | 'zinc-steel' | 'brass' | 'pcb' | 'electronics-dark' | 'unknown';

export interface MaterialInfo {
  label: string;
  /** What the BOM says, or why the look is illustrative. */
  basis: string;
  provenance: 'SOURCE SPEC' | 'ILLUSTRATIVE';
}

export const MATERIAL_INFO: Record<MaterialClass, MaterialInfo> = {
  'pa12-black': { label: 'MJF PA12, dyed black, fine sandblast', basis: 'BOM finish "Dyeing-Dyed Black + Fine Sandblasting"', provenance: 'SOURCE SPEC' },
  'shell-paint': { label: 'MJF PA12, matte spray paint', basis: 'BOM finish "Matte Spray Paint (Brass)"; hue matched to lab photos', provenance: 'SOURCE SPEC' },
  'al-anodized': { label: 'Aluminium 7075, bead blast + anodize', basis: 'BOM finish "Bead Blasting + Anodizing (Brass)"; hue matched to lab photos', provenance: 'SOURCE SPEC' },
  'slm-steel': { label: '316L steel, laser-melted, sandblasted', basis: 'BOM material "SML 316L" (raw text), finish "Sandblasting"', provenance: 'SOURCE SPEC' },
  'stainless-bar': { label: 'Stainless steel 316, sandblasted', basis: 'BOM material "Stainless Steel 316", finish "Sandblasting"', provenance: 'SOURCE SPEC' },
  actuator: { label: 'ENCOS actuator housing', basis: 'Actuator model from the BOM; housing finish not specified', provenance: 'ILLUSTRATIVE' },
  'hardware-alu': { label: 'Aluminium hardware', basis: 'Off-the-shelf part; finish not specified in the BOM', provenance: 'ILLUSTRATIVE' },
  'hardware-steel': { label: 'Steel hardware', basis: 'Off-the-shelf part; finish not specified in the BOM', provenance: 'ILLUSTRATIVE' },
  'fastener-black': { label: 'Socket screw', basis: 'DIN screw from CAD; finish not specified', provenance: 'ILLUSTRATIVE' },
  'zinc-steel': { label: 'Nut or washer', basis: 'DIN nut/washer from CAD; finish not specified', provenance: 'ILLUSTRATIVE' },
  brass: { label: 'Threaded insert or standoff', basis: 'Heat-set insert / standoff from CAD; material not specified', provenance: 'ILLUSTRATIVE' },
  pcb: { label: 'Circuit board', basis: 'Board model from CAD; appearance illustrative', provenance: 'ILLUSTRATIVE' },
  'electronics-dark': { label: 'Electronics', basis: 'Component model from CAD; appearance illustrative', provenance: 'ILLUSTRATIVE' },
  unknown: { label: 'Unclassified part', basis: 'No BOM record matched', provenance: 'ILLUSTRATIVE' },
};

function noiseCanvas(size: number, seed: number, draw: (ctx: CanvasRenderingContext2D, rand: () => number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  draw(ctx, rand);
  return c;
}

/** Fine stochastic bump as a tangent-space normal map (sintered nylon, bead-blasted metal). */
function grainNormalMap(seed: number, strength: number): Texture {
  const size = 256;
  const c = noiseCanvas(size, seed, (ctx, rand) => {
    const img = ctx.createImageData(size, size);
    const h = new Float32Array(size * size);
    for (let i = 0; i < h.length; i++) h[i] = rand();
    // Two box-blur passes give a soft, non-repeating grain.
    const blur = (src: Float32Array) => {
      const out = new Float32Array(src.length);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[((y + dy + size) % size) * size + ((x + dx + size) % size)];
        out[y * size + x] = sum / 9;
      }
      return out;
    };
    const hb = blur(blur(h));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (hb[y * size + ((x + 1) % size)] - hb[y * size + ((x - 1 + size) % size)]) * strength;
      const dy = (hb[((y + 1) % size) * size + x] - hb[((y - 1 + size) % size) * size + x]) * strength;
      const n = Math.hypot(dx, dy, 1);
      img.data[4 * i] = Math.round(((-dx / n) * 0.5 + 0.5) * 255);
      img.data[4 * i + 1] = Math.round(((-dy / n) * 0.5 + 0.5) * 255);
      img.data[4 * i + 2] = Math.round((1 / n) * 255);
      img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Triplanar-free trick: CAD meshes have no UVs, so grain is applied through a world-space hash in the shader. */
function addWorldGrain(m: MeshPhysicalMaterial, scale: number, amount: number): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrainPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGrainPos;
        float grainHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float grainNoise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(grainHash(i), grainHash(i + vec3(1,0,0)), f.x), mix(grainHash(i + vec3(0,1,0)), grainHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(grainHash(i + vec3(0,0,1)), grainHash(i + vec3(1,0,1)), f.x), mix(grainHash(i + vec3(0,1,1)), grainHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float grain = grainNoise(vGrainPos * ${scale.toFixed(1)}) * 0.6 + grainNoise(vGrainPos * ${(scale * 2.7).toFixed(1)}) * 0.4;
        roughnessFactor = clamp(roughnessFactor + (grain - 0.5) * ${amount.toFixed(3)}, 0.04, 1.0);
        diffuseColor.rgb *= 1.0 + (grain - 0.5) * ${(amount * 0.35).toFixed(3)};`);
  };
}

/** Grain normal map for UV-mapped environment props (the CAD meshes carry no UVs). */
export function createGrainNormalMap(seed = 7, strength = 2.2): Texture {
  const t = grainNormalMap(seed, strength);
  t.colorSpace = '';
  return t;
}

export function createRobotMaterials(): Record<MaterialClass, MeshPhysicalMaterial> {
  const srgb = (hex: string) => new Color(hex);
  const make = (p: ConstructorParameters<typeof MeshPhysicalMaterial>[0], grain?: [number, number]) => {
    const m = new MeshPhysicalMaterial(p);
    if (grain) addWorldGrain(m, grain[0], grain[1]);
    return m;
  };
  const mats: Record<MaterialClass, MeshPhysicalMaterial> = {
    'pa12-black': make({ color: srgb('#1d1e21'), roughness: 0.74, metalness: 0, sheen: 0.35, sheenRoughness: 0.75, sheenColor: srgb('#4a4c52') }, [1900, 0.12]),
    'shell-paint': make({ color: srgb('#cf6524'), roughness: 0.5, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.55, sheen: 0.15, sheenColor: srgb('#ffb27a'), sheenRoughness: 0.6 }, [900, 0.06]),
    'al-anodized': make({ color: srgb('#c45f22'), roughness: 0.36, metalness: 0.78, clearcoat: 0.08 }, [2600, 0.14]),
    'slm-steel': make({ color: srgb('#8f9296'), roughness: 0.5, metalness: 1 }, [2600, 0.16]),
    'stainless-bar': make({ color: srgb('#b1b4b8'), roughness: 0.32, metalness: 1 }, [3000, 0.1]),
    actuator: make({ color: srgb('#2a2c30'), roughness: 0.42, metalness: 0.65 }, [2200, 0.08]),
    'hardware-alu': make({ color: srgb('#bcbfc3'), roughness: 0.33, metalness: 1 }, [2600, 0.08]),
    'hardware-steel': make({ color: srgb('#8b8d91'), roughness: 0.38, metalness: 1 }),
    'fastener-black': make({ color: srgb('#202022'), roughness: 0.4, metalness: 0.75 }),
    'zinc-steel': make({ color: srgb('#a9abae'), roughness: 0.42, metalness: 1 }),
    brass: make({ color: srgb('#b7924f'), roughness: 0.38, metalness: 1 }),
    pcb: make({ color: srgb('#1f4b34'), roughness: 0.55, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    'electronics-dark': make({ color: srgb('#1e1f22'), roughness: 0.6, metalness: 0.1 }),
    unknown: make({ color: srgb('#7a7d82'), roughness: 0.6, metalness: 0.2 }),
  };
  for (const [k, m] of Object.entries(mats)) m.name = `robot:${k}`;
  return mats;
}
