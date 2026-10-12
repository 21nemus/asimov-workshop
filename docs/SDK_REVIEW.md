# Menlo SDK review (read-only)

Date: 2026-10-12. Scope: compare Menlo's newly open-sourced Python SDK and its documentation with
ASIMOV WORKSHOP. Nothing was installed, no robot was contacted, no command was sent, and the
verified MuJoCo and policy implementation is unchanged. The SDK source was cloned into a scratch
folder for reading only.

## Revisions examined

| Source | Revision | Licence |
| --- | --- | --- |
| `menloresearch/menlo-sdk` | `7683801135a39c5881701646119e83397274c3db` (2026-10-12, 40 commits since 2026-09-04) | Apache-2.0 |
| docs.menlo.ai (`llms-full.txt`, includes /sdk and /asimov/1/program/api) | SHA-256 `ce14167f…` (byte-identical to the export pinned on 2026-10-09) | none stated |
| `asimov-protocol` (PyPI, generated `asimov.io` protobuf bindings) | 1.3.0rc4 latest; SDK requires `>=1.2.1rc1,<2` | MIT (PyPI metadata); source repo not public |
| Firmware and Asimov Edge source | not public (`asimov-firmware`, `asimov-edge`, `asimov-protocol` repos return 404) | n/a; facts reach us through SDK comments and docs |

Related drift noticed while checking: `humanoid-policy-viewer` moved from our pin `0c21078` to
`e115f3593bed4a61727e6b3b67b3a4914ed20a5c` (2026-10-12, "Add benchmarking features"), which
modifies `src/simulation/main.js` (+564 −325) and `envPolicyConfig.js`. `cyclotron` moved to
`85d845e` (2026-10-12). Our baseline claims are tied to the pinned `0c21078` and remain valid;
re-verifying against the new viewer is follow-up work.

## What the SDK is

A Python 3.12+ client (`pip install menlo-sdk`, module `menlo.asimov`, CLI `menlo`) for a real
Asimov 1. One `Robot` object, three connection modes:

| Mode | Control and state | State rate | Media |
| --- | --- | --- | --- |
| `udp` | UDP 8850 (commands) / 8851 (state), one bare `asimov.io` protobuf per datagram | 200 Hz | none |
| `hybrid` | UDP as above | 200 Hz | LiveKit camera, microphone, speaker |
| `livekit` | LiveKit data topic and data tracks, same protobuf bytes | 10 Hz | LiveKit |

Verbs: `stand()`, `balance()`, `set_velocity()`, `set_joints()` (minimum-jerk, 50 Hz),
`trajectory()` (raw 25-joint setpoint), `damp()`; waits on reported state (`wait_until`);
`record()` to JSON lines; camera and audio helpers. Commands go to **Asimov Edge** (the robot's
onboard service on the Raspberry Pi 5 in the head), which arbitrates between controllers
(Asimov Manager cockpit, then a paired gamepad, then UDP, then LiveKit), fills PD gains,
gates by mode and forwards to the motion-control firmware on the Radxa CM5 in the torso. The
walking policy runs on the CM5 at 50 Hz against the 23-DOF body model with the neck locked.

## 1. Do we already use any SDK components, protocols or packages?

No. `package.json` has no `menlo-sdk`, `asimov-protocol`, `livekit` or `protobuf`; the app never
opens a network connection beyond its own files. What we share with the SDK is documentation:
the joint and actuator table (`src/data/joint-specs.json`) and the ankle limits come from the same
docs.menlo.ai export the SDK links to.

## 2. Useful functionality we do not have

| SDK fact or feature | Source | Relevance to us |
| --- | --- | --- |
| Firmware ankle coupling `A = 2.02·pitch − 0.8·roll`, `B = −2.02·pitch − 0.8·roll`, limits 0.35 / 0.10 rad | `robots.py` (citing firmware `policy_thread.c`, 2026-09-28) | **Independent confirmation of our CAD measurement**: we derived 2.019 and 0.800 with the same signs. Also shows the robot controls the ankle with the linear map, so our exact-closure comparison describes a real tracking error, not a docs curiosity. |
| Firmware velocity caps 0.4 m/s forward and sideways, 0.8 rad/s turning | `_command.py`, REFERENCE safety model | Training range is vx −0.6 to 0.8; our TEST preset and the WATCH scenario use 0.5 m/s (the upstream viewer's baseline), above what the real firmware accepts. Worth stating in TEST. |
| Firmware modes DAMP / STAND / MOVE (POLICY or TRAJECTORY) / FAULT_DAMP; faults latch until restart | `_state.py`, docs Robot Control | Our TEST shows the viewer's simulated fall hold. The real robot differs (next row). |
| Fall handling on hardware: `FALL_DETECTED` is a critical alert; DAMP is limp (actuators compliant) and latched until the firmware restarts; `upright` vs fall trip at projected gravity z above −0.5 (about 60°) | `_state.py` docstrings, docs | The viewer (and our TEST, faithfully) switches to a soft hold (kp 10, kd 3) at about 80° and resets on demand. Educational contrast, already partly stated ("not a learned recovery"). |
| Arming: STAND held upright (gravity z below −0.87) for 0.5 s before MOVE | `robot.py` | Explains the real bring-up sequence (BUILD → bring up → TEST). |
| 38 named firmware alerts (motor overtemp, CAN faults, policy deadline miss, BMS) | `_state.py` | Glossary material for an "on the real robot" note. |
| Per-actuator current and temperature, IMU quaternion/gyro/gravity, battery, at 200 Hz | `_state.py`, wire format | We show simulated torque only. |
| JSON-lines recordings (`robot.record`) | `recording.py` | See section 3. |

## 3. Could SDK recordings drive a read-only "Real Robot Replay"?

**Technically yes, with limits; we have no recording to replay.**

Format: one JSON object per line, `{"t": <monotonic s>, "kind": "state" | "sent", ...}`. State lines
carry `mode`, `joints[{name, pos, vel, current, temp}]` (25, firmware names and order), `gravity`,
`gyro`, `quat` (w, x, y, z), `error_flags`, `alerts`, `battery`, `sequence`, `fw_timestamp_us`;
"sent" lines carry the command. 200 Hz over UDP, 10 Hz over LiveKit.

What maps cleanly onto our rig:
- 21 of 25 actuators map one-to-one by name to our hinges (`L_Hip_Pitch` → `left_hip_pitch_joint`).
  Order differs (firmware: legs, left arm, right arm, waist, neck; ours: legs, waist, right arm,
  left arm), so mapping must be by name, never by index.
- Ankles are reported as motors A and B. Our `AnkleLinkage` converts them two ways: the
  firmware's own linear inverse (what the controller believes) and our exact CAD forward
  kinematics (where the foot physically is). Showing both is a strong educational view.

What does not map, and must be labelled:
- **No root position.** The firmware has no odometry ("deliberately no pose"). A replay can show
  joint motion and body attitude from the IMU quaternion (yaw relative to start), but not where
  the robot walked. Options: pelvis pinned at a nominal height (labelled), or a gantry view.
- **Neck yaw and pitch** are fixed in our simulation model. The CAD has the neck bodies, but the
  pivot positions would have to be measured from the CAD (CAD DERIVED) before the head can move.
- **Zero offsets and signs** between firmware joint angles and the MJCF are not documented beyond
  axis directions; they must be verified against a real recording before any replay is shown.
- IMU mounting relative to the pelvis frame is unverified.

Integration complexity: medium. A local, read-only importer (file chosen by the user, no
network), a name map, ankle conversion, attitude-only base, a timeline, and tests with fixtures
clearly labelled as synthetic. No SDK code is needed (the format is plain JSON). The feature
must not ship until a real, attributable recording exists; a synthetic demo recording would
count as faking hardware behaviour.

## 4. 25-actuator firmware interface vs our 23-joint simulation interface

| Firmware (ID, name) | Our simulation | Notes |
| --- | --- | --- |
| 1–4 `L_Hip_Pitch` … `L_Knee` | policy 0–3 | same names, same order |
| 5–6 `L_Ankle_A`, `L_Ankle_B` (motors) | policy 4–5 `left_ankle_pitch/roll` (joint space) | linkage between them; firmware linear map, our exact closure |
| 7–10 `R_Hip_Pitch` … `R_Knee` | policy 6–9 | same order |
| 11–12 `R_Ankle_A`, `R_Ankle_B` | policy 10–11 pitch/roll | as above |
| 13–17 `L_Shoulder_Pitch` … `L_Wrist_Yaw` | policy 18–22 | reordered |
| 18–22 `R_Shoulder_Pitch` … `R_Wrist_Yaw` | policy 13–17 | reordered |
| 23 `Waist_Yaw` | policy 12 | reordered |
| 24–25 `Neck_Yaw`, `Neck_Pitch` | none (fixed in MJCF) | the policy runs with the neck locked on the robot too |

The real policy also runs at 50 Hz on the 23-DOF model, matching the viewer's rate. Trajectory
commands (direct joint control) carry all 25 targets with ankles as pitch/roll on the wire; the
SDK converts from motor frame. Gains: Edge fills its own per-joint table when kp/kd are omitted
(kp 0–500, kd 0–5 accepted); that table is not published, so it cannot be compared with env.yaml.

## 5. Could the SDK's states and docs improve our educational views?

Yes, as text and labels (no new mechanics):
- TEST: say plainly what the real robot does differently on a fall (limp, latched, restart) and
  that the firmware caps walking at 0.4 m/s; mark the cap on the speed slider.
- UNDERSTAND joint explorer: show the firmware actuator ID and name next to each joint
  (`left_knee_joint` = ID 4 `L_Knee`), and the neck as "powered on the robot, locked for walking".
- Ankle microscope: cite the firmware constants 2.02 and 0.8 (SOURCE SPEC, firmware via SDK) next
  to our CAD-derived 2.019 and 0.800, and explain that the firmware uses the linear map.
- A short "from simulation to the robot" note: the same policy, at 50 Hz, on the CM5; Edge on the
  Pi 5 arbitrates commands; DAMP is not an emergency stop.

## 6. Asimov Edge material

What is open: documentation (software overview, API, wire format, safety model) and the SDK that
speaks to Edge. What is not: the Edge and firmware source and the protocol definitions' repository
(the PyPI bindings are MIT). Nothing in it changes our simulator: Edge is a robot-side service
(command arbitration, media, networking, diagnostics), and our physics already reproduces the
policy loop the firmware runs. Its value for us is explanatory (architecture and safety facts) and
as the source of the facts above. Edge diagnostics report ONNX inference timing on the robot; we
could compare with our browser timing in text, nothing more.

## Recommendation

| | v1 (publication) | Future release |
| --- | --- | --- |
| SDK code | none | none needed (recordings are plain JSON) |
| Docs | this review; DISCREPANCIES rows for the velocity cap, real fall behaviour and the ankle constants (done, docs only) | |
| UI text (needs approval) | firmware velocity cap note in TEST; firmware IDs in the joint explorer; ankle constants citation in the microscope; real-robot fall behaviour note | |
| Features (need approval) | none | read-only Real Robot Replay from a real, attributed recording; neck joints measured from CAD; an "on the real robot" panel; re-verification against viewer `e115f35` |

Licensing: the SDK is Apache-2.0; citing its facts with attribution needs nothing more; copying
code (for example the alert name table) would need the Apache-2.0 notice, compatible with our MIT
code. Firmware facts are quoted from the SDK's comments, which cite private firmware files.
