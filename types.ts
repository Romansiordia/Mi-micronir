
export interface WavelengthPoint {
  nm: number;
  absorbance: number;
  raw?: number;
}

export type CalibrationStep = 'none' | 'dark' | 'reference' | 'ready';

export interface CalibrationData {
  dark: number[] | null;
  reference: number[] | null;
  step: CalibrationStep;
}

export interface ChemometricModel {
  name: string;
  bias: number;
  betaCoefficients: number[];
  wavelengths: number[];
}

export type LampStatus = 'ok' | 'error_nan' | 'off' | 'unknown';

export interface DeviceInfo {
  serialNumber: string;
  model: string;
  temperature: number;
  firmware: string;
  pixelCount: number;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success' | 'warning';
}
