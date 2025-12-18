
import { USB_CONFIG } from "../constants";

// Opcodes basados en el análisis del SDK JDSU.MicroNir.Api
const OPCODES = {
  SET_LAMP: 0x01,
  SET_INTEGRATION: 0x02,
  GET_DEVICE_INFO: 0x03,
  PERFORM_SCAN: 0x05,
  GET_TEMPERATURE: 0x06,
  RESET: 0x0F
};

export class MicroNIRDevice {
  private device: any | null = null;
  private inEndpoint: number = 2;
  private outEndpoint: number = 1;
  public isSimulated: boolean = false;

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

      const endpoints = this.device.configuration?.interfaces[interfaceNum].alternate.endpoints;
      endpoints?.forEach((ep: any) => {
        if (ep.direction === 'in') this.inEndpoint = ep.endpointNumber;
        if (ep.direction === 'out') this.outEndpoint = ep.endpointNumber;
      });

      // --- CONFIGURACIÓN FTDI ---
      await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x00, value: 0x00, index: 0x00 }); // Reset
      await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x03, value: 0x401A, index: 0x0000 }); // 115200 baud
      await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x01, value: 0x0303, index: 0x0000 }); // DTR/RTS High
      await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x09, value: 0x0001, index: 0x0000 }); // 1ms Latency

      // Inicializar integración (10ms = 10000us)
      await this.setIntegrationTime(10000);

      return true;
    } catch (error) {
      console.error("USB Connect Error:", error);
      return false;
    }
  }

  async sendCommand(opcode: number, payload: number[] = []): Promise<boolean> {
    if (!this.device?.opened) return false;
    try {
      const bytes = new Uint8Array([0x02, opcode, ...payload, 0x03]);
      const result = await this.device.transferOut(this.outEndpoint, bytes);
      return result.status === 'ok';
    } catch (e) { return false; }
  }

  async setIntegrationTime(us: number): Promise<boolean> {
    // El payload son 2 bytes (MSB, LSB)
    const msb = (us >> 8) & 0xFF;
    const lsb = us & 0xFF;
    return await this.sendCommand(OPCODES.SET_INTEGRATION, [msb, lsb]);
  }

  async getTemperature(): Promise<number | null> {
    if (this.isSimulated) return 24.5 + Math.random();
    await this.sendCommand(OPCODES.GET_TEMPERATURE);
    await this.delay(50);
    const result = await this.device.transferIn(this.inEndpoint, 64);
    if (result.data && result.data.byteLength > 3) {
      const view = new DataView(result.data.buffer, 2); // Saltamos 2 bytes FTDI
      return view.getUint16(1, false) / 10.0; // Típico factor MicroNIR
    }
    return null;
  }

  async readSpectrum(): Promise<Uint16Array | null> {
    if (this.isSimulated) return new Uint16Array(Array.from({ length: 128 }, () => 20000 + Math.random() * 5000));
    if (!this.device?.opened) return null;

    try {
      // Purgar buffer
      for(let i=0; i<5; i++) { await this.device.transferIn(this.inEndpoint, 64); }

      // Disparar Escaneo
      await this.sendCommand(OPCODES.PERFORM_SCAN);
      await this.delay(400); // Tiempo de integración + procesamiento hardware

      let accumulated = new Uint8Array(0);
      const start = Date.now();
      
      while (Date.now() - start < 2000) {
        const result = await this.device.transferIn(this.inEndpoint, 1024);
        if (result.status === 'ok' && result.data.byteLength > 2) {
          const chunk = new Uint8Array(result.data.buffer, 2);
          const next = new Uint8Array(accumulated.length + chunk.length);
          next.set(accumulated);
          next.set(chunk, accumulated.length);
          accumulated = next;

          // On-Site-W suele enviar BINARY_SCAN512 (512 bytes = 256 píxeles)
          if (accumulated.length >= 512) break;
        }
        await this.delay(20);
      }

      if (accumulated.length >= 256) {
        const points = Math.floor(accumulated.length / 2);
        const spectrum = new Uint16Array(points);
        const view = new DataView(accumulated.buffer, accumulated.byteOffset, accumulated.byteLength);
        for (let i = 0; i < points; i++) {
          spectrum[i] = view.getUint16(i * 2, false); // Big Endian
        }
        return spectrum;
      }
      return null;
    } catch (e) { return null; }
  }

  async setLamp(on: boolean): Promise<boolean> {
    return await this.sendCommand(OPCODES.SET_LAMP, [on ? 0x01 : 0x00]);
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
