// The MuJoCo WebAssembly module (mujoco-js 0.0.7), shipped as its own unmodified file and loaded
// by URL instead of being bundled. Bundled, it imported a helper from a sibling chunk by relative
// path; hosts that redirect large files to a CDN (Hugging Face Spaces) then resolved that path on
// the CDN and the import failed. The published file is self-contained (the WebAssembly is embedded),
// so it loads from anywhere. Imported lazily by the adapter: Node tests pass their own loader.
import url from 'mujoco-js/dist/mujoco_wasm.js?url';

export const mujocoUrl: string = url;
