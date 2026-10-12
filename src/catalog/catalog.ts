// Source-backed lookups for a selected part: BOM records (by sheet and row), the assembly step
// that places it, its documented role, and known discrepancies. Raw values are never merged.
import bomData from '../data/bom.json' with { type: 'json' };
import lessonsData from '../data/lessons.json' with { type: 'json' };
import assemblyData from '../data/assembly.json' with { type: 'json' };
import type { PartInfo } from '../robot/robot-model.ts';

export interface BomRecord {
  id: string;
  sheet: string;
  row: number;
  kind: string;
  subAssembly: string | null;
  partNameRaw: string | null;
  partNumber: string | null;
  qty: number | null;
  qtyRaw: string | null;
  material: string | null;
  finish: string | null;
  description: string | null;
  sku: string | null;
  vendor: string | null;
  url: string | null;
  raw: Record<string, string>;
  flags: string[];
}

export interface LessonStep {
  id: string;
  n: number;
  title: string;
  group: string;
  url: string;
  requires: string[];
  parts: number[];
  fastenerGroups: { name: string; type: string | null; docsCount: number | null; countNote: string | null; cad: number[]; status: string }[];
  cables: { name: string; count: number | null; countNote: string | null }[];
  consumables: { name: string; count: number | null; countNote: string | null }[];
  carried: { text: string; count: number | null }[];
  notes: string[];
}

export interface Lesson {
  id: string;
  label: string;
  steps: LessonStep[];
  prepared: number[];
  unplaced: number[];
}

export const BOM = bomData as unknown as { source: { document: string; revision: string; sha256: string; licence: string }; records: BomRecord[]; conflicts: { partNumber: string; records: string[]; kinds: string[]; descriptions: string[]; note?: string }[]; totals: { sheet: string; cell: string | null; value: string | null; cached: string | null; status: string }[] };
export const LESSONS = (lessonsData as unknown as { lessons: Lesson[] }).lessons;
export const ASSEMBLY = assemblyData as unknown as { source: { origin: string; sha256: string; retrievedAt: string }; modules: { id: string; label: string; steps: { id: string; url: string; title: string }[] }[]; finish: { title: string; url: string } };

const MODULE_LABEL: Record<string, string> = {
  ASV1_200: 'Pelvis', ASV1_300: 'Right arm', ASV1_400: 'Left arm', ASV1_500: 'Right leg', ASV1_600: 'Left leg', ASV1_700: 'Head', ASV1: 'Torso', Asimov_1: 'Module joints',
};
export const moduleLabel = (m: string) => MODULE_LABEL[m] ?? m;

/** Documented roles of the left-leg parts (from the assembly step pages), and generic families. */
const ROLES: Record<string, string> = {
  '02X': 'Hip yaw actuator (ENCOS EC-A3814-H14-107)',
  '03C': 'Thigh housing: holds the hip yaw actuator and the knee actuator',
  '04C': 'Outer thigh housing (9 holes)',
  '14C': 'Outer thigh housing (8 holes)',
  '05A': 'Knee actuator mount',
  '06A': 'Plate over the knee actuator, fixed to the thigh housing',
  '07X': 'Knee actuator (ENCOS EC-A4315-P2-36)',
  '12A': 'L-shaped plate in the thigh housing groove',
  '01B': 'Actuator hub: joins the leg to the pelvis module',
  '10C': 'Calf (knee housing): carries both ankle actuators',
  '08A': 'Knee side plate over the bearing',
  '09A': 'Knee side plate on the knee actuator output',
  '11X': 'Flanged ball bearing',
  '13C': 'Calf rear cover',
  '15X': 'Ankle actuator A (ENCOS EC-A4310-P2-36), nearer the knee',
  '16X': 'Ankle actuator B (ENCOS EC-A4310-P2-36), nearer the ankle',
  '17B': 'Ankle crank on actuator A',
  '18B': 'Ankle crank on actuator B',
  '19X': 'Ball joint rod end on the foot shaft',
  '20X': 'Ball joint rod end on the foot shaft',
  '21X': 'Ball joint rod end on a crank',
  '22X': 'Ball joint rod end on a crank',
  '23A_SS': 'Push rod, 194 mm stainless steel bar (to crank A)',
  '24A_SS': 'Push rod, 124 mm stainless steel bar (to crank B)',
  '25A': 'Foot pivot plate, bolted into the calf',
  '26B': 'Foot pivot cross block (two axes)',
  '27X': '12 mm pillow block, foot pivot',
  '28X': '12 mm pillow block, foot pivot',
  '29X': '12 mm pillow block, foot pivot',
  '30X': '12 mm pillow block, foot pivot',
  '31X': '6 mm D-shaft carrying the lower rod ends',
  '36A': 'Foot plate',
  '37C': 'Foot shell',
  '39C': 'Sole plate',
};

export function roleOf(p: PartInfo): string {
  const id = p.partNumber?.replace(/^ASV1_\d{3}_/, '');
  if (id && (p.module === 'ASV1_600' || p.module === 'ASV1_500') && ROLES[id]) return ROLES[id];
  // BOM descriptions are quoted verbatim, so they appear in quotation marks.
  if (p.description) return `“${p.description.trim()}”`;
  if (p.kind === 'actuator') return `Actuator${p.model ? ` (ENCOS ${p.model})` : ''}`;
  if (/Insert/i.test(p.name)) return 'Heat-set threaded insert (pre-installed in the printed part)';
  if (/DIN 912/.test(p.name)) return 'Socket head cap screw';
  if (/DIN 7991/.test(p.name)) return 'Countersunk (flat) screw';
  if (/Locknut/i.test(p.name)) return 'Nylon-insert locknut';
  if (/Washer/i.test(p.name)) return 'Washer';
  if (/Square Nut/i.test(p.name)) return 'Square nut';
  if (/1602-0032/.test(p.name)) return 'Pillow block (goBILDA 1602 series)';
  if (/1600-0515/.test(p.name)) return 'Bearing for the pillow block';
  if (/2920-0001/.test(p.name)) return 'Set-screw collar (goBILDA 2920 series)';
  if (p.kind === 'electronics') return 'Electronics';
  if (p.kind === 'fabricated') return p.cls === 'pa12-black' || p.cls === 'shell-paint' ? 'Printed part (MJF PA12)' : p.cls === 'al-anodized' ? 'Machined aluminium part' : 'Fabricated part';
  return 'Part';
}

/** Every BOM record for a part, cancelled lines included (shown with their flag). */
export function bomRecords(p: Pick<PartInfo, 'bomPartNumber' | 'partNumber'>): BomRecord[] {
  const pn = p.bomPartNumber ?? p.partNumber;
  if (!pn) return [];
  return BOM.records.filter((r) => r.partNumber === pn);
}

/** Records that describe the robot as built: lines the workbook marks cancelled are excluded. */
export function activeBomRecords(p: Pick<PartInfo, 'bomPartNumber' | 'partNumber'>): BomRecord[] {
  return bomRecords(p).filter((r) => !r.flags.includes('cancelled'));
}

export function stepOf(p: PartInfo): { lesson: Lesson; step: LessonStep; via: 'part' | 'fastener' } | null {
  for (const lesson of LESSONS) for (const step of lesson.steps) {
    if (step.parts.includes(p.i)) return { lesson, step, via: 'part' };
    if (step.fastenerGroups.some((g) => g.cad.includes(p.i))) return { lesson, step, via: 'fastener' };
  }
  return null;
}

export function lesson(id: string): Lesson {
  const l = LESSONS.find((x) => x.id === id);
  if (!l) throw new Error(`no lesson ${id}`);
  return l;
}
