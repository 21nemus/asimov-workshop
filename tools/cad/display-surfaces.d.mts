export interface DisplaySurfaceCorrection {
  entity: number;
  from: 'TOROIDAL_SURFACE';
  to: 'SPHERICAL_SURFACE';
  majorRadiusMm: number;
  minorRadiusMm: number;
  maxSurfaceDeviationMm: number;
}

export function conditionDisplaySurfaces(text: string, linearDeflectionMm?: number): {
  text: string;
  corrections: DisplaySurfaceCorrection[];
};
