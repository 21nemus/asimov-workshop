// Source register for ASIMOV WORKSHOP: exact upstream revisions, files and SHA-256 hashes.
//
//   node tools/sources.mjs pin      hash the files in .reference-cache and (re)write references/pins.json
//   node tools/sources.mjs verify   re-hash the cache and compare with references/pins.json
//   node tools/sources.mjs fetch    re-create .reference-cache from the pins (git + LFS media URLs)
//
// The cache is git-ignored. references/pins.json is the record that ships with the repo.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHE = '.reference-cache';
const PINS = 'references/pins.json';
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const SOURCES = [
  {
    id: 'asimov-1@viewer-submodule', repository: 'https://github.com/menloresearch/asimov-1', commit: '35ae7b3581ce36762bfddb00b8fc5e7c957ee7fa',
    committed: '2026-09-28T14:18:34+08:00', title: 'fix(sim-model): Update urdf and xml motion range to align with the hardware limits (#25)',
    why: 'The asimov-1 revision the pinned policy viewer uses as its submodule: the simulation model of the baseline.',
    license: 'CERN-OHL-S-2.0 (HARDWARE-LICENSE.txt); repository software GPL-2.0 (SOFTWARE-LICENSE.txt)',
    dir: 'asimov-1@35ae7b3', files: ['sim-model/README.md', 'sim-model/xmls/asimov_1.xml', 'sim-model/urdf/asimov_1.urdf', 'sim-model/assets/meshes/*'],
  },
  {
    id: 'asimov-1@main', repository: 'https://github.com/menloresearch/asimov-1', commit: 'f71f3fe87ddfa6b7aac2a5cddeaad5dbbc19cca7',
    committed: '2026-10-06T08:34:17+08:00', title: 'Update latest Asimov v1 CAD files (#27)',
    why: 'Repository main at retrieval: full-body CAD assembly, part CAD, wiring tables and licences. sim-model/ is byte-identical to the submodule pin.',
    license: 'CERN-OHL-S-2.0 (HARDWARE-LICENSE.txt); repository software GPL-2.0 (SOFTWARE-LICENSE.txt)',
    gitObjects: ['README.md', 'HARDWARE-LICENSE.txt', 'SOFTWARE-LICENSE.txt', 'electrical/wiring/motor-wires.csv', 'electrical/wiring/misc-wires.csv', 'electrical/README.md', 'mechanical/naming_convention.png'],
    lfs: [
      { path: 'mechanical/ASV1/FullBodyAssembly/Asimov_1.STEP', cache: 'cad/Asimov_1.STEP' },
      { path: 'mechanical/ASV1/500/FABRICATION/MJF_PA12/ASV1_500_04C.STEP', cache: 'cad/ASV1_500_04C.STEP' },
      { path: 'mechanical/ASV1/500/FABRICATION/MJF_PA12/ASV1_500_14C.STEP', cache: 'cad/ASV1_500_14C.STEP' },
      { path: 'mechanical/ASV1/600/FABRICATION/MJF_PA12/ASV1_600_04C.STEP', cache: 'cad/ASV1_600_04C.STEP' },
      { path: 'mechanical/ASV1/600/FABRICATION/MJF_PA12/ASV1_600_14C.STEP', cache: 'cad/ASV1_600_14C.STEP' },
    ],
  },
  {
    id: 'humanoid-policy-viewer', repository: 'https://github.com/menloresearch/humanoid-policy-viewer', commit: '0c2107805ec2a82c2788b7e2fdd06c7aaa8e18a8',
    committed: '2026-10-06T13:06:37+08:00', title: 'Run policies from a local folder and refuse policies the viewer would run wrongly (#5)',
    why: 'Browser policy baseline: checkpoint, training env.yaml, reference policy contract, runtime source and dependency lock.',
    license: 'BSD-3-Clause (LICENSE); checkpoint folder model_aug_18_1 BSD-3-Clause per THIRD_PARTY_NOTICES.md; robot description CERN-OHL-S-2.0 (submodule)',
    dir: 'viewer',
    files: [
      'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'package.json', 'package-lock.json',
      'public/examples/checkpoints/asimov/reference_policy_config.json',
      'public/examples/checkpoints/asimov/model_aug_18_1/env.yaml',
      'public/examples/checkpoints/asimov/model_aug_18_1/policy_isaaclab_new.onnx',
      'src/simulation/main.js', 'src/simulation/mujocoUtils.js', 'src/simulation/policyRunner.js', 'src/simulation/envPolicyConfig.js',
      'src/simulation/observationHelpers.js', 'src/simulation/sceneOverlay.js', 'src/simulation/onnxHelper.js', 'src/simulation/policyState.js',
      'src/simulation/policyIO.js', 'src/simulation/benchmarkRunner.js', 'benchmark/METHODOLOGY.md', 'docs/policy-config.md',
    ],
  },
  {
    id: 'cyclotron', repository: 'https://github.com/menloresearch/cyclotron', commit: 'd970f0633a8794506b6f2bc897eba8c4e04e1e63',
    committed: null, title: 'HEAD of main at retrieval (2026-10-09)', why: 'Training framework, referenced only; not installed or executed.',
    license: 'BSD-3-Clause (GitHub API)', files: [],
  },
  {
    id: 'docs.menlo.ai', repository: 'https://docs.menlo.ai', commit: null,
    why: 'Hardware overview, system tour, part organisation and assembly steps. Full-text export used so the exact text read is hashable.',
    license: 'No licence stated on the documentation site (checked 2026-10-09). Text is paraphrased and linked, not copied.',
    dir: '.', files: ['docs-llms.txt', 'docs-llms-full.txt'], urls: ['https://docs.menlo.ai/llms.txt', 'https://docs.menlo.ai/llms-full.txt'],
  },
];

const USER_SUPPLIED = [
  { id: 'bom-workbook', name: 'Asimov 1 - Bill of Materials.xlsx', bytes: 791039, sha256: '5aedfcf9223ea6e4dd7ac8d98533ed66a75d1e63c22727d608f40614a70d3a90',
    identity: 'Cover!B3:B4: BOM-ASV1-001, "Public Release V1.1 – 2026"; scope "All parts for 1 robot"',
    use: 'Per-part quantity, material, finish and procurement facts are extracted with sheet+row provenance into src/data/bom.json. The workbook itself is not redistributed.',
    license: 'Not stated. Menlo distributes the BOM through an email request form on docs.menlo.ai. Redistribution of extracted facts needs the owner\'s review before public release.' },
  { id: 'lab-screenshots', name: 'Screenshot 2026-10-09 at 12.13.41 / 12.14.48 / 12.15.25 (.png)', sha256: ['399c9f6249a0393759bcf64d5fcf8d67e656c29aea49665c5a3d23e378b0a186', '8abf31d3548899a0fa751f8823ccf8dd3bd61cd6c3d8e9e5f0b09df5a0a775dd', 'f3aa74bca18e45aff51eb7246ee6bb5e03c41268d34340b0729ba6364da341d3'],
    use: 'Appearance reference for the original workshop scene and the photo-matched shell hue. Not shipped.', license: 'Third-party video frames; not redistributed.' },
];

function expand(dir, pattern) {
  if (!pattern.endsWith('/*')) return [pattern];
  const folder = pattern.slice(0, -2);
  return readdirSync(join(dir, folder)).sort().map((f) => `${folder}/${f}`);
}

function gitBlobSha256(repoDir, commit, path) {
  const bytes = execFileSync('git', ['-C', repoDir, 'show', `${commit}:${path}`], { maxBuffer: 1 << 30 });
  return createHash('sha256').update(bytes).digest('hex');
}

function pin() {
  const out = { generated: new Date().toISOString(), retrieved: '2026-10-09', note: 'Hashes are SHA-256 of the exact bytes read from the upstream revision.', sources: [], userSupplied: USER_SUPPLIED };
  for (const s of SOURCES) {
    const entry = { ...s, files: {} };
    delete entry.dir; delete entry.gitObjects; delete entry.lfs;
    if (s.dir) {
      const base = join(CACHE, s.dir);
      for (const pattern of s.files) for (const f of expand(base, pattern)) entry.files[f] = { sha256: sha256(join(base, f)), bytes: readFileSync(join(base, f)).length };
    }
    if (s.gitObjects) for (const f of s.gitObjects) entry.files[f] = { sha256: gitBlobSha256(join(CACHE, 'asimov-1'), s.commit, f) };
    if (s.lfs) for (const l of s.lfs) entry.files[l.path] = { sha256: sha256(join(CACHE, l.cache)), bytes: readFileSync(join(CACHE, l.cache)).length, transport: 'git-lfs media endpoint', mediaUrl: `https://media.githubusercontent.com/media/menloresearch/asimov-1/${s.commit}/${l.path}` };
    if (s.id === 'docs.menlo.ai') entry.retrievedAt = readFileSync(join(CACHE, 'docs-retrieved-at.txt'), 'utf8').trim();
    out.sources.push(entry);
  }
  mkdirSync('references', { recursive: true });
  writeFileSync(PINS, JSON.stringify(out, null, 1) + '\n');
  console.log(`wrote ${PINS}: ${out.sources.reduce((n, s) => n + Object.keys(s.files).length, 0)} hashed files`);
}

function verify() {
  const pins = JSON.parse(readFileSync(PINS, 'utf8'));
  let bad = 0, checked = 0;
  for (const s of pins.sources) {
    const def = SOURCES.find((d) => d.id === s.id);
    for (const [f, meta] of Object.entries(s.files)) {
      let actual;
      if (def.lfs?.some((l) => l.path === f)) actual = sha256(join(CACHE, def.lfs.find((l) => l.path === f).cache));
      else if (def.gitObjects?.includes(f)) actual = gitBlobSha256(join(CACHE, 'asimov-1'), def.commit, f);
      else actual = sha256(join(CACHE, def.dir, f));
      checked++;
      if (actual !== meta.sha256) { bad++; console.error(`MISMATCH ${s.id} ${f}`); }
    }
  }
  console.log(`${checked} files checked, ${bad} mismatches`);
  if (bad) process.exit(1);
}

function fetchAll() {
  mkdirSync(join(CACHE, 'cad'), { recursive: true });
  const repo = join(CACHE, 'asimov-1');
  if (!existsSync(repo)) {
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/menloresearch/asimov-1.git']);
  }
  const a = SOURCES[0], m = SOURCES[1], v = SOURCES[2];
  execFileSync('git', ['-C', repo, 'fetch', '-q', '--depth', '1', 'origin', a.commit, m.commit], { stdio: 'inherit', env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } });
  if (!existsSync(join(CACHE, a.dir))) execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', join('..', a.dir), a.commit]);
  for (const l of m.lfs) {
    const dest = join(CACHE, l.cache);
    if (!existsSync(dest)) execFileSync('curl', ['-sS', '-L', '--retry', '3', '-o', dest, `https://media.githubusercontent.com/media/menloresearch/asimov-1/${m.commit}/${l.path}`], { stdio: 'inherit' });
  }
  if (!existsSync(join(CACHE, v.dir))) {
    execFileSync('git', ['clone', '-q', '--depth', '1', v.repository + '.git', join(CACHE, v.dir)], { stdio: 'inherit' });
    execFileSync('git', ['-C', join(CACHE, v.dir), 'fetch', '-q', '--depth', '1', 'origin', v.commit]);
    execFileSync('git', ['-C', join(CACHE, v.dir), 'checkout', '-q', '--detach', v.commit]);
  }
  for (const [i, u] of SOURCES[4].urls.entries()) {
    const dest = join(CACHE, SOURCES[4].files[i]);
    if (!existsSync(dest)) execFileSync('curl', ['-sS', '-L', '-o', dest, u]);
  }
  console.log('cache ready; run `node tools/sources.mjs verify` (docs text may have changed upstream since the pin).');
}

const cmd = process.argv[2];
if (cmd === 'pin') pin();
else if (cmd === 'verify') verify();
else if (cmd === 'fetch') fetchAll();
else console.log('usage: node tools/sources.mjs pin|verify|fetch');
