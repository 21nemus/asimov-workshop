# ASIMOV WORKSHOP: progress log

Running record so another session can continue without the chat history.
Newest entries at the top of each section.

## Where things are (2026-10-09, end of session)

Project folder: `3d_visuals/asimov-lab/`, its own git repository (branch `main`), excluded from
the parent `3d_visuals` repository through the parent's `.git/info/exclude`. Dev server: `npx vite --port 5180`
run from a shell in the background (the shared `.claude/launch.json` is not edited; the browser
pane's preview tool reads that shared file, so it cannot start this project). The upstream
viewer baseline runs from `.reference-cache/viewer` on port 5182.

GitHub: private repo `21nemus/asimov-workshop` (branch `main`). Deployment is manual only:
`.github/workflows/pages.yml` has no push trigger while release blockers are open.

All four areas and the tour work in dev and in the production build. `npm test`: 39 pass.
`npm run build`: clean, 25 MB `dist/`. Docs complete: README, SOURCES, LICENSES, DISCREPANCIES,
ARCHITECTURE, TEST_REPORT, this file.

### Done
- **App shell**: modes EXPLORE / BUILD / UNDERSTAND / TEST / WATCH, deep links (`#build/left-leg%2F03`,
  `#understand/ankle`, `#understand/ankle-right`, `#test`, `#watch`), keyboard (B U T W, Esc, mode
  keys; controls release focus after pointer clicks so shortcuts keep working), picking, hover,
  highlight layers, panel-aware framing (pure frustum shift) and portrait shot pull-back,
  pose blending, robot mount (display transform), part finder, Copy link.
- **TEST**: live policy, defined push with full record, BASELINE / REDUCED-FRICTION surface,
  freeze with joint torque table, fall into DAMP shown honestly, test-lane end pause, failure
  state with Try again.
- **BUILD**: six modules from the docs lessons (left leg polished), in place, outlines, flights,
  step cards, local progress. Shared logic in `src/build/build-plan.ts`.
- **UNDERSTAND**: explode, section, hardware CAD vs MJCF link meshes and collision shapes, joint
  explorer (sim vs docs range, actuator, env.yaml torque), mass/height/DOF facts.
- **Ankle microscope**: either ankle moves to the **mechanism bench** (clamp stand on the ankle
  bench; `understand/ankle-bench.ts`), linkage posed from the exact closure, labels, motions,
  live comparison with Menlo's small-angle rule, sources drawer.
- **WATCH**: about 62 s plus the live TEST beat: reveal orbit, explode, left leg in 14 steps with
  the documented step 9 cable (ankle actuators IDs 5 and 6), ankle on the bench, "Assembly view
  complete. Initializing physics model.", baseline scenario tick for tick with controller state
  and a slow-motion label if the device falls behind, outcome read from the simulation, end card
  (Explore, Build, Microscope, TEST, Sources; Support only if configured).
- **Art pass**: two-tone walls, rim light, frosted glass, whiteboard, moved stands, contact
  shadows, vignette. **Assets**: meshopt filter encoding (`npm run robot:compress`): CAD 10.5 ->
  7.3 MB, sim links 4.8 -> 1.3 MB. ONNX Runtime moved out of the app bundle (tests only).
- **Support**: `src/config/support.ts`, disabled and empty, guarded renderer, tests.
- **Licences**: `LICENSE` (MIT, original code), `public/licenses/` full texts, register.

### Docs re-pin (2026-10-21)
Menlo relaunched the User Manual (announced 2026-10-19). The docs export was re-pinned
(`7c7ac81c…`, retrieved 2026-10-21T07:54:44Z; the 2026-10-09 export and its page split are kept
in `.reference-cache/docs@2026-10-09/` for diffing) and `assembly.json`, `lessons.json` and
`joint-specs.json` regenerated. Effect: joint table and ankle limits identical; five final steps
renamed "… Verification"; torso Step 11 "Torso Verification" added (video only, no parts); two
cables and two WAGO connectors added to torso steps 3 and 4. Menlo now flags the Mechanical System
Tour page (our joint-table source) as partly outdated. Details: `docs/DISCREPANCIES.md` D1–D3.
`tools/build-assembly.mjs` now takes step group labels from the docs index titles ("+" and "&"
written as "and") instead of the URL slugs, because Menlo renamed groups without changing URLs.
BUILD checked in the browser: torso shows 11 steps, Step 11 is the module-complete step.
Same day: `asimov-1` and `menlo-sdk` unchanged; the viewer is now at `a90090b` (re-verification
target for the open parity item).

### SDK review (2026-10-12, read-only)
`docs/SDK_REVIEW.md`: Menlo's Python SDK (`menlo-sdk@7683801`, Apache-2.0) compared with the
workshop. Nothing installed or connected. Key facts: firmware ankle constants 2.02 / 0.8 confirm our
CAD levers; firmware caps walking at 0.4 m/s (our TEST preset is 0.5); real falls latch a limp DAMP;
25 firmware actuators vs our 23 joints (name map in the review). Proposed text changes and the
future Real Robot Replay are **awaiting the maintainer's approval**. The viewer moved past our pin
(`e115f35`, main.js rewritten): re-verify before claiming parity with the latest viewer.

### Next (in order)
1. Decisions needed from the maintainer (see the final report and LICENSES.md "REVIEW"): BOM
   redistribution, sim-model licence reading, docs-derived data, repository and licence setup.
2. Real-device pass (iPhone, Android, iPad; Safari, Firefox), touch interaction, reduced motion
   in an emulated browser, a forced mesh-download failure.
3. Workshop art, second pass: ambient occlusion or baked contact for props, more set dressing
   on the left wall and lockers; a lighter mesh tier for phones (load time).
4. BUILD route polish for torso and head: of 95 documented torso fasteners, 31 are placed from
   the CAD (16 in exactly matching groups); several groups are not modelled in the CAD at all.
5. Release: README screenshots from `tools/.cache/captures/`, a social preview, GitHub Pages
   workflow (needs permission).

## Key findings to carry forward
- Policy contract and operative values: see `docs/DISCREPANCIES.md` (env.yaml wins over the
  reference JSON fallbacks; viewer applies no env.yaml armature/friction).
- **Correction**: the earlier "ankle pivot 6.2 mm lower in CAD" compared the cross block's box
  centre with the MJCF joint. The fitted bore axes put the CAD pitch axis 1.2 mm above and 1.5 mm
  in front of the MJCF one, and the roll axis 1.3 mm above; the MJCF's 10 mm pitch-to-roll axis
  offset matches the CAD's 10.0 mm.
- Docs ankle actuator rows (IDs 5/6, 11/12) carry joint-space values: 145.4 (pitch) and 57.6
  (roll) N·m peak, reproduced by the CAD lever ratios. The rated 40/17 are not reproduced by
  2 x 12 N·m through the levers (48.5/19.2); unresolved.
- Hardware vs simulation geometry (CAD vs MJCF): knee axis 23.6 mm higher in CAD; thigh 246.4 vs
  270.0 mm; shank 302.2 vs 272.3 mm. Head ~40 mm lower and further back in CAD.
- The MJCF visual meshes group some parts differently from the hardware (knee side plates with
  the thigh); the foot mesh comes from a different foot CAD ("friend's CAD" comment in MJCF).

## Gotchas
- Quantised glTF meshes carry a dequantisation scale in their node matrix: per-part offsets are
  divided by `length(modelMatrix[0].xyz)` in the shader so they stay in body-frame metres.
- World positions computed right after load need `updateWorldMatrix(true, ...)` (parents
  included); the MuJoCo frame group has not been rendered yet on a deep-link load.
- GLTFLoader strips dots from node names (`IMU_ORIGIN.STL` -> `IMU_ORIGINSTL`).
- The in-app browser pane may be hidden: no animation frames then. Drive the app with
  `__asimov.stage.manualFrames(n)` and save frames with `__asimov.capture(name)` (dev only).
- `weld()` in `tools/mesh-utils.mjs` treats input as a triangle soup unless an index is passed.
- meshoptimizer simplify needs `Permissive` on per-face CAD tessellations, else it stalls.
- Tessellated CAD products are in millimetres; registration `local` transforms take metres.
- Running `tools/cad/register.mjs` takes ~1.5 min; `tessellate.mjs` caches per product.
