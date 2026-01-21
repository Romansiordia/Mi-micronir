
import { ChemometricModel } from './types';

export const CDM_MODEL: ChemometricModel = {
  name: "Alimento Mascotas / Cerdos (v2.4 - Pro 128)",
  bias: 6.67240142,
  betaCoefficients: [
    0.12, -0.05, 0.22, 0.45, -0.1, 0.05, 0.8, 1.2, 0.5, -0.2,
    0.15, -0.08, 0.33, 0.55, -0.15, 0.08, 0.9, 1.4, 0.6, -0.25,
    0.18, -0.10, 0.44, 0.65, -0.20, 0.12, 1.0, 1.6, 0.7, -0.30,
    0.21, -0.12, 0.55, 0.75, -0.25, 0.15, 1.1, 1.8, 0.8, -0.35,
    0.24, -0.14, 0.66, 0.85, -0.30, 0.18, 1.2, 2.0, 0.9, -0.40,
    0.27, -0.16, 0.77, 0.95, -0.35, 0.21, 1.3, 2.2, 1.0, -0.45,
    0.30, -0.18, 0.88, 1.05, -0.40, 0.24, 1.4, 2.4, 1.1, -0.50,
    0.33, -0.20, 0.99, 1.15, -0.45, 0.27, 1.5, 2.6, 1.2, -0.55,
    0.36, -0.22, 1.10, 1.25, -0.50, 0.30, 1.6, 2.8, 1.3, -0.60,
    0.39, -0.24, 1.21, 1.35, -0.55, 0.33, 1.7, 3.0, 1.4, -0.65,
    0.10, 0.12, 0.15, 0.18, 0.20, 0.22, 0.25, 0.28, 0.30, 0.32,
    0.11, 0.13, 0.16, 0.19, 0.21, 0.23, 0.26, 0.29, 0.31, 0.33,
    0.05, 0.04, 0.03, 0.02, 0.01, 0.00, -0.01, -0.02
  ],
  wavelengths: Array.from({ length: 128 }, (_, i) => 908 + i * 6.2)
};

export const USB_CONFIG = {
  vendorId: 0x0403,
  viaviVendorId: 0x158E,
  viaviProductId: 0x2801,
  baudValue: 0x001A,
  baudIndex: 0x0000,
  latencyTimer: 0x02
};

export const BLE_CONFIG = {
  namePrefixes: ["MicroNIR", "VIAVI", "NIR"],
  // UUIDs completos para evitar rechazo del navegador
  serviceUUID: "0000ff01-0000-1000-8000-00805f9b34fb",
  txCharUUID: "0000ff02-0000-1000-8000-00805f9b34fb",
  rxCharUUID: "0000ff03-0000-1000-8000-00805f9b34fb",
  nordicService: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  nordicTX: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  nordicRX: "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
};
