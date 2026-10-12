// Actuator overlay, same rule as the upstream viewer's sceneOverlay.js
// (menloresearch/humanoid-policy-viewer@0c21078, BSD-3-Clause): the Asimov MJCF ships
// without <actuator>s, so one unclamped torque <motor> is spliced in per class="motor"
// joint, in document order, before compile. Torque caps come later from the policy's
// env.yaml (see policy-contract.ts), never from this overlay.

export function motorJointNames(xml: string): string[] {
  const names: string[] = [];
  for (const [tag] of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<joint\b[^>]*>/g)) {
    if (!/\bclass="motor"/.test(tag)) continue;
    const name = tag.match(/\bname="([^"]+)"/)?.[1];
    if (name) names.push(name);
  }
  return names;
}

export function withActuatorOverlay(xml: string): string {
  if (/<actuator[\s>]/.test(xml)) return xml;
  const joints = motorJointNames(xml);
  if (!joints.length) throw new Error('the MJCF defines no <actuator>s and no class="motor" joints to add them for');
  const closing = xml.lastIndexOf('</mujoco>');
  if (closing < 0) throw new Error('the MJCF has no closing </mujoco> tag');
  const block = `  <actuator>\n${joints.map((j) => `    <motor name="${j.replace(/_joint$/, '')}" joint="${j}"/>`).join('\n')}\n  </actuator>\n`;
  return xml.slice(0, closing) + block + xml.slice(closing);
}
