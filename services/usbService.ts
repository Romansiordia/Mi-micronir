
import { USB_CONFIG } from "../constants";

declare global {
  interface Navigator {
    usb: {
      requestDevice(options: { filters: { vendorId: number, productId?: number }[] }): Promise<any>;
    };
  }
}

const FTDI_REQ = {
    RESET: 0x00,
    MODEM_CTRL: 0x01,
    SET_BAUD: 0x03,
    SET_DATA: 0x04,
    SET_LATENCY_TIMER: 0x09
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

const PRO_CONFIG_V32 = [
    0x64, 0x27, 0x10, 0x00, 0x00, 0x27, 0x10, 0x00, 0x00, 0x00, 0x01
];

export class MicroNIRDriver {
  private device: any | null = null;
  private inEndpoint = 0; 
  private outEndpoint = 0;
  public isConnected = false;
  private logger: (msg: string) => void = () => {};
  private rxBuffer = new Uint8Array(0);
  
  public setLogger(fn: (msg: string) => void) { this.logger = fn; }
  private log(msg: string) { this.logger(msg); }
  private async sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  private calculateCrc8(data: Uint8Array): number {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
      crc = CRC8_TABLE[crc ^ data[i]];
    }
    return crc;
  }

  private toHex(arr: Uint8Array): string {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  private async writeCommand(opcode: number, data: number[] = []): Promise<void> {
    if (!this.device) return;
    const payload = new Uint8Array([opcode, ...data]);
    const len = payload.length;
    const crcInput = new Uint8Array([len, ...payload]);
    const crc = this.calculateCrc8(crcInput);
    const packet = new Uint8Array([0x02, len, ...payload, crc, 0x03]);
    this.log(`CMD OUT: ${this.toHex(packet)}`);
    await this.device.transferOut(this.outEndpoint, packet);
  }

  private async readValidatedPacket(timeoutMs: number): Promise<Uint8Array | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const chunk = await this.readRawChunk();
        if (chunk && chunk.length > 0) {
            const next = new Uint8Array(this.rxBuffer.length + chunk.length);
            next.set(this.rxBuffer);
            next.set(chunk, this.rxBuffer.length);
            this.rxBuffer = next;

            let stxIdx = this.rxBuffer.indexOf(0x02);
            while (stxIdx !== -1) {
                if (stxIdx > 0) {
                    this.rxBuffer = this.rxBuffer.slice(stxIdx);
                    stxIdx = 0;
                }
                
                let etxIdx = this.rxBuffer.indexOf(0x03, 1);
                if (etxIdx !== -1) {
                    const packet = this.rxBuffer.slice(0, etxIdx + 1);
                    const payload = packet.slice(1, etxIdx - 1);
                    const expectedCrc = packet[etxIdx - 1];
                    
                    if (this.calculateCrc8(payload) === expectedCrc) {
                        this.rxBuffer = this.rxBuffer.slice(etxIdx + 1);
                        return packet;
                    }
                    etxIdx = this.rxBuffer.indexOf(0x03, etxIdx + 1);
                } else break;
            }
        }
        await this.sleep(10);
    }
    return null;
  }

  private async readRawChunk(): Promise<Uint8Array | null> {
    try {
        const res = await this.device.transferIn(this.inEndpoint, 8192);
        if (res.status === 'ok' && res.data && res.data.byteLength > 2) {
            return new Uint8Array(res.data.buffer, res.data.byteOffset + 2, res.data.byteLength - 2);
        }
    } catch(e) {}
    return null;
  }

  async getTemperature(): Promise<number | null> {
    await this.writeCommand(0x06);
    const pkt = await this.readValidatedPacket(1000);
    if (pkt && pkt[2] === 0x06) {
        const view = new DataView(pkt.buffer, pkt.byteOffset + 3, 2);
        return ((view.getUint16(0, false) & 0xFFF8) >> 3) / 16.0;
    }
    return null;
  }

  async scan(): Promise<Uint16Array | null> {
    this.log("!!! MODO PRO 128: LECTURA DIRECTA 0x04 !!!");
    
    this.log("Hardware: Lámpara -> ENCENDIDA");
    await this.writeCommand(0x01, [0x01]);
    await this.readValidatedPacket(500);
    await this.sleep(1000);
    
    this.log("Hardware: Configurando 10ms (Pro V3.2)...");
    await this.purgeBuffers();
    await this.writeCommand(0x02, PRO_CONFIG_V32);
    await this.readValidatedPacket(1000);

    this.log("Disparando Scan (0x05)...");
    await this.writeCommand(0x05, [0x01]);
    
    // Esperamos el flag 0x64 (Sensor Ready)
    const signal = await this.readValidatedPacket(4000);
    
    if (signal && signal[2] === 0x18 && signal[3] === 0x64) {
        this.log("¡0x64 Detectado! Ejecutando volcado directo (0x04)...");
        // NOTA: No vaciamos buffers aquí para preservar los datos que ya vienen entrando
        await this.writeCommand(0x04);
        
        const data = await this.readValidatedPacket(5000);
        if (data) {
            const s = new Uint16Array(128);
            // Tolerancia Pro: Saltamos cabecera extendida si el paquete es de gran tamaño
            const offset = data.length > 260 ? 5 : 3;
            
            for(let j=0; j<128; j++) {
                const idx = offset + (j * 2);
                if (idx + 1 < data.length) {
                    s[j] = (data[idx] << 8) | data[idx+1];
                }
            }
            this.log(`>>> ESCANEO COMPLETADO (Offset: ${offset}, Bytes: ${data.length})`);
            return s;
        }
    }
    this.log(">>> ERROR: El detector no respondió al handshake 0x04.");
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    await this.writeCommand(0x01, [on ? 0x01 : 0x00]);
    await this.readValidatedPacket(500);
    return true;
  }

  private async ftdiControl(request: number, value: number, index: number = 0) {
    if (!this.device) return;
    await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request, value, index
    });
  }

  private async purgeBuffers() {
    await this.ftdiControl(FTDI_REQ.RESET, 1);
    await this.ftdiControl(FTDI_REQ.RESET, 2);
    this.rxBuffer = new Uint8Array(0);
  }

  async connect(): Promise<any> {
    try {
      this.device = await navigator.usb.requestDevice({ 
        filters: [{ vendorId: USB_CONFIG.vendorId }, { vendorId: USB_CONFIG.viaviVendorId }] 
      });
      
      await this.device.open();
      if (this.device.configuration === null) await this.device.selectConfiguration(1);
      const intf = this.device.configuration.interfaces[0];
      await this.device.claimInterface(intf.interfaceNumber);
      
      const alt = intf.alternates[0];
      this.inEndpoint = alt.endpoints.find((e: any) => e.direction === 'in').endpointNumber;
      this.outEndpoint = alt.endpoints.find((e: any) => e.direction === 'out').endpointNumber;
      this.isConnected = true;

      await this.ftdiControl(FTDI_REQ.RESET, 0x0000);
      await this.ftdiControl(FTDI_REQ.SET_BAUD, USB_CONFIG.baudValue, USB_CONFIG.baudIndex);
      await this.ftdiControl(FTDI_REQ.SET_LATENCY_TIMER, USB_CONFIG.latencyTimer);
      await this.ftdiControl(FTDI_REQ.MODEM_CTRL, 0x0303);
      
      await this.sleep(800);
      await this.purgeBuffers();
      
      this.log(`Enlazado a MicroNIR V3.2 Pro.`);
      
      let res = null;
      for (let i = 0; i < 3; i++) {
          await this.writeCommand(0x14); 
          res = await this.readValidatedPacket(2500);
          if (res) break;
          await this.sleep(500);
          await this.purgeBuffers();
      }
      
      if (res) {
          const t = await this.getTemperature();
          this.log(`>>> SISTEMA OK (${t !== null ? t.toFixed(1) : '??'}°C) <<<`);
          return { model: "MicroNIR V3.2 Pro", mode: "DIRECT_READ_V4" };
      }
      
      this.isConnected = false;
      return "Sin respuesta del MicroNIR (Timeout PING).";
    } catch (error: any) {
      this.isConnected = false;
      return error.message;
    }
  }

  async getHardwareStatus() {
      await this.writeCommand(0x18);
      const pkt = await this.readValidatedPacket(800);
      return pkt ? pkt[3] : null;
  }

  async abortOperation() {
      if (this.device) {
          await this.writeCommand(0x0F);
          await this.device.close();
      }
      this.isConnected = false;
  }
}

export const device = new MicroNIRDriver();
