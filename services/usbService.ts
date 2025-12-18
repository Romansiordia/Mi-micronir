
import { USB_CONFIG } from "../constants";

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

      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }
      
      const interfaceNum = 0;
      try {
        await this.device.claimInterface(interfaceNum);
      } catch (e) {
        console.warn("Interfaz ya reclamada, intentando continuar...");
      }

      const endpoints = this.device.configuration?.interfaces[interfaceNum].alternate.endpoints;
      endpoints?.forEach((ep: any) => {
        if (ep.direction === 'in') this.inEndpoint = ep.endpointNumber;
        if (ep.direction === 'out') this.outEndpoint = ep.endpointNumber;
      });

      // --- CONFIGURACIÓN DE ALTA PRECISIÓN FTDI ---
      
      // 1. Reset SIO
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x00, value: 0x00, index: 0x00
      });

      // 2. Set Baud Rate (115200)
      // Divisor para 115200 en FT232R es 26 (0x1A). 
      // El valor se pasa en 'value' y el sub-integer en 'index'
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x03, value: 0x001A, index: 0x0000
      });

      // 3. Set Flow Control (None)
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x02, value: 0x0000, index: 0x0000
      });

      // 4. Set Latency Timer (2ms) - Crucial para no perder paquetes pequeños
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x09, value: 0x0002, index: 0x0000
      });

      return true;
    } catch (error) {
      console.error("USB Connect Error:", error);
      return false;
    }
  }

  get isHardwareReady(): boolean {
    return this.device !== null && this.device.opened;
  }

  async sendRaw(hexString: string): Promise<boolean> {
    if (this.isSimulated) return true;
    if (!this.device?.opened) return false;
    try {
      const cleanHex = hexString.replace(/\s/g, '');
      const bytes = new Uint8Array(cleanHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      const result = await this.device.transferOut(this.outEndpoint, bytes);
      return result.status === 'ok';
    } catch (e) {
      return false;
    }
  }

  async readSpectrum(): Promise<Uint16Array | null> {
    if (this.isSimulated) {
      return new Uint16Array(Array.from({ length: 128 }, (_, i) => {
        const base = 25000 + Math.sin(i / 15) * 8000;
        return Math.floor(base + Math.random() * 500);
      }));
    }

    if (!this.device?.opened) return null;

    try {
      // Limpieza de buffer previa para asegurar datos frescos
      try {
        await this.device.transferIn(this.inEndpoint, 64);
      } catch (e) {}

      // Comando de disparo estándar MicroNIR
      await this.sendRaw("05");
      
      // Tiempo de integración (Ajustable según exposición del sensor)
      await this.delay(100);

      // Leemos un bloque lo suficientemente grande (típico espectro 128 px * 2 bytes = 256 bytes)
      // Sumamos 2 bytes extra por el header de estado de FTDI
      const result = await this.device.transferIn(this.inEndpoint, 512);
      
      if (result.data && result.data.byteLength > 2) {
        const bytesReceived = result.data.byteLength - 2;
        const view = new DataView(result.data.buffer, 2); // Saltamos los 2 bytes de estado FTDI
        
        // El sensor NIR suele enviar 128 puntos.
        const numPoints = Math.floor(bytesReceived / 2);
        const spectrum = new Uint16Array(numPoints);
        
        for (let i = 0; i < numPoints; i++) {
          // Leemos como Big Endian (false) que es el estándar industrial
          spectrum[i] = view.getUint16(i * 2, false);
        }
        
        return spectrum;
      }
      return null;
    } catch (e) {
      console.error("Read Error:", e);
      return null;
    }
  }

  async setLamp(on: boolean): Promise<boolean> {
    if (this.isSimulated) return true;
    // Comandos de control de periféricos MicroNIR (ajustados a protocolo binario)
    return await this.sendRaw(on ? "02 01 01 03" : "02 01 00 03");
  }

  async disconnect() {
    if (this.device?.opened) {
      await this.device.close();
    }
    this.device = null;
  }
}

export const microNir = new MicroNIRDevice();
