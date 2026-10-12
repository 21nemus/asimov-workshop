# Sources

Everything ASIMOV WORKSHOP shows comes from one of the sources below, pinned to an exact
revision. `references/pins.json` records the SHA-256 of every file read (62 files across the
repositories plus the docs export). `npm run sources:verify` re-hashes a local copy against it
and `npm run sources:fetch` restores the pinned files into `.reference-cache/`.

Retrieved 2026-10-09.

## Pinned sources

| Id | Source | Revision | Used for |
| --- | --- | --- | --- |
| `asimov-1@main` | https://github.com/menloresearch/asimov-1 | `f71f3fe87ddfa6b7aac2a5cddeaad5dbbc19cca7` (2026-10-06) | Full-body CAD assembly `mechanical/ASV1/FullBodyAssembly/Asimov_1.STEP` (520 MB, LFS; SHA-256 `35903b20…`), part CAD, wiring tables, licences |
| `asimov-1@viewer-submodule` | same repository | `35ae7b3581ce36762bfddb00b8fc5e7c957ee7fa` (2026-09-28) | Simulation model `sim-model/` (MJCF `asimov_1.xml`, URDF, 25 STL meshes): the exact revision the policy viewer uses. `sim-model/` is byte-identical at `f71f3fe`. |
| `humanoid-policy-viewer` | https://github.com/menloresearch/humanoid-policy-viewer | `0c2107805ec2a82c2788b7e2fdd06c7aaa8e18a8` (2026-10-06) | Walking policy checkpoint `asimov/model_aug_18_1` (ONNX), its training `env.yaml`, the reference policy JSON, the browser control loop, dependency lock |
| `cyclotron` | https://github.com/menloresearch/cyclotron | `d970f0633a8794506b6f2bc897eba8c4e04e1e63` | Training framework, referenced only (not installed or run) |
| `docs.menlo.ai` | https://docs.menlo.ai (full-text export `llms-full.txt`) | SHA-256 `ce14167f…` (retrieved 2026-10-09) | Assembly steps, part organisation, joint and actuator tables, ankle mechanism mapping |

## Maintainer-supplied material

| Item | SHA-256 | Use |
| --- | --- | --- |
| `Asimov 1 - Bill of Materials.xlsx` (BOM-ASV1-001, "Public Release V1.1 – 2026") | `5aedfcf9…` | Facts extracted with sheet and row ids into `src/data/bom.json`; the workbook is not redistributed (see LICENSES.md: REVIEW) |
| Three lab screenshots | `399c9f62…`, `8abf31d3…`, `f3aa74bc…` | Appearance reference for the original workshop scene and the shell hue; not shipped |

## How each kind of value is labelled in the app

| Label | Meaning | Typical source |
| --- | --- | --- |
| SOURCE SPEC | Stated by Menlo | docs.menlo.ai tables and steps, BOM rows, the CAD's part identity |
| SIM VALUE | A value of the simulation model or policy configuration | MJCF, `env.yaml`, the operative policy contract |
| CAD DERIVED | Measured on the published CAD by this project | Ankle linkage geometry, lever ratios |
| APPROXIMATION | A simplified model valid in a stated range | The ankle linkage (rigid links, ideal joints) |
| ILLUSTRATIVE | Shown to explain; not specified by any source | Materials without a BOM finish, workshop props |
| CONCEPT | From concept material, not Asimov 1 | Not used in this version |
| UNVERIFIED | Could not be checked against a primary source | Used when a value cannot be traced |

## Derived data files and how to rebuild them

| File | Tool | Inputs |
| --- | --- | --- |
| `src/data/kinematics.json`, `public/sim/asimov_1.physics.xml` | `tools/build-sim.mjs` (MuJoCo 3.3.8 in Node) | MJCF at `35ae7b3` |
| `public/robot/sim-links.glb` | `tools/build-sim-links.mjs`, then `npm run robot:compress` | STL meshes at `35ae7b3` |
| `public/robot/asimov-cad.glb`, `public/robot/parts.json` | `tools/cad/step-index.mjs` → `assembly.mjs` → `tessellate.mjs` → `register.mjs` → `tools/build-robot.mjs` → `npm run robot:compress` | STEP at `f71f3fe`, MJCF, BOM, docs assembly steps |
| `src/data/bom.json` | `tools/build-bom.py` (`python3 -I`) | BOM workbook |
| `src/data/assembly.json`, `src/data/lessons.json` | `tools/build-assembly.mjs`, `tools/build-lessons.mjs` | docs export, `parts.json` |
| `src/data/joint-specs.json` | `tools/build-joint-specs.mjs` | docs export |
| `src/data/ankle-linkage.json` | `tools/measure-ankle.mjs` | tessellated CAD, registration, kinematics |
| `public/policy/model_aug_18_1/*` | `tools/build-policy.mjs` (runs the viewer's own env.yaml parser) | checkpoint and `env.yaml` at `0c21078` |

The intermediate CAD cache (`tools/.cache/cad/`, about 200 MB) and the reference cache
(`.reference-cache/`) are not part of the repository; the tools rebuild them from the pins.
