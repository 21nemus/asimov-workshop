// Policy inference engines. `mlp` is a plain TypeScript forward pass over the checkpoint's
// weights (Gemm + ELU), the engine the app ships. `ort` (policy-engine-ort.ts) is the upstream
// runtime, onnxruntime-web 1.29.0, used by the tests to verify `mlp` and kept out of the app
// bundle (its WebAssembly alone is 14 MB).
import type { MlpLayer, PolicyContract } from './contract.ts';

export interface PolicyEngine {
  readonly kind: 'ort' | 'mlp';
  readonly label: string;
  run(obs: Float32Array): Promise<Float32Array>;
  dispose(): void;
}

export class MlpEngine implements PolicyEngine {
  readonly kind = 'mlp' as const;
  readonly label = 'TypeScript forward pass (verified against ONNX Runtime Web 1.29.0)';
  private readonly layers: { l: MlpLayer; w: Float32Array; b: Float32Array }[];
  private readonly buffers: Float32Array[];

  constructor(contract: PolicyContract, weights: ArrayBuffer) {
    this.layers = contract.mlp.layers.map((l) => ({ l, w: new Float32Array(weights, l.weights, l.in * l.out), b: new Float32Array(weights, l.bias, l.out) }));
    this.buffers = this.layers.map((x) => new Float32Array(x.l.out));
  }

  /** Synchronous inference; float32 storage between layers, float64 accumulation. */
  runSync(obs: Float32Array): Float32Array {
    let input: Float32Array = obs;
    for (let k = 0; k < this.layers.length; k++) {
      const { l, w, b } = this.layers[k];
      const out = this.buffers[k];
      for (let o = 0; o < l.out; o++) {
        let acc = b[o];
        const row = o * l.in;
        for (let i = 0; i < l.in; i++) acc += w[row + i] * input[i];
        if (l.activation) acc = acc > 0 ? acc : l.activation.alpha * (Math.exp(acc) - 1);
        out[o] = acc;
      }
      input = out;
    }
    return new Float32Array(input);
  }

  run(obs: Float32Array): Promise<Float32Array> {
    return Promise.resolve(this.runSync(obs));
  }

  dispose(): void {}
}
