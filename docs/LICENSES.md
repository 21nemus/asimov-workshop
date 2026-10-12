# Licences

ASIMOV WORKSHOP mixes original work with material derived from Menlo Research's open releases
and from open-source software. Each file keeps the licence of what it came from. Full licence
texts ship in `public/licenses/` (and therefore with the built site).

This register states what the sources say. It is not legal advice. Items marked **REVIEW**
need the maintainer's decision before a public release.

## Original work (MIT, see `LICENSE`)

| Path | What |
| --- | --- |
| `src/` (except the files listed below) | Application code, UI, scene, workshop props and procedural textures |
| `tools/` | Build and measurement tools (CAD conversion, registration, BOM and docs extraction, ankle measurement) |
| `tests/` | Test suite |
| `public/favicon.svg` | Original mark |
| `docs/` | Project documentation |

The workshop scene is original: procedural textures and modelled props, inspired by the kind of
space in Menlo's lab photos, not a replica. No paid or third-party 3D assets are used.

## Derived from Menlo Research

| Path | Derived from | Licence | Notes |
| --- | --- | --- | --- |
| `public/robot/asimov-cad.glb`, `public/robot/parts.json` | `menloresearch/asimov-1@f71f3fe` `mechanical/ASV1/FullBodyAssembly/Asimov_1.STEP` | **CERN-OHL-S-2.0** (strongly reciprocal) | Tessellated, registered and simplified by `tools/`. The source is the upstream STEP; the conversion tools are in this repository. |
| `src/data/ankle-linkage.json` | Measurements of the same CAD (`tools/measure-ankle.mjs`) | CERN-OHL-S-2.0 (derived data) | Ball centres, axes and lengths measured by this project |
| `public/sim/asimov_1.physics.xml`, `src/data/kinematics.json`, `public/robot/sim-links.glb` | `menloresearch/asimov-1@35ae7b3` `sim-model/` (MJCF and STL meshes) | CERN-OHL-S-2.0 per the policy viewer's notices; **REVIEW** (see below) | Visual meshes stripped for physics; link meshes simplified |
| `public/policy/model_aug_18_1/policy.onnx`, `mlp.bin`, `contract.json` | `menloresearch/humanoid-policy-viewer@0c21078` checkpoint `asimov/model_aug_18_1` and its `env.yaml` | **BSD-3-Clause** (the viewer's `THIRD_PARTY_NOTICES.md` releases this checkpoint under the project licence) | `mlp.bin` is the same weights re-packed; `contract.json` holds the operative values with their provenance |
| `src/simulation/controller.ts`, `observation.ts`, `model-overlay.ts` | Ports of the viewer's control loop (`main.js main_loop`), observation code and scene overlay | **BSD-3-Clause**, © 2026 Qingzhou Lu, © 2026 Menlo Research Pte. Ltd. | Notice reproduced in `public/licenses/humanoid-policy-viewer-BSD-3-Clause.txt` |
| `src/data/assembly.json`, `src/data/lessons.json`, `src/data/joint-specs.json` | docs.menlo.ai (assembly steps, joint and actuator tables), pinned export | No licence stated on the docs site. **REVIEW** | Step titles, part numbers, counts and table values are cited with links; prose is not copied |
| `src/data/bom.json` | "Asimov 1 - Bill of Materials.xlsx" (BOM-ASV1-001, Public Release V1.1, 2026), supplied privately | No licence stated; Menlo distributes it through an email request form. **REVIEW: release blocker** | 316 records with sheet and row ids, including vendor names and procurement URLs. The workbook itself is not in the repository. |

### Open licence questions (REVIEW)

1. **BOM data.** `src/data/bom.json` republishes facts extracted from a workbook that Menlo hands
   out through a form without a stated licence. Before publishing, either get Menlo's permission
   or ship a reduced file (part numbers, quantities, materials and finishes only; no vendors,
   SKUs or URLs). The app only needs the reduced fields.
2. **Simulation model licence.** The `asimov-1` repository states CERN-OHL-S-2.0 for hardware and
   GPL-2.0 for software but does not say which covers `sim-model/` (MJCF, URDF, STL). The policy
   viewer's notices treat it as CERN-OHL-S-2.0. Both licences are reciprocal; the derived files
   here should stay under whichever applies.
3. **Documentation-derived data.** docs.menlo.ai states no licence. The extracted data are short
   factual items (titles, counts, limits) with links; confirm this is acceptable to Menlo.
4. **Combining MIT code with reciprocal assets.** The original code is MIT; the reciprocal
   assets are separate files used as data. CERN-OHL-S-2.0 obligations (keeping the licence,
   pointing to the source) are met by this register and the upstream links. Confirm that this
   split is the intended licensing for the public repository.

## Software dependencies shipped in the built site

| Package | Version | Licence | Full text |
| --- | --- | --- | --- |
| three (incl. `GLTFLoader`, `OrbitControls`, `meshopt_decoder`) | 0.186.1 | MIT | `public/licenses/three.js-MIT.txt` |
| mujoco-js (MuJoCo 3.3.8 compiled to WebAssembly, by Google DeepMind) | 0.0.7 | Apache-2.0 | `public/licenses/Apache-2.0.txt` |
| @fontsource/barlow, barlow-condensed, ibm-plex-mono | 5.3.0 | SIL OFL 1.1 | `public/licenses/font-*.txt` |

The built JavaScript keeps the libraries' `@license` comments.

## Development-only dependencies (not shipped)

onnxruntime-web 1.29.0 (MIT; used by the tests to verify the TypeScript policy engine),
@gltf-transform 4.5.1 (MIT), meshoptimizer 1.3.0 (MIT), occt-import-js 0.0.23 (LGPL-2.1;
STEP tessellation in `tools/`), typescript, vite, @types packages (MIT / Apache-2.0).

## Not used, not redistributed

- The three lab screenshots supplied by the maintainer: appearance reference only.
- No paid assets, no threejsassets material, no photographs, no third-party textures.
