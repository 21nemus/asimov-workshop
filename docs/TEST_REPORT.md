# Test report

Date: 2026-10-09. Machine: macOS (Apple silicon), Node 22.14.0, Chromium (Claude desktop app
browser pane). Commands: `npm test` (Node test runner, TypeScript stripped), `npx tsc --noEmit`,
`npx vite build`.

## Summary

| Check | Result |
| --- | --- |
| `npm test` | **42 / 42 pass** (39 at v1; 3 firmware-fact tests added 2026-10-21) |
| `npx tsc --noEmit` | clean |
| `npm run build` (typecheck + Vite) | succeeds; 25 MB `dist/` (see sizes below) |
| Upstream baseline reproduced in the browser, unmodified viewer | yes: stand, walk 0.5 m/s, 150 N push recovered |
| App controller vs upstream modules (headless) | bit-identical over 500 ticks with ONNX Runtime; TypeScript engine within tolerance |
| App adapter in the browser vs headless harness | same final root pose to 0.1 mm (below) |
| TEST in the live UI: walk, push, freeze, inspect, resume, fall, reset | pass |
| BUILD, UNDERSTAND, ankle microscope, WATCH in the live UI | pass |
| Layouts 390x844 and 844x390 | pass (screenshots checked) |
| Production build served and run (TEST walking live) | pass, after fixing one focus bug found there (below) |
| Failure paths, rapid mode switching, console | pass (below) |

## Automated tests (`tests/`)

| File | Tests | What they prove |
| --- | --- | --- |
| `rig.test.ts` | 5 | 23 hinges, axes and mirroring; MuJoCo-to-three frame mapping; rig forward kinematics equals MuJoCo `xpos`/`xquat` at random poses; reference pose equals compiled `qpos0` (elbow `ref` offsets) |
| `sim-equivalence.test.ts` | 2 | Our controller with ONNX Runtime reproduces a harness running the viewer's own modules **bit for bit** over the 500-tick baseline scenario; the shipped TypeScript MLP stays within tolerance (first-tick action difference 2.4e-7, root error under 0.005 mm after 10 s) |
| `adapter.test.ts` | 7 | Contract completeness and clear failures; **freeze, inspect, resume is bit-exact even mid-push**; a fall reports DAMP mode, not recovery, and reset restores the verified start; perturbation records carry body, point, frame, direction, magnitude and timing; commands clamp to env.yaml ranges; both feet report four contact points carrying the robot's weight |
| `ankle.test.ts` | 10 | Both legs: the CAD pose closes at zero; the TypeScript model matches the measurement tool's grid; IK and Newton FK agree over the documented range; the docs' mapping has the same signs; **CAD lever ratios reproduce the documented 145.4 and 57.6 N·m joint-space peaks** |
| `lessons.test.ts` | 3 | Six modules; left leg's 14 steps in order with prerequisites; steps reference real CAD parts; "matched" fastener groups have exactly the documented count |
| `support.test.ts` | 2 | Support ships disabled and empty; enabled-but-empty or non-https entries render nothing |
| `bom.test.ts` | 5 | Every BOM record has a unique sheet-and-row id; conflicting part numbers stay separate; cached workbook totals are never marked verified; cancelled lines are not active; missing quantities stay missing |
| `assembly.test.ts` | 5 | No cycles in the cross-module assembly graph; prerequisites point backwards; undo and replay reach exactly the state of jumping to a step; step-by-step assembly ends where a direct jump ends; BUILD code cannot import or request the simulation |

## Policy baseline

Protocol (`src/simulation/scenarios/baseline-flat-01.json`): reset (pelvis z 0.614 m, trained
default pose, at rest), stand 3 s, walk command vx 0.5 m/s, lateral push +Y world 150 N for
0.15 s through the pelvis centre of mass, run to 10 s. Foot sliding friction 0.6.

| Run | How | Result |
| --- | --- | --- |
| Upstream viewer, unmodified (`0c21078`), in the browser | Scripted through the viewer's own demo hooks; command and push at wall-clock-paced times t 3.1 s and 6.1 s | No fall, max tilt 6.24°, pelvis z min 0.614 m, real-time factor 0.954; final root (2.925, 0.193, 0.623) m at t 9.9 s. Evidence: `tools/.cache/baseline/upstream-browser-run-1.json`, `tools/.cache/captures/upstream-viewer-walking-0.5mps.jpg` |
| Headless harness of the viewer's modules (Node, ONNX Runtime) | Tick-indexed schedule (walk at tick 150, push at tick 300) | Final root (3.0151, 0.2025, 0.6230) m. `tools/.cache/baseline/upstream-harness-baseline-flat-01.json` |
| This app's adapter, in the browser (MuJoCo WASM, TypeScript MLP) | Same tick-indexed schedule, `stepTicks` | Final root **(3.0151, 0.2025, 0.6230) m**, max tilt 6.40°, no fall, 0.5 ms per policy tick without rendering. `tools/.cache/logs/app-browser-baseline-flat-01.json` |

The wall-clock-paced upstream run differs slightly from the tick-indexed runs because its
command and push land on different ticks; the tick-indexed runs agree exactly.

All of this is browser simulation (MuJoCo) of a policy trained in Isaac Lab (PhysX): a
sim-to-sim result, not evidence about the hardware.

## Live UI checks (in the browser)

TEST (desktop, 1024x768):
- Load to READY (MuJoCo, model, contract and MLP) in 0.87 s with a warm cache; status chip
  "Paused", start state 0.614 m. Cold-cache time on a real network was not measured.
- Start, then "Walk 0.5 m/s": pelvis speed about 0.42 m/s, real-time factor 99 to 101%,
  3.6 ms per tick including the frame.
- Push (key P) while walking: logged with t 17.600 to 17.750 s, 30 physics steps, direction
  (0, 1, 0) world, point at the pelvis CoM; robot recovered. Arrow drawn through the live CoM.
- End of test lane: run pauses with a toast (display limit only).
- Freeze 70 ms after a push: joint table shows 23 joints, 2 to 3 at their torque limit,
  highlighted on the robot; clicking a body shows its joint card; Resume continues.
- Reduced-friction surface, three overlapping pushes (450 N for 0.15 s): fall at t 2.64 s,
  status "Fall · damp mode", event "tilt past 80.4 deg", robot ends on the floor (pelvis
  0.154 m). Reset restores the start state.

BUILD: deep link `#build/left-leg%2F03` opens step 3; parts fly in, fasteners follow along
their axes; future parts as outlines; step 9 and step 10 checked; step card shows docs link,
parts with roles, fastener counts with status; hash updates per step.

UNDERSTAND: explode, section (clip plane), simulation model (MJCF link meshes) and collision
shapes, joint explorer (left knee moved to 1.2 rad: the foot moves back and up, checked
numerically), ankle microscope.

Ankle microscope: linkage closes visually in every motion; "Both" motion at pitch 0.30 rad:
actuators +0.615 / -0.604 rad, docs rule off by 0.42° (pitch) and 0.09° (roll); "Actuator A
alone" at 0.15 rad: foot pitch +0.037, roll -0.094 rad (mostly roll, as the levers predict).

WATCH: full run: intro, explode, 14 BUILD steps with step titles, ankle with live actuator
angles, TEST beat running the baseline scenario tick for tick (walk at tick 150, push at tick
300, outcome caption "It recovered and kept walking" read from the controller mode at tick
340 or later), end card. The visitor's TEST state is restored afterwards.

Mobile: 390x844 (bottom sheet, bottom navigation, robot fully framed above the sheet, TEST
panel usable) and 844x390 (side panel, compact navigation, microscope labels readable).

Picking: projecting part ASV1_600_08A to the screen and picking there returns that part, on
the compressed mesh.

Ankle bench: the lower leg (left or right) travels to the ankle bench and is held in a clamp;
the linkage solves live for both sides ("Both" motion on the right ankle: actuators +0.645 /
-0.676 rad at pitch 0.295 rad); "Back to the robot" restores all 1,184 parts and the mount.

Production build (`vite preview`): boots without dev hooks; ONNX Runtime is never requested;
TEST loads MuJoCo and the MLP on demand and walks at 100% of real time. **Bug found and fixed
there:** after clicking a panel button with the mouse, the button kept focus, so Space
re-clicked it instead of starting the run. Controls now release focus after pointer clicks;
keyboard activation keeps focus.

Failure path: with the policy weights download forced to fail (HTTP 503), TEST shows
"Simulation unavailable", the exact error and Try again; after restoring the network, Try again
reaches READY.

Rapid switching: 15 mode changes without waiting (including WATCH and the ankle bench), then
EXPLORE: no errors, no part left hidden, outlined or offset, the mount back at identity, the
navigation restored, no tour bar or end card left behind.

Console: no application errors. The one recurring warning (three.js replacing the removed
`PCFSoftShadowMap`) was fixed by selecting `PCFShadowMap` directly. The only error entries were
Vite dev-server "Outdated Optimize Dep" responses during dependency re-optimisation (dev only).

Accessibility tree: every control has a name (area cards, navigation, Sources, buttons whose
text label is hidden on phones); tab order runs brand, Copy link, Sources, navigation, panel.
The part finder reaches every part from the keyboard.

Preview images (browser-rendered, 1200x630): `tools/.cache/captures/preview-hero.jpg`,
`tools/.cache/captures/preview-ankle-bench.jpg`.

## Sizes (production build)

| File | Raw | Gzip | Loaded |
| --- | ---: | ---: | --- |
| `assets/index-*.js` (app, three.js, data) | 1.33 MB | 0.36 MB | always |
| `robot/asimov-cad.glb` | 7.49 MB | 5.67 MB | always |
| `robot/parts.json` | 0.84 MB | 0.06 MB | always |
| `assets/mujoco_wasm-*.js` | 10.8 MB | 2.91 MB | TEST or WATCH |
| `policy/model_aug_18_1/mlp.bin` | 0.83 MB | | TEST or WATCH |
| `robot/sim-links.glb` | 1.35 MB | 1.08 MB | UNDERSTAND simulation view |
| fonts (woff2) | about 0.35 MB | | always |

ONNX Runtime (14 MB of WebAssembly) is not in the build: the shipped engine is the verified
TypeScript forward pass; ONNX Runtime runs only in the tests.

## Not verified

- Real phones and tablets (only emulated viewports; touch was not exercised); Safari and
  Firefox; low-end GPUs.
- `prefers-reduced-motion` paths were exercised in code review, not in an emulated browser.
- A failed robot mesh download (the boot error state exists but was not forced).
- Screen readers (structure and labels were checked in the accessibility tree, not with a
  screen reader).
- Long sessions (memory over hours).
- Anything about the physical robot: no hardware was involved.
