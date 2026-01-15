
import { USB_CONFIG } from "../constants";

declare global {
  interface Navigator {
    usb: {
      requestDevice(options: { filters: { vendorId: number }[] }): Promise<any>;
    };
  }
}

const CMD = {
  LAMP_CONTROL: 0x01,
  SET_INTEGRATION: 0x02,
  GET_INFO: 0x03,
  SCAN: 0x05,
  GET_TEMP: 0x06,
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

function toHex(buffer: Uint8Array | number[]): string {
  const arr = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export class MicroNIRDriver {
  private device: any | null = null;
  private inEndpoint = 0; 
  private outEndpoint = 0;
  public isConnected = false;
  private logger: (msg: string) => void = () => {};

  public setLogger(fn: (msg: string) => void) {
    this.logger = fn;
  }

  private log(msg: string) {
    this.logger(`[USB] ${msg}`);
  }

  private async sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  private async ctrl(req: number, val: number, idx: number) {
    if (!this.device) return;
    return this.device.controlTransferOut({
      requestType: 'vendor', recipient: 'device', request: req, value: val, index: idx
    });
  }

  async connect(): Promise<string> {
    try {
      if (!navigator.usb) return "Navegador incompatible (requiere Chrome/Edge)";

      this.device = await navigator.usb.requestDevice({
        filters: [{ vendorId: USB_CONFIG.vendorId }]
      });

      await this.device.open();
      if (this.device.configuration === null) await this.device.selectConfiguration(1);
      
      const intf = this.device.configuration.interfaces[0];
      const alt = intf.alternates[0];
      
      const epIn = alt.endpoints.find((e: any) => e.direction === 'in');
      const epOut = alt.endpoints.find((e: any) => e.direction === 'out');

      this.inEndpoint = epIn?.endpointNumber || 2;
      this.outEndpoint = epOut?.endpointNumber || 1;
      
      try { await this.device.claimInterface(intf.interfaceNumber); } catch(e) {}

      // FTDI Init
      await this.ctrl(0x00, 0x00, 0x00);
      await this.ctrl(0x03, 0x401A, 0x00); // 115200
      await this.ctrl(0x04, 0x0008, 0x00); // 8N1
      await this.ctrl(0x01, 0x0303, 0x00);

      this.isConnected = true;
      await this.sleep(200);
      await this.flushRx();

      this.log("Iniciando negociación de protocolo...");
      const success = await this.autoConfig();
      
      if (!success) {
        // Si falla la autoconfiguración, intentamos forzar Little Endian por defecto
        this.log("Fallback: Forzando Little Endian por defecto...");
        const payload = this.buildPayload(100, 10000, 8, false); // false = !be = True (Little Endian)
        await this.send(CMD.SET_INTEGRATION, payload);
        return "OK (Forzado)";
      }

      return "OK";
    } catch (error: any) {
      this.isConnected = false;
      return error.message || "Error USB";
    }
  }

  private async autoConfig(): Promise<boolean> {
    const scanCount = 500;
    const integrationTime = 12500;

    const formats = [
      { size: 8, be: false },  // Little Endian (más probable)
      { size: 8, be: true },   // Big Endian
      { size: 16, be: false }  // Extended Little Endian
    ];

    for (const fmt of formats) {
      this.log(`Probando formato: ${fmt.size} bytes, ${fmt.be ? 'BigEndian' : 'LittleEndian'}`);
      const payload = this.buildPayload(scanCount, integrationTime, fmt.size, fmt.be);
      
      if (await this.send(CMD.SET_INTEGRATION, payload)) {
        await this.sleep(100);
        const resp = await this.readPacket(500);
        if (resp && resp.length >= 3) {
          if (resp[2] === 0x15) { // NAK
            this.log(`Rechazado (NAK)`);
          } else {
            this.log(`¡Conectado! Formato aceptado.`);
            return true;
          }
        }
      }
      await this.sleep(50);
    }
    return false;
  }

  private buildPayload(scans: number, time: number, size: number, be: boolean): number[] {
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    if (size >= 8) {
      // !be -> Si be=false (queremos Little), !be=true que es el flag de DataView para LittleEndian
      view.setUint32(0, scans, !be);
      view.setUint32(4, time, !be);
    }
    return Array.from(new Uint8Array(buffer));
  }

  async resetHardware(): Promise<boolean> {
      this.log("Enviando comando de RESET (0x0F)...");
      return await this.send(CMD.RESET);
  }

  async disconnect() {
    if (this.device?.opened) await this.device.close();
    this.isConnected = false;
  }

  private async flushRx() {
    try {
      for(let i=0; i<3; i++) {
        const res = await this.device.transferIn(this.inEndpoint, 64);
        if (!res.data || res.data.byteLength <= 2) break;
      }
    } catch(e) {}
  }

  async send(opcode: number, data: number[] = []): Promise<boolean> {
    if (!this.isConnected) return false;
    const len = data.length + 1;
    const rawPayload = new Uint8Array([len, opcode, ...data]);
    const packet = new Uint8Array([0x02, ...rawPayload, calculateCrc8(rawPayload), 0x03]);
    this.log(`TX >>> ${toHex(packet)}`);
    try {
      const res = await this.device.transferOut(this.outEndpoint, packet);
      return res.status === 'ok';
    } catch (e) {
      return false;
    }
  }

  async getTemperature(): Promise<number | null> {
    if (await this.send(CMD.GET_TEMP)) {
      const resp = await this.readPacket(500);
      if (resp && resp.length >= 5 && resp[2] === 0x06) {
        // Temperatura usualmente es Big Endian incluso en modos Little Endian, pero probaremos LE si falla
        const val = new DataView(resp.buffer).getUint16(3, false);
        return val / 1000.0;
      }
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    // CRÍTICO: Muchos MicroNIR rechazan encender la lámpara si no se ha refrescado
    // la configuración de tiempo de integración recientemente.
    if (on) {
        this.log("Enviando Wake-Up Config antes de Lámpara...");
        // 50 scans, 10ms, 8 bytes, Little Endian (be=false)
        const payload = this.buildPayload(50, 10000, 8, false);
        await this.send(CMD.SET_INTEGRATION, payload);
        await this.sleep(150); // Pausa obligatoria
    }

    const ok = await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
    if (ok) await this.sleep(on ? 1500 : 100); 
    return ok;
  }

  async scan(): Promise<Uint16Array | null> {
    if (!await this.send(CMD.SCAN)) return null;
    const raw = await this.readPacket(3000);
    if (!raw) return null;
    return this.parseSpectrum(raw);
  }

  private parseSpectrum(buffer: Uint8Array): Uint16Array {
    let offset = 3; // Default short format [02, LEN, 05, DATA...]
    if (buffer[3] === 0x05) offset = 4; // Extended format [02, HI, LO, 05, DATA...]
    
    const s = new Uint16Array(128);
    const view = new DataView(buffer.buffer);
    
    for(let j=0; j<128; j++) {
      if (offset + (j*2) + 1 < buffer.length) {
          // CAMBIO CRÍTICO: Usar Little Endian (true)
          // La línea saturada suele ser por leer Big Endian cuando el sensor envía Little Endian
          s[j] = view.getUint16(offset + (j*2), true); 
      }
    }
    return s;
  }

  private async readPacket(timeoutMs: number): Promise<Uint8Array | null> {
    const startTime = Date.now();
    let acc = new Uint8Array(0);
    while ((Date.now() - startTime) < timeoutMs) {
      try {
        const res = await this.device.transferIn(this.inEndpoint, 64);
        if (res.status === 'ok' && res.data.byteLength > 2) {
          const chunk = new Uint8Array(res.data.buffer.slice(2)); 
          const next = new Uint8Array(acc.length + chunk.length);
          next.set(acc); next.set(chunk, acc.length);
          acc = next;
          if (acc.length > 3 && acc[acc.length-1] === 0x03) return acc;
        }
      } catch (e) { await this.sleep(20); }
    }
    return acc.length > 0 ? acc : null;
  }
}

export const device = new MicroNIRDriver();
