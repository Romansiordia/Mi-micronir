
import { USB_CONFIG } from "../constants";

const OPCODES = {
  SET_LAMP: 0x01,
  SET_INTEGRATION: 0x02,
  GET_DEVICE_INFO: 0x03,
  PERFORM_SCAN: 0x05,
  GET_TEMPERATURE: 0x06,
  RESET: 0x0F
};

const CRC8_TABLE = new Uint8Array([
  0x00, 0x5e, 0xbc, 0xe2, 0x61, 0x3f, 0xdd, 0x83, 0xc2, 0x9c, 0x7e, 0x20, 0xa3, 0xfd, 0x1f, 0x41,
  0x9d, 0xc3, 0x21, 0x7f, 0xfc, 0xa2, 0x40, 0x1e, 0x5f, 0x01, 0xe3, 0xbd, 0x3e, 0x60, 0x82, 0xdc,
  0x23, 0x7d, 0x9f, 0xc1, 0x42, 0x1c, 0xfe, 0xa0, 0xe1, 0xbf, 0x5d, 0x03, 0x80, 0xde, 0x3c, 0x62,
  0xbe, 0xe0, 0x02, 0x5c, 0xdf, 0x81, 0x63, 0x3d, 0x7c, 0x22, 0xc0, 0x9e, 0x1d, 0x43, 0xa1, 0xff,
  0x46, 0x18, 0xfa, 0xa4, 0x27, 0x79, 0x9b, 0xc5, 0x84, 0xda, 0x38, 0x66, 0xe5, 0xbb, 0x59, 0x07,
  0xdb, 0x85, 0x67, 0x39, 0xba, 0xe4, 0x06, 0x58, 0x19, 0x47, 0xa5, 0xfb, 0x78, 0x26, 0xc4, 0x9a,
  0x65, 0x3b, 0xd9, 0x87, 0x04, 0x5a, 0xb8, 0xe6, 0xa7, 0xf9, 0x1b, 0x45, 0xc6, 0x98, 0x7a, 0x24,
  0xf8, 0xa6, 0x44, 0x1a, 0x99, 0xc7, 0x25, 0x7b, 0x3a, 0x64, 0x86, 0xd8, 0x5b, 0x05, 0xe7, 0xb9,
  0x8c, 0xd2, 0x30, 0x6e, 0xed, 0xb3, 0x51, 0x0f, 0x4e, 0x10, 0xf2, 0xac, 0x2f, 0x71, 0x93, 0xcd,
  0x11, 0x4f, 0xad, 0xf3, 0x70, 0x2e, 0xcc, 0x92, 0xd3, 0x8d, 0x6f, 0x31, 0x8f, 0xd1, 0x50, 0x0e,
  0xaf, 0xf1, 0x13, 0x4d, 0xce, 0x90, 0x72, 0x2c, 0x6d, 0x33, 0x81, 0xdf, 0x0c, 0x52, 0xb0, 0xee,
  0x32, 0x6c, 0x8e, 0xd0, 0x53, 0x0d, 0xef, 0xb1, 0xf0, 0xae, 0x4c, 0x12, 0x91, 0xcf, 0x2d, 0x73,
  0xca, 0x94, 0x76, 0x28, 0xab, 0xf5, 0x17, 0x49, 0x08, 0x56, 0xb4, 0xea, 0x69, 0x37, 0x85, 0xdb,
  0x57, 0x09, 0xeb, 0xb5, 0x36, 0x68, 0x8a, 0xd4, 0x95, 0xcb, 0x29, 0x77, 0xf4, 0xaa, 0x48, 0x16,
  0xe9, 0xb7, 0x55, 0x0b, 0x88, 0xd6, 0x34, 0x6a, 0x2b, 0x75, 0x97, 0xc9, 0x4a, 0x14, 0xf6, 0xa8,
  0x74, 0x2a, 0xc8, 0x96, 0x15, 0x4b, 0xa9, 0xf7, 0xb6, 0xe8, 0x0a, 0x54, 0xd7, 0x89, 0x6b, 0x35
]);

function calculateCrc8(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = CRC8_TABLE[crc ^ data[i]];
  }
  return crc;
}

/**
 * Los metadatos de VIAVI sugieren un manejo de paquetes por bloques de 64 bytes (FTDI).
 */
function decapsulateFtdi(data: Uint8Array): Uint8Array {
  const blockSize = 64;
  const result = new Uint8Array(data.length); 
  let destOffset = 0;
  for (let i = 0; i < data.length; i += blockSize) {
    const remaining = Math.min(blockSize, data.length - i);
    if (remaining > 2) {
      const chunk = data.slice(i + 2, i + remaining);
      result.set(chunk, destOffset);
      destOffset += chunk.length;
    }
  }
  return result.slice(0, destOffset);
}

export class MicroNIRDevice {
  private device: any | null = null;
  private inEndpoint: number = 2;
  private outEndpoint: number = 1;
  public isSimulated: boolean = false;
  
  // Constantes de tiempo identificadas en los metadatos de VIAVI
  private readonly LAMP_ON_DELAY = 1000;  // 1s para calentamiento
  private readonly LAMP_OFF_DELAY = 500;  // 500ms para enfriamiento
  private readonly COMMAND_TIMEOUT = 200; // 200ms entre comandos

  private async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async connect(): Promise<boolean> {
    if (this.isSimulated) return true;
    try {
      this.device = await (navigator as any).usb.requestDevice({
        filters: [{ vendorId: USB_CONFIG.vendorId }]
      });

      await this.device.open();
      if (this.device.configuration === null) await this.device.selectConfiguration(1);
      
      const interfaceNum = 0;
      try { await this.device.claimInterface(interfaceNum); } catch (e) {}

      // Configuración inicial del chip FTDI (Handshake de la librería OnSiteW)
      await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x00, value: 0x00, index: 0x00 }); 
      await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x03, value: 0x401A, index: 0x0000 }); 
      await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x01, value: 0x0303, index: 0x0000 }); 
      await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x09, value: 0x0001, index: 0x0000 }); 

      await this.setIntegrationTime(10000); 
      return true;
    } catch (error) {
      console.error("USB Connect Error:", error);
      return false;
    }
  }

  /**
   * Implementación robusta de envío de comandos.
   * Basado en 'IPacketTransceiver' de los metadatos.
   */
  async sendCommand(opcode: number, payload: number[] = []): Promise<boolean> {
    if (!this.device?.opened) return false;
    try {
      const payloadLength = 1 + payload.length; 
      const crcBuffer = new Uint8Array([payloadLength, opcode, ...payload]);
      const crc = calculateCrc8(crcBuffer);
      const packet = new Uint8Array([0x02, payloadLength, opcode, ...payload, crc, 0x03]);
      
      const result = await this.device.transferOut(this.outEndpoint, packet);
      return result.status === 'ok';
    } catch (e) {
      return false;
    }
  }

  async setIntegrationTime(us: number): Promise<boolean> {
    const msb = (us >> 8) & 0xFF;
    const lsb = us & 0xFF;
    return await this.sendCommand(OPCODES.SET_INTEGRATION, [msb, lsb]);
  }

  async getTemperature(): Promise<number | null> {
    if (this.isSimulated) return 24.5 + Math.random();
    try {
      await this.sendCommand(OPCODES.GET_TEMPERATURE);
      await this.delay(150); // Delay de respuesta del sensor térmico
      
      const result = await this.device.transferIn(this.inEndpoint, 64);
      if (result.data && result.data.byteLength >= 4) {
        const clean = decapsulateFtdi(new Uint8Array(result.data.buffer));
        for (let i = 0; i < clean.length - 4; i++) {
          if (clean[i] === 0x02 && clean[i+2] === 0x06) {
            const view = new DataView(clean.buffer, clean.byteOffset + i + 3, 2);
            return view.getUint16(0, false) / 1000.0;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  async readSpectrum(): Promise<Uint16Array | null> {
    if (this.isSimulated) return new Uint16Array(Array.from({ length: 128 }, () => 20000 + Math.random() * 5000));
    if (!this.device?.opened) return null;

    try {
      // Basado en 'BeginOneShotModeScanAsync'
      await this.sendCommand(OPCODES.PERFORM_SCAN);
      await this.delay(700); // Tiempo de integración + procesamiento interno

      let rawAccumulated = new Uint8Array(0);
      const startTime = Date.now();
      
      while (Date.now() - startTime < 3500) {
        const result = await this.device.transferIn(this.inEndpoint, 1024);
        if (result.status === 'ok' && result.data.byteLength > 0) {
          const chunk = new Uint8Array(result.data.buffer);
          const next = new Uint8Array(rawAccumulated.length + chunk.length);
          next.set(rawAccumulated);
          next.set(chunk, rawAccumulated.length);
          rawAccumulated = next;
          if (rawAccumulated.length >= 320) break;
        }
        await this.delay(30);
      }

      const clean = decapsulateFtdi(rawAccumulated);
      for (let i = 0; i < clean.length - 10; i++) {
        if (clean[i] === 0x02) {
          let dataStart = -1;
          let dataLength = 0;

          if (clean[i+2] === 0x05) { 
            dataStart = i + 3;
            dataLength = clean[i+1] - 1;
          } else if (clean[i+3] === 0x05) { 
            dataStart = i + 4;
            dataLength = (clean[i+1] << 8 | clean[i+2]) - 1;
          }

          if (dataStart !== -1 && dataLength > 100) {
            const points = Math.floor(dataLength / 2);
            const spectrum = new Uint16Array(points);
            const view = new DataView(clean.buffer, clean.byteOffset + dataStart, dataLength);
            for (let j = 0; j < points; j++) {
              spectrum[j] = view.getUint16(j * 2, false); 
            }
            if (spectrum[10] > 0) return spectrum;
          }
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Control de lámpara optimizado según 'TurnLampOnAsync'/'TurnLampOffAsync'.
   */
  async setLamp(on: boolean): Promise<boolean> {
    const success = await this.sendCommand(OPCODES.SET_LAMP, [on ? 0x01 : 0x00]);
    if (success) {
      // La clave de los metadatos de VIAVI: el software debe esperar a que el hardware
      // complete la transición de energía antes de permitir otro comando.
      await this.delay(on ? this.LAMP_ON_DELAY : this.LAMP_OFF_DELAY);
    }
    return success;
  }

  async disconnect() {
    if (this.device?.opened) {
      await this.setLamp(false);
      await this.device.close();
    }
    this.device = null;
  }
}

export const microNir = new MicroNIRDevice();
