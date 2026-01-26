
import { ChemometricModel } from './types';

export const CDM_MODEL: ChemometricModel = {
  name: "Modelo General Alimentos v1.0",
  bias: 6.67,
  betaCoefficients: Array(128).fill(0.1), // Placeholder para coeficientes reales
  wavelengths: Array.from({ length: 128 }, (_, i) => 900 + i * 6.25)
};

export const USB_CONFIG = {
  vendorId: 0x0403,
  viaviVendorId: 0x158E,
  baudValue: 0x001A,
  baudIndex: 0x0000,
  latencyTimer: 0x02
};

export const BLE_CONFIG = {
  serviceUUIDs: [0xffe0, '0000ffe0-0000-1000-8000-00805f9b34fb'],
  namePrefixes: ['MicroNIR', 'VIAVI', 'JDSU']
};
