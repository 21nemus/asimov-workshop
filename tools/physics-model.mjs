// Builds the physics-only variant of the pinned Asimov MJCF: every visual mesh geom
// (class="visual": contype 0, conaffinity 0, density 0, group 2) and every <mesh>
// asset is removed. All bodies carry explicit <inertial> elements, so these geoms
// never contribute mass, inertia or contacts. tools/check-physics-equivalence.mjs
// verifies that the stripped model produces bit-identical trajectories.
export function physicsOnlyXml(xml) {
  let out = xml.replace(/<!--[\s\S]*?-->/g, '');
  const before = (out.match(/<geom\b[^>]*class="visual"[^>]*\/>/g) ?? []).length;
  out = out.replace(/[ \t]*<geom\b[^>]*class="visual"[^>]*\/>\r?\n?/g, '');
  const meshes = (out.match(/<mesh\b[^>]*\/>/g) ?? []).length;
  out = out.replace(/[ \t]*<mesh\b[^>]*\/>\r?\n?/g, '');
  if (/type="mesh"/.test(out)) throw new Error('a mesh geom outside class="visual" remains');
  return { xml: out, removedGeoms: before, removedMeshes: meshes };
}
