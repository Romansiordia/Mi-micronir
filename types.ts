
export interface WavelengthPoint {
  nm: number;
  absorbance: number;
}

export interface ChemometricModel {
  name: string;
  bias: number;
  betaCoefficients: number[];
  wavelengths: number[];
}

export type LampStatus = 'ok' | 'error_nan' | 'off' | 'unknown';

export interface ScanResult {
  timestamp: string;
  data: WavelengthPoint[];
  prediction: string;
  modelUsed: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success' | 'warning';
}
