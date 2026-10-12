// Test helper: builds a Controller on the shipped physics MJCF with either inference engine.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileShipped } from './mujoco.ts';
import { Controller } from '../../src/simulation/controller.ts';
import { MlpEngine, type PolicyEngine } from '../../src/simulation/policy-engine.ts';
import { OrtEngine } from '../../src/simulation/policy-engine-ort.ts';
import type { PolicyContract } from '../../src/simulation/contract.ts';

const POLICY = new URL('../../public/policy/model_aug_18_1/', import.meta.url);

export function loadContractNode(): PolicyContract {
  return JSON.parse(readFileSync(new URL('contract.json', POLICY), 'utf8')) as PolicyContract;
}

export async function makeEngine(kind: 'ort' | 'mlp', contract: PolicyContract): Promise<PolicyEngine> {
  if (kind === 'mlp') {
    const b = readFileSync(new URL('mlp.bin', POLICY));
    return new MlpEngine(contract, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  const b = readFileSync(new URL('policy.onnx', POLICY));
  const ortDist = fileURLToPath(new URL('../../node_modules/onnxruntime-web/dist/', import.meta.url));
  return OrtEngine.create(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), (ort) => {
    ort.env.wasm.wasmPaths = ortDist;
    ort.env.wasm.numThreads = 1;
  });
}

export async function makeController(kind: 'ort' | 'mlp'): Promise<Controller> {
  const contract = loadContractNode();
  const h = await compileShipped(true);
  return new Controller(h, contract, await makeEngine(kind, contract));
}
