import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionDisplaySurfaces } from '../tools/cad/display-surfaces.mjs';

const R = -0.0001379700428550972, r = 60;
const source = `#19371 = TOROIDAL_SURFACE ( 'NONE', #4484, ${R}, ${r} ) ;\n#24797 = ADVANCED_FACE ( '', ( #1 ), #19371, .T. ) ;`;

test('near-spherical STEP torus conditioning keeps identity, placement and trim references', () => {
  const result = conditionDisplaySurfaces(source);
  assert.match(result.text, /#19371 = SPHERICAL_SURFACE \( 'NONE', #4484, 60 \)/);
  assert.equal(result.text.split('\n')[1], source.split('\n')[1]);
  assert.equal(result.corrections.length, 1);
  assert.equal(result.corrections[0].maxSurfaceDeviationMm, Math.abs(R));
  assert.equal(conditionDisplaySurfaces(result.text).text, result.text);
  // Independent parameterization of torus and sphere: the surface error bound
  // must hold everywhere, including the periodic seam and both poles.
  for (let a = 0; a <= 36; a++) for (let b = -18; b <= 18; b++) {
    const u = a * Math.PI / 18, v = b * Math.PI / 18;
    const torus = [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
    const sphere = [r * Math.cos(v) * Math.cos(u), r * Math.cos(v) * Math.sin(u), r * Math.sin(v)];
    assert.ok(Math.hypot(...torus.map((x, i) => x - sphere[i])) <= Math.abs(R) + 1e-12);
  }
});

test('real toroidal fillets and surfaces outside the display error budget stay unchanged', () => {
  for (const [major, minor] of [[-439.479852464855, 507], [20, 2], [0.001, 60], [0.0001, 0.1], [0.0001, -60]]) {
    const text = `#1 = TOROIDAL_SURFACE ( 'NONE', #2, ${major}, ${minor} ) ;`;
    assert.equal(conditionDisplaySurfaces(text).text, text);
    assert.equal(conditionDisplaySurfaces(text).corrections.length, 0);
  }
  assert.equal(conditionDisplaySurfaces(source, 0.001).text, source);
  assert.throws(() => conditionDisplaySurfaces(source, 0));
  assert.throws(() => conditionDisplaySurfaces(source, NaN));
  assert.equal(conditionDisplaySurfaces("#1 = TOROIDAL_SURFACE ( 'edge''s cap', #2, +1.3E-4, 6E1 ) ;").corrections.length, 1);
});
