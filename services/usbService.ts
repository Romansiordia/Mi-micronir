
import { USB_CONFIG } from "../constants";

// Comandos del Protocolo MicroNIR
const CMD = {
  LAMP_CONTROL: 0x01,
  SET_INTEGRATION: 0x02,
  GET_INFO: 0x03,
  SCAN: 0x05,
  GET_TEMP: 0x06,
  RESET: 0x0F
};

// Tabla CRC8
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

  // Enviar comando de control al chip FTDI (Vendor Request)
  private async ctrl(req: number, val: number, idx: number) {
    if (!this.device) return;
    this.log(`FTDI CTRL Req:${req.toString(16)} Val:${val.toString(16)}`);
    return this.device.controlTransferOut({
      requestType: 'vendor', recipient: 'device', request: req, value: val, index: idx
    });
  }

  async connect(): Promise<string> {
    try {
      this.log("Solicitando dispositivo...");
      this.device = await (navigator as any).usb.requestDevice({
        filters: [{ vendorId: USB_CONFIG.vendorId }]
      });

      this.log(`Dispositivo seleccionado: ${this.device.productName}`);
      await this.device.open();
      if (this.device.configuration === null) await this.device.selectConfiguration(1);
      
      const intf = this.device.configuration.interfaces[0];
      const alt = intf.alternates[0];
      
      const epIn = alt.endpoints.find((e: any) => e.direction === 'in');
      const epOut = alt.endpoints.find((e: any) => e.direction === 'out');

      this.inEndpoint = epIn ? epIn.endpointNumber : 2;
      this.outEndpoint = epOut ? epOut.endpointNumber : 1;
      
      this.log(`Endpoints: IN=${this.inEndpoint}, OUT=${this.outEndpoint}`);

      try { await this.device.claimInterface(intf.interfaceNumber); } 
      catch(e) { this.log("Interface ya reclamada o ocupada"); }

      // --- CONFIGURACIÓN FTDI ---
      this.log("Configurando FTDI Serial (115200 8N1)...");
      await this.ctrl(0x00, 0x00, 0x00); // Reset
      await this.ctrl(0x03, 0x401A, 0x00); // Baud 115200
      await this.ctrl(0x04, 0x0008, 0x00); // 8N1
      await this.ctrl(0x09, 0x0010, 0x00); // Latency 16ms
      await this.ctrl(0x02, 0x0000, 0x00); // Flow Ctrl Off
      await this.ctrl(0x01, 0x0303, 0x00); // DTR/RTS High

      this.isConnected = true;
      
      await this.sleep(200);
      await this.flushRx();
      
      // --- WAKE UP SENSOR (Little Endian Strategy 8 Bytes) ---
      // Sending 8 Bytes: Scans (4) + Time (4)
      const scanCount = 50;
      const integrationTime = 6800;

      const payload = [
          // Scans Count (Little Endian)
          scanCount & 0xFF, (scanCount >> 8) & 0xFF, (scanCount >> 16) & 0xFF, (scanCount >> 24) & 0xFF,
          // Integration Time (Little Endian)
          integrationTime & 0xFF, (integrationTime >> 8) & 0xFF, (integrationTime >> 16) & 0xFF, (integrationTime >> 24) & 0xFF
      ];
      
      this.log(`Enviando Init V8 (LE 8 Bytes): [${payload.join(',')}]`);
      await this.send(CMD.SET_INTEGRATION, payload);
      
      return "OK";
    } catch (error: any) {
      this.isConnected = false;
      this.log(`Error Critico: ${error.message}`);
      console.error(error);
      return error.message || "Error USB Desconocido";
    }
  }

  async disconnect() {
    if (this.device && this.device.opened) {
      try { await this.setLamp(false); } catch(e) {}
      await this.device.close();
    }
    this.isConnected = false;
    this.log("Desconectado.");
  }

  private async flushRx() {
    if (!this.isConnected) return;
    try {
      this.log("Limpiando buffer RX...");
      for(let i=0; i<5; i++) {
        const res = await this.device.transferIn(this.inEndpoint, 64);
        if (!res.data || res.data.byteLength <= 2) break;
      }
    } catch(e) {}
  }

  async send(opcode: number, data: number[] = []): Promise<boolean> {
    if (!this.isConnected) return false;

    await this.flushRx();

    const len = data.length + 1;
    const rawPayload = new Uint8Array([len, opcode, ...data]);
    const crc = calculateCrc8(rawPayload);

    const packet = new Uint8Array([0x02, ...rawPayload, crc, 0x03]);
    
    this.log(`TX >>> ${toHex(packet)}`);

    try {
      const res = await this.device.transferOut(this.outEndpoint, packet);
      return res.status === 'ok';
    } catch (e) {
      this.log(`TX Falló: ${e}`);
      return false;
    }
  }

  async getTemperature(): Promise<number | null> {
    for(let attempt=0; attempt<3; attempt++) {
      if (await this.send(CMD.GET_TEMP)) {
        await this.sleep(50);
        const resp = await this.readPacket(500);
        
        if (resp && resp.length >= 5) {
           // Buscar respuesta válida
           for(let i=0; i<resp.length-2; i++) {
             // 0x06 es el Opcode de GET_TEMP Response (echo del comando o específico)
             // Ajustar lógica según logs
             if (resp[i] === 0x06) {
               const view = new DataView(resp.buffer);
               if (i + 2 < resp.length) {
                 const rawTemp = view.getUint16(i+1, false); 
                 return rawTemp / 1000.0;
               }
             }
           }
        }
      }
      await this.sleep(100);
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    const ok = await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
    if (ok) await this.sleep(on ? 1500 : 200); 
    return ok;
  }

  async scan(): Promise<Uint16Array | null> {
    this.log("Iniciando SCAN...");
    if (!await this.send(CMD.SCAN)) return null;

    await this.sleep(100); 

    const raw = await this.readPacket(3000);
    if (!raw) {
        this.log("SCAN Timeout: No se recibieron datos");
        return null;
    }

    this.log(`SCAN RX Total Bytes: ${raw.length}`);
    let spectrum: Uint16Array | null = null;

    for(let i=0; i < raw.length - 10; i++) {
      if (raw[i] === 0x02) { 
        // Formato Corto: [02, LEN, 05, DATA...]
        if (raw[i+2] === 0x05) {
          const len = raw[i+1] - 1;
          const dataStart = i + 3;
          if (dataStart + len <= raw.length) {
             spectrum = this.parseSpectrum(raw, dataStart, len/2);
             break;
          }
        }
        // Formato Largo: [02, HI, LO, 05, DATA...]
        else if (raw[i+3] === 0x05) {
          const len = (raw[i+1] << 8 | raw[i+2]) - 1;
          const dataStart = i + 4;
          if (dataStart + len <= raw.length) {
             spectrum = this.parseSpectrum(raw, dataStart, len/2);
             break;
          }
        }
      }
    }

    if (!spectrum && raw.length >= 256) {
       this.log("SCAN Fallback (Raw size match)");
       spectrum = this.parseSpectrum(raw, 0, 128);
    }

    return spectrum;
  }

  private parseSpectrum(buffer: Uint8Array, offset: number, pixels: number): Uint16Array {
    const bytesAvailable = buffer.length - offset;
    const pixelsPossible = Math.floor(bytesAvailable / 2);
    const targetPixels = (pixelsPossible >= 128) ? 128 : pixels;

    const s = new Uint16Array(targetPixels);
    const view = new DataView(buffer.buffer);
    for(let j=0; j<targetPixels; j++) {
      if (offset + (j*2) + 1 < buffer.length) {
        s[j] = view.getUint16(offset + (j*2), false);
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
          const chunk = new Uint8Array(res.data.buffer.slice(2)); // Remover FTDI header (2 bytes status)
          
          if (chunk.length > 0) {
             this.log(`RX Chunk (No Header) <<< ${toHex(chunk)}`);
             const next = new Uint8Array(acc.length + chunk.length);
             next.set(acc);
             next.set(chunk, acc.length);
             acc = next;

             if (acc.length > 5 && acc[acc.length-1] === 0x03) {
                if (acc.length >= 256) return acc;
                if (acc.length < 50) return acc;
             }
          }
        }
      } catch (e) {
        await this.sleep(10);
      }
    }
    return acc.length > 0 ? acc : null;
  }
}

export const device = new MicroNIRDriver();
