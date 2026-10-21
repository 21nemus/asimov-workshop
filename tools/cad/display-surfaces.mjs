// Display-only conditioning before OCCT tessellation. Never write this text over
// the engineering STEP source. See docs/THIGH_MESH_FIX.md for the measured case.
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][+-]?\\d+)?';
const TORUS = new RegExp(`^(#(\\d+)\\s*=\\s*)TOROIDAL_SURFACE\\s*\\(\\s*('(?:[^']|'')*')\\s*,\\s*(#\\d+)\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)\\s*;`, 'gm');

/**
 * A torus with major radius R=0 is a sphere of its minor radius r.
 * The pinned CAD contains R=-0.000137970042855 mm caps. OCCT's periodic
 * torus trimming produces folded triangles extending tens of mm beyond their
 * edge loops. Use the limiting spherical surface for display, retaining the
 * entity ID, placement, minor radius and every original face/edge/trim reference.
 * At matching (u,v), the surface displacement is exactly |R|.
 * Restrict it to <=0.5 micrometres AND <=1/100 of the tessellation tolerance
 * AND <=1e-5 of r; real toroidal fillets must not be changed.
 */
export function conditionDisplaySurfaces(text, linearDeflectionMm = 0.05) {
  if (!Number.isFinite(linearDeflectionMm) || linearDeflectionMm <= 0) throw new Error('invalid tessellation tolerance');
  const corrections = [];
  const conditioned = text.replace(TORUS, (original, prefix, id, name, placement, majorText, minorText) => {
    const major = Number(majorText), minor = Number(minorText);
    const limit = Math.min(0.0005, linearDeflectionMm / 100, minor * 1e-5);
    if (!Number.isFinite(major) || !Number.isFinite(minor) || minor <= 0 || Math.abs(major) > limit) return original;
    corrections.push({ entity: Number(id), from: 'TOROIDAL_SURFACE', to: 'SPHERICAL_SURFACE', majorRadiusMm: major, minorRadiusMm: minor, maxSurfaceDeviationMm: Math.abs(major) });
    return `${prefix}SPHERICAL_SURFACE ( ${name}, ${placement}, ${minorText} ) ;`;
  });
  return { text: conditioned, corrections };
}
