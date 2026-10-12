# ASIMOV WORKSHOP

**Build it. Bring it up. Test it.**

An interactive robotics workshop about [Menlo Research](https://github.com/menloresearch)'s open-source
humanoid, Asimov 1. It runs entirely in the browser:

- **BUILD**: assemble the left leg (or any of the six modules) in place on the robot, step by
  step, following Menlo's documented assembly guide. Every part is the published CAD part.
- **UNDERSTAND**: explode and section the robot, compare the hardware with the simulation
  model, move every joint through its range, and put the parallel ankle under the microscope:
  the RSU linkage measured from the CAD and solved exactly, live.
- **TEST**: Menlo's published walking policy running in MuJoCo, in your browser. Command it,
  push it with a defined load, change the surface, freeze any instant and read the controller's
  numbers. A fall is shown as a fall.
- **WATCH**: a guided tour of all three, about a minute, built from the same live objects.

This is an independent educational project. It is not affiliated with or endorsed by Menlo
Research.

## What is real, and what is not

- **The robot** is Menlo's full-body CAD assembly at `asimov-1@f71f3fe` (1,184 parts),
  tessellated and simplified by this project's tools, hung on the simulation model's joints.
- **The physics** is MuJoCo 3.3.8 (WebAssembly) running the simulation model at
  `asimov-1@35ae7b3`, the revision Menlo's policy viewer uses.
- **The policy** is the checkpoint `model_aug_18_1` from `humanoid-policy-viewer@0c21078`,
  with its training configuration. The control loop reproduces the viewer's, and the baseline
  scenario gives the same trajectory as the viewer's own code (see `docs/TEST_REPORT.md`).
- **It is a simulation.** The policy was trained in Isaac Lab (PhysX); here it runs in MuJoCo.
  That is a sim-to-sim result and says nothing direct about the physical robot.
- **Labels** on values say where they come from: SOURCE SPEC (Menlo's docs, BOM or CAD), SIM
  VALUE (simulation model or policy configuration), CAD DERIVED (measured on the CAD by this
  project), APPROXIMATION, ILLUSTRATIVE.
- **The workshop** is original: procedural textures and modelled props, inspired by the kind
  of space in Menlo's lab photos, not a replica of it.

Disagreements between Menlo's sources are listed in `docs/DISCREPANCIES.md`, not hidden.

## Run it

Requirements: Node 22.12 or newer (the tests run TypeScript directly), a browser with WebGL 2.

```bash
npm install
```

```bash
npm run dev
```

Then open http://127.0.0.1:5180/. Deep links: `#build/left-leg%2F03`, `#understand/ankle`,
`#test`, `#watch`.

```bash
npm test
```

```bash
npm run build
```

The build is a static site in `dist/` with relative URLs, so it can be served from any path,
for example a GitHub Pages project site. Nothing is deployed by this repository.

## Controls

| Key | Action |
| --- | --- |
| B U T W | BUILD, UNDERSTAND, TEST, WATCH |
| Esc | back to the workshop (or close the drawer) |
| ← → , R | BUILD: previous / next step, replay |
| Space, F, R, P | TEST: start or pause, freeze or resume, reset, push |
| Space, → | WATCH: pause, skip |

Mouse or touch: drag to orbit, scroll or pinch to zoom, click a part to read its tag. The part
finder in the workshop panel reaches every part from the keyboard. "Copy link" copies a link to
the current view (area and step are in the URL); nothing is posted anywhere. `prefers-reduced-motion`
replaces camera moves and animations with cuts and still poses.

## Repository layout

```
src/            application (see docs/ARCHITECTURE.md)
src/data/       extracted and measured data (see docs/SOURCES.md)
public/         robot meshes, physics model, policy, licence texts
tools/          the pipeline that builds the data and meshes from the pinned sources
tests/          Node test suite
references/     pins.json: SHA-256 of every source file used
docs/           SOURCES, LICENSES, DISCREPANCIES, ARCHITECTURE, TEST_REPORT, PROGRESS
```

Rebuilding the robot from the original 520 MB STEP takes roughly 20 minutes on a recent laptop and needs the
sources fetched first (`npm run sources:fetch`, then the steps in `docs/SOURCES.md`).

## Support

`src/config/support.ts` holds an optional support card. It ships disabled and empty. A
maintainer can add links or addresses they control and have verified, then enable it. The card
only shows plain links and copyable text; nothing connects a wallet or sends anything.

## Licences

Original code: MIT (`LICENSE`). Files derived from Menlo's releases keep their licences
(CERN-OHL-S-2.0 for the CAD-derived meshes, BSD-3-Clause for the policy and the ported control
loop) and dependencies keep theirs. `docs/LICENSES.md` maps every file, and lists the open
questions to settle before a public release.

## Credits

Asimov 1, its CAD, simulation model, documentation and walking policy: Menlo Research.
Policy viewer: Qingzhou Lu and Menlo Research. MuJoCo: Google DeepMind. three.js: its
authors. Fonts: Barlow and Barlow Condensed (Jeremy Tribby), IBM Plex Mono (IBM).
