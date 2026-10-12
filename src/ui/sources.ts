// Sources drawer: what this workshop is built from, at which exact revision, under which licence,
// and which values are hardware facts versus simulation or illustration.
import { h } from './dom.ts';
import { icon, stamp } from './components.ts';
import { BOM } from '../catalog/catalog.ts';
import { SUPPORT, supportReady } from '../config/support.ts';

const a = (href: string, text: string) => h('a', { class: 'ext', href, target: '_blank', rel: 'noopener' }, text, icon('link'));

function source(title: string, lines: (string | Node)[], links: [string, string][], badge?: Parameters<typeof stamp>[0]): HTMLElement {
  return h('div', { class: 'src' }, h('p', { class: 'src__title' }, title, badge ? [' ', stamp(badge)] : null), ...lines.map((l) => h('p', { style: 'margin:2px 0' }, l)), h('p', { class: 'row', style: 'margin:6px 0 0' }, ...links.map(([u, t]) => a(u, t))));
}

export function sourcesContent(): HTMLElement {
  return h('div', null,
    h('p', { class: 'lede' }, 'ASIMOV WORKSHOP is an independent educational project. It is not affiliated with or endorsed by Menlo Research. Everything shown below is pinned to an exact revision.'),
    h('h3', null, 'Robot'),
    source('Asimov 1 CAD (full-body assembly, 1,184 part instances)', ['menloresearch/asimov-1 @ f71f3fe (2026-10-06), mechanical/ASV1/FullBodyAssembly/Asimov_1.STEP, 520 MB. Tessellated, registered to the simulation model and simplified by this project.', 'Licence: CERN-OHL-S-2.0. Derived meshes keep that licence.'], [['https://github.com/menloresearch/asimov-1/tree/f71f3fe87ddfa6b7aac2a5cddeaad5dbbc19cca7/mechanical/ASV1', 'CAD at f71f3fe']], 'SOURCE SPEC'),
    source('Simulation model (MJCF)', ['menloresearch/asimov-1 @ 35ae7b3 (the policy viewer’s pinned submodule), sim-model/xmls/asimov_1.xml. 23 hinge joints, neck fixed, 32.22 kg. Visual meshes removed for physics; dynamics verified identical.'], [['https://github.com/menloresearch/asimov-1/tree/35ae7b3581ce36762bfddb00b8fc5e7c957ee7fa/sim-model', 'sim-model at 35ae7b3']], 'SIM VALUE'),
    source('Bill of materials', [`${BOM.source.document}, ${BOM.source.revision}. Per-part facts are shown with their sheet and row; the workbook itself is not redistributed.`, BOM.source.licence], [], 'SOURCE SPEC'),
    source('Documentation', ['docs.menlo.ai assembly steps, system tour and part organisation, retrieved 2026-10-09 (full-text export, SHA-256 pinned). Step titles and counts are cited and linked.'], [['https://docs.menlo.ai/asimov/1/overview', 'Asimov 1 docs'], ['https://docs.menlo.ai/asimov/1/build/assembly-steps', 'Assembly steps']], 'SOURCE SPEC'),
    h('h3', null, 'Policy and physics'),
    source('Walking policy model_aug_18_1', ['menloresearch/humanoid-policy-viewer @ 0c21078. ONNX MLP 78 → 512 → 256 → 128 → 23, trained in Isaac Lab (PhysX). Gains, torque limits, default pose and action scale from its env.yaml.', 'Licence: BSD-3-Clause (viewer notices). Run here in MuJoCo: a sim-to-sim transfer, not a hardware result.'], [['https://github.com/menloresearch/humanoid-policy-viewer/tree/0c2107805ec2a82c2788b7e2fdd06c7aaa8e18a8', 'Viewer at 0c21078']], 'SIM VALUE'),
    source('Physics engine', ['MuJoCo 3.3.8 compiled to WebAssembly (mujoco-js 0.0.7, the version the upstream viewer locks). Apache-2.0.'], [['https://github.com/google-deepmind/mujoco', 'MuJoCo']]),
    h('h3', null, 'How to read the labels'),
    h('p', null, stamp('SOURCE SPEC'), ' stated in Menlo documentation, the BOM or the CAD.'),
    h('p', null, stamp('SIM VALUE'), ' a value of the simulation model or policy configuration.'),
    h('p', null, stamp('CAD DERIVED'), ' measured from the published CAD by this project.'),
    h('p', null, stamp('APPROXIMATION'), ' a simplified model, valid only in the range stated.'),
    h('p', null, stamp('ILLUSTRATIVE'), ' shown to explain; not specified by any source.'),
    h('h3', null, 'This project'),
    h('p', null, 'Original code and original workshop assets by @21nemus. The lab is inspired by Menlo’s lab, not a replica of it. See the repository’s docs/SOURCES.md, docs/LICENSES.md and docs/DISCREPANCIES.md for the full register.'),
    supportReady() ? supportCard() : null,
  );
}

/** Rendered only when the maintainer has enabled support and added verified entries. */
function supportCard(): HTMLElement {
  return h('div', { class: 'src' },
    h('p', { class: 'src__title' }, 'Support this project'),
    SUPPORT.message ? h('p', { style: 'margin:2px 0' }, SUPPORT.message) : null,
    ...SUPPORT.links.filter((l) => /^https:\/\//.test(l.url)).map((l) => h('p', { style: 'margin:2px 0' }, a(l.url, l.label))),
    ...SUPPORT.addresses.filter((x) => x.address.trim()).map((x) => h('p', { style: 'margin:4px 0' }, `${x.network}: `, h('code', { class: 'mono', style: 'user-select:all;overflow-wrap:anywhere' }, x.address), x.note ? h('small', { style: 'display:block;color:var(--ink-3)' }, x.note) : null)),
    h('p', { class: 'fine' }, 'Plain links and addresses only: nothing here connects a wallet or sends anything.'),
  );
}
