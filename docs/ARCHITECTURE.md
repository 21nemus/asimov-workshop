# Architecture

A static web app: TypeScript, Vite, three.js, plain DOM UI. No backend, no accounts, no
analytics, no cookies. Everything runs in the browser; heavy parts load on demand.

## Load sequence

1. `index.html` shows the boot card. `src/main.ts` loads fonts and styles and calls `startApp()`.
2. `app.ts` builds the stage (renderer, camera, adaptive pixel ratio), the workshop, lighting and
   the camera director, then loads the robot: `public/robot/parts.json` (part identity and
   provenance) and `public/robot/asimov-cad.glb` (meshopt-compressed, about 7.3 MB).
3. The shell (brand, Sources, navigation, panel, captions) and the five modes are created; the
   URL hash picks the first mode.
4. MuJoCo (WebAssembly, about 2.9 MB gzipped) and the policy (0.8 MB) load only when TEST or
   WATCH first needs them (`ctx.sim()`), with progress in the TEST panel.
5. `public/robot/sim-links.glb` loads only when UNDERSTAND switches to the simulation model.

## Modules

```
src/
  main.ts                    entry; boot error state
  app/
    app.ts                   bootstrap, mode switching, deep links, picking, hover, keyboard,
                             panel-aware framing, contact shadows
    context.ts               AppContext handed to modes; PoseDriver (display pose, blend,
                             hang, or follow the simulation)
    shell.ts                 persistent UI chrome
    highlights.ts            highlight layers over the per-part highlight channel
    modes/
      explore-mode.ts        home: areas, part finder, part tags
      build-mode.ts          BUILD (uses build/build-plan.ts)
      understand-mode.ts     UNDERSTAND: explode, section, sim model, joints, ankle microscope
      test-mode.ts           TEST: live policy, push, surface, freeze and inspect
      watch-mode.ts          WATCH: the guided tour, built from the same objects
  build/build-plan.ts        assembly plans from the docs lessons; step state, flights, shots
  understand/
    ankle-linkage.ts         exact RSU loop closure (IK, Newton FK, docs mapping, torque map)
    ankle-microscope.ts      live linkage: crank and rod proxies posed from the closure
  simulation/                the only code that touches MuJoCo or the policy
    adapter.ts               SimulationAdapter: states, fixed-step scheduler, pushes, freeze
    controller.ts            line-faithful port of the viewer's control loop
    observation.ts           78-value observation (viewer's math, including three r151 quirks)
    policy-engine.ts         TypeScript MLP forward pass (shipped)
    policy-engine-ort.ts     ONNX Runtime engine (tests only)
    contract.ts              policy contract type and validation
    model-overlay.ts         actuator overlay (port of the viewer's scene overlay)
    scenario.ts              deterministic tick-indexed scenarios
  robot/
    rig.ts                   kinematic rig: one group per MuJoCo body, hinge pivots
    robot-model.ts           CAD meshes on the rig, per-part identity, picking, proxies
    part-state.ts            per-part visible/highlight/ghost/dim/offset via data textures
    materials.ts             BOM finish to PBR, with provenance
    poses.ts, explode.ts     named poses, standing on the floor; exploded view vectors
  scene/                     stage, workshop, lighting, props, procedural textures, layout,
                             camera director, force arrow, contact shadows
  ui/                        DOM helpers, components, icons, part tag, labels, sources drawer
  catalog/catalog.ts         BOM, lessons and assembly lookups for a part
  config/support.ts          optional support card (disabled)
  data/                      extracted and measured data (see SOURCES.md)
```

## The robot: one model, two drivers

The robot is the hardware CAD (1,184 parts) hung on a rig that mirrors the MJCF body tree in
MuJoCo coordinates under a single group rotated -90° about X. The rig is posed either by a
display pose (EXPLORE, BUILD, UNDERSTAND) or by the simulation's `qpos` (TEST, WATCH). The
`PoseDriver` decides which. Parts never move relative to their body except through the per-part
offset texture (exploded view, BUILD flights), which is in body-frame metres.

Per-part state lives in two small textures indexed by part. Every merged mesh vertex carries
its part index (`_PART`), and patched built-in materials read the textures to hide, highlight,
dim, ghost or offset any part. One texture upload per frame covers any number of changes.

## Simulation boundary

The rest of the app talks to physics only through `SimulationAdapter`:

- **States:** UNINITIALIZED, LOADING, READY, RUNNING, PAUSED, INSPECTION_FROZEN, RESETTING,
  ERROR. Controller mode: POLICY_ACTIVE, FALL_DAMP, IDLE.
- **Fixed stepping:** physics advances in whole 20 ms policy ticks (4 × 5 ms substeps), owed by
  an accumulator of wall time. If a frame's budget runs out, owed time is dropped: the
  simulation slows down and reports its real-time factor; physics work is never skipped.
- **Freeze:** `freeze()` snapshots MjData state arrays (including the derived kinematics that
  `mj_applyFT` reads mid-push) and a deep copy of the controller state; `unfreeze()` restores
  it and continues bit for bit (tested).
- **Pushes:** `applyExternalForce` records body, point (body CoM at the start), frame, unit
  direction, force, duration, start and end time, start tick and substeps.
- **Limits:** velocity commands are clamped to env.yaml's training ranges; actuator torque
  limits come from env.yaml and are verified present before any step.

The control loop is a port of the upstream viewer's `main_loop` (action delay, one-pole
filter, PD with `kd_hw = min(kd, 5)`, torque clamp, fall latch into DAMP). It is verified
against a headless harness that runs the viewer's own modules (`tools/baseline/`).

## Rendering

WebGL 2, ACES tone mapping, sRGB, PCF soft shadows from one key light that follows the robot,
rect-area ceiling panels, a rim light, a prefiltered room environment. Adaptive pixel ratio
backs off under load. The camera aims at the middle of the area the panel leaves free
(`Stage.setInsets`, a pure frustum shift) and pulls authored shots back on portrait phones.
`prefers-reduced-motion` turns camera moves into cuts and part flights and tour motions into
static poses.

## What is deliberately not here

No server, no login, no telemetry, no external requests at runtime other than the app's own
files. No wallet code. No sharing integrations. The support card renders only if a maintainer
enables it with verified entries.
