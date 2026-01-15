
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

export class MicroNIRDriver {
  private device: any | null = null;
  private inEndpoint = 0; 
  private outEndpoint = 0;
  public isConnected = false;
  private logger: (msg: string) => void = () => {};
  
  // Constantes extraídas de los logs de VIAVI
  private readonly STATUS_PACKET_SIZE = 33;
  private readonly SCAN_PACKET_SIZE = 289;

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

      // FTDI Init (Vital para despertar el chip de comunicación)
      await this.ctrl(0x00, 0x00, 0x00);
      await this.ctrl(0x03, 0x401A, 0x00); // 115200 baud
      await this.ctrl(0x04, 0x0008, 0x00); // 8N1
      await this.ctrl(0x01, 0x0303, 0x00);

      this.isConnected = true;
      
      this.log("Despertando sensor (Wake-up sequence)...");
      await this.flushRx();
      
      // Intentar "Dummy tasks" para verificar que no está en 'Sleeping'
      let retries = 5;
      let ready = false;
      while (retries > 0 && !ready) {
        if (await this.ping()) {
          ready = true;
          break;
        }
        this.log(`Reintentando despertar... (${retries})`);
        await this.sleep(500);
        retries--;
      }

      if (!ready) return "Sensor no responde (posible estado Sleep profundo)";

      this.log("Sensor Online. Configurando tiempos de integración...");
      await this.send(CMD.SET_INTEGRATION, [0x00, 0x00, 0x01, 0xF4, 0x00, 0x00, 0x30, 0xD4]); // 500 scans, 12.5ms
      
      return "OK";
    } catch (error: any) {
      this.isConnected = false;
      return error.message || "Error USB";
    }
  }

  private async ping(): Promise<boolean> {
    // Pedir temperatura es la "Dummy Task" perfecta para despertar el bus
    return (await this.getTemperature()) !== null;
  }

  async resetHardware(): Promise<boolean> {
      this.log("Ejecutando Hard Reset (Modo Recuperación)...");
      return await this.send(CMD.RESET);
  }

  async disconnect() {
    if (this.device?.opened) await this.device.close();
    this.isConnected = false;
  }

  private async flushRx() {
    try {
      const res = await this.device.transferIn(this.inEndpoint, 1024);
      if (res.data) this.log(`Limpiados ${res.data.byteLength} bytes residuales.`);
    } catch(e) {}
  }

  async send(opcode: number, data: number[] = []): Promise<boolean> {
    if (!this.isConnected) return false;
    const rawPayload = new Uint8Array([data.length + 1, opcode, ...data]);
    const packet = new Uint8Array([0x02, ...rawPayload, 0x00, 0x03]); // CRC simplificado para ráfaga estable
    try {
      const res = await this.device.transferOut(this.outEndpoint, packet);
      return res.status === 'ok';
    } catch (e) { return false; }
  }

  async getTemperature(): Promise<number | null> {
    if (await this.send(CMD.GET_TEMP)) {
      const resp = await this.readPacket(this.STATUS_PACKET_SIZE, 500);
      if (resp) {
        const view = new DataView(resp.buffer);
        // VIAVI OnSite-W suele devolver la temp en los bytes 9-10 o 13-14 según modo
        return view.getUint16(Math.min(resp.length-5, 13), false) / 100.0;
      }
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    this.log(`Comando Lámpara: ${on ? 'ON' : 'OFF'}`);
    return await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
  }

  async scan(): Promise<Uint16Array | null> {
    if (!await this.send(CMD.SCAN)) return null;
    const raw = await this.readPacket(this.SCAN_PACKET_SIZE, 3500);
    if (!raw) return null;
    return this.parseSpectrum(raw);
  }

  private parseSpectrum(buffer: Uint8Array): Uint16Array {
    // Según los logs: 289 bytes = 33 de cabecera + 256 de datos (128 píxeles)
    // El offset de los datos suele empezar tras la cabecera de estado
    const s = new Uint16Array(128);
    const view = new DataView(buffer.buffer);
    const offset = buffer.length === this.SCAN_PACKET_SIZE ? 33 : 3; 
    for(let j=0; j<128; j++) {
      if (offset + (j*2) + 1 < buffer.length) {
        s[j] = view.getUint16(offset + (j*2), false);
      }
    }
    return s;
  }

  private async readPacket(expectedSize: number, timeoutMs: number): Promise<Uint8Array | null> {
    const startTime = Date.now();
    let acc = new Uint8Array(0);
    while ((Date.now() - startTime) < timeoutMs) {
      try {
        const res = await this.device.transferIn(this.inEndpoint, 512);
        if (res.status === 'ok' && res.data.byteLength > 2) {
          // El chip FTDI añade 2 bytes de estado al inicio de cada transferencia
          const chunk = new Uint8Array(res.data.buffer.slice(2)); 
          const next = new Uint8Array(acc.length + chunk.length);
          next.set(acc); next.set(chunk, acc.length);
          acc = next;
          
          if (acc.length >= expectedSize) return acc.slice(0, expectedSize);
        }
      } catch (e) { await this.sleep(10); }
    }
    return null;
  }
}

export const device = new MicroNIRDriver();
