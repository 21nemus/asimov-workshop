# Discrepancies

Where Menlo's sources disagree with each other, or with what the code actually does. Each
entry says what was found, where, and what ASIMOV WORKSHOP shows. Nothing here is "fixed"
silently: the app shows both values, or the one the running code uses, and says which.

Revisions: CAD and repository `asimov-1@f71f3fe`, simulation model `asimov-1@35ae7b3`, policy
viewer `0c21078`, docs export retrieved 2026-10-21 (re-pinned; first pin 2026-10-09), BOM "Public
Release V1.1 – 2026". Every docs-based row below was re-checked against the 2026-10-21 export and
still holds.

## Simulation and policy

| # | Finding | Evidence | Shown as |
| --- | --- | --- | --- |
| S1 | **Fall threshold comment vs code.** The viewer's comment says the policy stops past 30°; the code switches when projected gravity z rises above -0.166, about 80.4° of tilt. | viewer `main.js` fall check | TEST says "past about 80°" and logs 80.4° |
| S2 | **After a fall the viewer does not recover.** It latches a low-gain DAMP hold (kp 10, kd 3, targets re-captured every tick) until reset. | viewer `main.js` | TEST: "a safety hold, not a learned recovery" |
| S3 | **Training and browser physics differ.** The policy was trained in Isaac Lab (PhysX); the browser runs MuJoCo. | `env.yaml`, cyclotron | Every TEST and WATCH view calls it a sim-to-sim run, not a hardware result |
| S4 | **env.yaml armature and joint friction are not applied** by the viewer, although its METHODOLOGY.md says they are. The MJCF's own values are used. | viewer source vs METHODOLOGY.md | This project reproduces the viewer as it runs |
| S5 | **Reset height.** The viewer resets the pelvis to z 0.614 m; env.yaml's initial state says 0.639 m. The viewer's first page load starts from the model's qpos0 instead. | viewer `resetSimulation`, `env.yaml` | TEST resets to 0.614 m (the viewer's reset) |
| S6 | **Foot friction.** The foot contact spheres (priority 1) set sliding friction 0.6; training randomised friction over 0.8 to 1.2. | MJCF, `env.yaml` | BASELINE SURFACE uses 0.6; REDUCED-FRICTION uses 0.3 (the viewer's own low-friction benchmark) |
| S7 | **Mass.** The simulation model weighs 32.22 kg; Menlo publishes 35 kg for the robot. | MJCF (compiled), docs overview | Stated in UNDERSTAND |
| S8 | **Policy fallbacks.** The reference policy JSON carries fallback gains and limits; env.yaml values override them at load (the viewer's merge order). | `tools/build-policy.mjs` runs the viewer's own parser | `contract.json` keeps the operative values and lists the unused fallbacks |
| S9 | **Damping clamp.** Because the checkpoint has a `kd_ff` array (all zeros), the viewer caps kd at 5 (`kd_hw = min(kd, 5)`). | viewer `main.js` | Reproduced exactly |

## Joint limits and actuation

| # | Finding | Evidence | Shown as |
| --- | --- | --- | --- |
| J1 | **Hip pitch range.** Docs: left -2.09 to 1.00 rad (right mirrored). MJCF: -1.57 to 1.57 rad. | docs joint table, MJCF | Joint explorer shows both, flagged |
| J2 | **Elbow range.** Docs 0 to 2.44 rad; MJCF 0 to 2.0944 rad. | same | Both shown |
| J3 | **Neck.** Docs list neck yaw and pitch as powered joints; the MJCF fixes the neck (23 DOF). Menlo's docs say the neck is locked for walking. | docs, MJCF | Joint explorer note |
| J4 | **Ankle actuator rows hold joint-space values.** The docs' table lists actuators A and B (IDs 5/6, 11/12) with rated 40/17 N·m and peak 145.4/57.6 N·m, while each EC-A4310 is rated 12 and peak 36 N·m. The peaks are the ankle's joint-space pitch and roll: the CAD-measured lever ratios give 2.019 × (36 + 36) = 145.4 N·m pitch and 0.800 × 72 = 57.6 N·m roll. The rated 40/17 are **not** reproduced the same way (2 × 12 N·m gives 48.5 and 19.2); unresolved. env.yaml uses 40 and 17 as the simulated ankle torque limits. | docs table, `tools/measure-ankle.mjs`, `env.yaml` | Ankle microscope explains the peaks; TEST uses env.yaml's 40/17 |
| J5 | **Ankle range in older docs.** The asimov/0 hardware chapter lists ankle pitch ±0.50 and roll ±0.35 rad; Asimov 1's tables and the MJCF use ±0.35 and ±0.10. | docs (asimov/0 vs asimov/1) | Asimov 1 values used |

## Hardware geometry (CAD) vs simulation model (MJCF)

| # | Finding | Evidence | Shown as |
| --- | --- | --- | --- |
| G1 | **Knee position.** The CAD knee axis sits 23.6 mm higher than the MJCF's; thigh 246.4 mm (CAD) vs 270.0 mm (MJCF), shank 302.2 vs 272.3 mm. | `tools/cad/register.mjs` landmark fit | The drawn robot follows the simulation's joints; TEST says so |
| G2 | **Head.** About 40 mm lower and 36 mm further back in the CAD. | same | Not adjusted |
| G3 | **CAD assembly pose.** The CAD is posed with shoulder pitch about ∓20.8°, shoulder yaw +10/-13.6° and elbows about 51° straighter than the MJCF reference. | registration `qCad` | Parts are re-posed on the rig |
| G4 | **Ankle axes agree.** Fitted on the CAD bores, the pitch axis is 1.2 mm above and 1.5 mm in front of the MJCF pitch axis, the roll axis 1.3 mm above the MJCF roll axis, and the two axes are 10.0 mm apart in both. (An earlier estimate of "6.2 mm lower" compared the cross block's bounding-box centre and is withdrawn.) | `tools/measure-ankle.mjs` | Ankle microscope |
| G5 | **Link meshes group parts differently.** The MJCF visual meshes put the knee side plates with the thigh; the foot mesh is labelled as coming from a different CAD ("friend's CAD"). | MJCF, STL inspection | UNDERSTAND hardware vs simulation view |

## Ankle mechanism (docs mapping vs CAD)

| # | Finding | Evidence | Shown as |
| --- | --- | --- | --- |
| A1 | The docs give the actuator-to-joint mapping only as a small-angle formula with symbols r, d, c and no values. Measured on the CAD: r = 20.0 mm (both cranks), d = 41.7 mm, c = 32.0 mm; push rods 222.05 and 152.18 mm ball to ball (bars 194 and 124 mm). | `src/data/ankle-linkage.json` | CAD DERIVED |
| A2 | With those values the docs' roll coefficient matches the exact linkage (0.625); the pitch coefficient is 3.2% low (0.2397 vs 0.2477 rad per rad). | exact Jacobian | Ankle microscope readout |
| A3 | Over the documented range (pitch ±0.35, roll ±0.10 rad) the small-angle rule is off by up to 0.043 rad in pitch and 0.039 rad in roll, at the corners of the range. | exact loop closure on a 15 × 9 grid | Live comparison in the microscope |
| A4 | The docs do not state the actuators' positive direction ("predefined"). With angles measured positive about the forward axis, the signs of the docs' formula hold for both legs. | tests/ankle.test.ts | Stated in the microscope |
| A5 | Docs step 12 specifies M4x20 socket bolts at the foot pivot; the CAD models M4x25 there. | lessons, CAD | BUILD step 12 shows the CAD part and notes the difference |

## Simulation vs the real robot (Menlo's SDK, read-only review)

Source: `menloresearch/menlo-sdk@7683801` (Apache-2.0), whose comments cite Menlo's firmware.
Details in `docs/SDK_REVIEW.md`.

| # | Finding | Evidence | Shown as |
| --- | --- | --- | --- |
| H1 | **Walking speed.** The robot's firmware clamps velocity to 0.4 m/s forward and sideways and 0.8 rad/s turning. The policy was trained on vx −0.6 to 0.8 m/s, and the upstream viewer's baseline (our TEST preset and WATCH scenario) walks at 0.5 m/s. The docs' Robot Control page gives a wider envelope (±1.0 m/s, ±1.5 rad/s) than the firmware cap the SDK states. | SDK `_command.py`, REFERENCE safety model; env.yaml; docs | TEST states the cap, marks it as a band on the speed slider and labels faster commands "sim only" |
| H2 | **Falls on the robot vs in the viewer.** The firmware raises `FALL_DETECTED` (a critical alert) and latches DAMP, in which every actuator is compliant, until the firmware restarts; the SDK places the fall trip at projected gravity z above −0.5 (about 60°). The viewer, and our faithful TEST, switch to a soft hold (kp 10, kd 3) past about 80° and reset on demand. | SDK `_state.py`, docs Robot Control; viewer `main.js` | TEST's fall message states both: the viewer's soft hold and the robot's limp DAMP until the firmware restarts |
| A6 | **Ankle constants confirmed.** The firmware maps ankle pitch and roll to actuators with A = 2.02·pitch − 0.8·roll and B = −2.02·pitch − 0.8·roll. Our CAD measurement gives 2.019 and 0.800 with the same signs. The firmware uses this linear map, so the exact-closure deviation in A3 is a real tracking difference on the robot. | SDK `robots.py` citing firmware `policy_thread.c` (2026-09-28); `tools/measure-ankle.mjs` | Microscope shows the firmware constants (SOURCE SPEC) next to the CAD values; cited in its sources |
| A7 | **Actuator order.** Firmware reports 25 actuators in the order legs, left arm, right arm, waist, neck; the policy and MJCF use legs, waist, right arm, left arm (23, neck locked). Ankles are reported as motors A/B, not pitch/roll. | SDK `robots.py`, docs actuator map; `contract.json` | Joint explorer shows each joint's firmware ID and name (ankle joints: motors A and B); mapping table in `docs/SDK_REVIEW.md`; checked against the docs IDs in `tests/firmware.test.ts` |

## Docs revision (relaunched User Manual, re-pinned 2026-10-21)

Menlo announced the new manual on 2026-10-19. Export SHA-256 `ce14167f…` (2026-10-09) became
`7c7ac81c…` (2026-10-21); 86 of 174 pages changed, mostly photos, list formatting and a
threadlocker note on many steps.

| # | Finding | Evidence | Shown as |
| --- | --- | --- | --- |
| D1 | **Joint table source flagged as outdated.** The Mechanical System Tour page now says its images and descriptions from "Structural Architecture" onward are outdated and being updated (older illustrations show actuated toes). That section holds the actuator table, the joint limits and the parallel-ankle mapping behind J1–J5 and A1–A4. The extracted values are identical in both exports. | docs Mechanical System Tour, `tools/build-joint-specs.mjs` output unchanged | Still SOURCE SPEC; not yet stated in the app. Re-check when Menlo publishes the update |
| D2 | **Assembly steps.** The last step of both legs, the pelvis and both arms is now "… Verification" (a video check, no parts; same URLs). The torso gains Step 11 "Torso Verification", so it has 11 steps. Torso step 3 lists two more cables (1000 mm XT30 power cable, 300 mm JST-XH speaker cable) and step 4 two WAGO connectors. Part numbers, actuator IDs and fastener counts are unchanged. | `src/data/assembly.json`, `lessons.json` | BUILD follows the new export |
| D3 | **Threadlocker.** The docs changed LOCTITE 222 (low strength) to 242 (medium strength), matching the BOM, which already listed 242 ("Change Loctite 222 for 242"). New rule: no more than 10 hours of operation in total without threadlocker. | docs Tools & Supplies, Assembly Conventions, Finish Assembly; BOM | Not shown; BUILD links to the docs for instructions |

## Bill of materials

| # | Finding | Evidence | Shown as |
| --- | --- | --- | --- |
| B1 | Fasteners sheet totals: C38 `=SUM(C2:C37)` caches 987 and D38 `=SUM(D2:D37)` caches 1090, but both ranges are empty in the file. | workbook cells | Totals not used; marked unsupported |
| B2 | Four pivot tables; stray URL cells at Generic Total B8 and B18. | workbook | Ignored as data |
| B3 | Battery `ASV1_100_11X（已取消）` ("cancelled"). | workbook | Kept as written |
| B4 | Quantities missing for 400_08A, 400_09A, 400_10A. | workbook | "qty missing", never assumed 1 |
| B5 | Vendor literal "Company" on Generic row 36. | workbook | Kept as written |
| B6 | 300_22X / 300_23X conflict between sheets; the CAD geometry matches the A4310 actuators, supporting the Actuators sheet. | workbook, CAD | Both rows shown, conflict noted |
| B7 | `ASV1_500_31X` (with a trailing space) listed under module 600 (row 33); the CAD part there is 600_31X. | workbook, CAD | Noted on the part tag |
| B8 | The BOM has no rows for 500_14C and 600_14C (outer thigh housings present in the CAD and docs). | workbook, CAD | "No matching BOM row" |
| B9 | Arm bearing numbering differs between BOM and CAD (CAD uses 19X/21X). | workbook, CAD | Alias recorded |
| B10 | CAD product "ASV1_200_09" lacks the C suffix used elsewhere. | CAD | Alias recorded |
| B11 | Finish "Brass" for parts that are orange in Menlo's photos; material written "SML 316L" (for SLM). | workbook, photos | Finish quoted verbatim; colour from the photos is labelled ILLUSTRATIVE |

## Repository

| # | Finding | Evidence |
| --- | --- | --- |
| R1 | The asimov-1 README links `FABRICATION_MANIFEST.csv`, which is not in the repository at `f71f3fe`. | repository tree |
| R2 | The repository states CERN-OHL-S-2.0 (hardware) and GPL-2.0 (software) without saying which covers `sim-model/`. | README badges, licence files |
| R3 | The docs site states no licence; the BOM is distributed through an email form without a licence. | docs.menlo.ai |
