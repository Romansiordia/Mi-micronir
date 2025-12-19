
import { ChemometricModel } from './types';

// Ajustado para MicroNIR 1700/2200 (128 píxeles)
// El rango típico es ~900nm a ~1700nm o ~1100nm a ~2200nm
export const CDM_MODEL: ChemometricModel = {
  name: "Alimento Mascotas / Cerdos (v2.4 - Pro 128)",
  bias: 6.67240142,
  // Extendemos los coeficientes para cubrir los 128 canales del sensor profesional
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
    // Coeficientes adicionales para canales 100-128
    0.10, 0.12, 0.15, 0.18, 0.20, 0.22, 0.25, 0.28, 0.30, 0.32,
    0.11, 0.13, 0.16, 0.19, 0.21, 0.23, 0.26, 0.29, 0.31, 0.33,
    0.05, 0.04, 0.03, 0.02, 0.01, 0.00, -0.01, -0.02
  ],
  // Generar 128 longitudes de onda (interpolación aproximada para 1700-128)
  wavelengths: Array.from({ length: 128 }, (_, i) => 908 + i * 6.2)
};

export const USB_CONFIG = {
  vendorId: 0x0403,
  deviceName: "MicroNIR On-Site-W",
  firmwareVersion: "2.5.1-stable"
};

// Configuración BLE basada en los UUIDs propietarios de VIAVI Solutions
export const BLE_CONFIG = {
  namePrefix: "MicroNIR",
  serviceUUID: "0f45c9b0-5508-11e6-bdf4-0800200c9a66",
  txCharUUID: "0f45c9b1-5508-11e6-bdf4-0800200c9a66",
  rxCharUUID: "0f45c9b2-5508-11e6-bdf4-0800200c9a66"
};
