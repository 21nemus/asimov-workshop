// The upstream policy runtime: onnxruntime-web 1.29.0, CPU wasm, graph optimisation 'all',
// exactly as the viewer creates its session. Used by the tests to verify the TypeScript engine
// and by the upstream harness; not part of the app bundle.
import type { PolicyEngine } from './policy-engine.ts';

type OrtModule = typeof import('onnxruntime-web/wasm');

export class OrtEngine implements PolicyEngine {
  readonly kind = 'ort' as const;
  readonly label = 'ONNX Runtime Web 1.29.0 (wasm, CPU): the upstream viewer runtime';
  private readonly ort: OrtModule;
  private readonly session: import('onnxruntime-web').InferenceSession;

  private constructor(ort: OrtModule, session: import('onnxruntime-web').InferenceSession) {
    this.ort = ort;
    this.session = session;
  }

  static async create(onnxBytes: ArrayBuffer, configure?: (ort: OrtModule) => void): Promise<OrtEngine> {
    const ort = await import('onnxruntime-web/wasm');
    configure?.(ort);
    const session = await ort.InferenceSession.create(onnxBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const inMeta = session.inputMetadata?.[0] as { shape?: unknown[] } | undefined;
    const outMeta = session.outputMetadata?.[0] as { shape?: unknown[] } | undefined;
    if (session.inputNames.length !== 1 || session.outputNames.length !== 1) throw new Error('the policy has extra inputs or outputs (recurrent state is not supported here)');
    if (inMeta?.shape && inMeta.shape.at(-1) !== 78) throw new Error(`the policy takes ${String(inMeta.shape.at(-1))} inputs, expected 78`);
    if (outMeta?.shape && outMeta.shape.at(-1) !== 23) throw new Error(`the policy outputs ${String(outMeta.shape.at(-1))} actions, expected 23`);
    return new OrtEngine(ort, session);
  }

  async run(obs: Float32Array): Promise<Float32Array> {
    const input = new this.ort.Tensor('float32', obs, [1, obs.length]);
    const out = await this.session.run({ [this.session.inputNames[0]]: input });
    return out[this.session.outputNames[0]].data as Float32Array;
  }

  dispose(): void {
    void this.session.release();
  }
}
