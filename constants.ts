
import { ChemometricModel } from './types';

export const CDM_MODEL: ChemometricModel = {
  name: "Alimento Mascotas / Cerdos (v2.4)",
  bias: 6.67240142,
  // Representing the first few coefficients for the PLS model
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
    0.39, -0.24, 1.21, 1.35, -0.55, 0.33, 1.7, 3.0, 1.4, -0.65
  ],
  wavelengths: Array.from({ length: 100 }, (_, i) => 900 + i * 8)
};

export const USB_CONFIG = {
  vendorId: 0x0403,
  deviceName: "MicroNIR On-Site-W",
  firmwareVersion: "2.5.1-stable"
};

// Configuración BLE basada en estándares JDSU/Viavi
// Si el dispositivo usa un servicio UART Nórdico estándar (común en estos equipos):
export const BLE_CONFIG = {
  // Filtro de nombre para encontrar el dispositivo
  namePrefix: "MicroNIR",
  // UUIDs comunes para Serial Port Profile sobre BLE (Nordic UART Service)
  // Se usan como fallback si no se detectan automáticamente
  serviceUUID: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  rxCharUUID: "6e400003-b5a3-f393-e0a9-e50e24dcca9e", // Notify
  txCharUUID: "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  // Write
};
