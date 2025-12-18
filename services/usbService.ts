
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
        console.warn("Interfaz ya reclamada");
      }

      const endpoints = this.device.configuration?.interfaces[interfaceNum].alternate.endpoints;
      endpoints?.forEach((ep: any) => {
        if (ep.direction === 'in') this.inEndpoint = ep.endpointNumber;
        if (ep.direction === 'out') this.outEndpoint = ep.endpointNumber;
      });

      // --- CONFIGURACIÓN DE HARDWARE FTDI ULTRA-ESTABLE ---
      
      // 1. Reset SIO
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x00, value: 0x00, index: 0x00
      });

      // 2. Set Baud Rate (115200) - Usando divisor exacto 0x401A para FT232R
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x03, value: 0x401A, index: 0x0000
      });

      // 3. SET DTR & RTS HIGH (Esencial para alimentar el sensor)
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x01, value: 0x0101, index: 0x0000
      });
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x01, value: 0x0202, index: 0x0000
      });

      // 4. Set Latency Timer (a 1ms para máxima velocidad de respuesta)
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x09, value: 0x0001, index: 0x0000
      });

      return true;
    } catch (error) {
      console.error("USB Connect Error:", error);
      return false;
    }
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
      return new Uint16Array(Array.from({ length: 128 }, (_, i) => 25000 + Math.floor(Math.random() * 5000)));
    }

    if (!this.device?.opened) return null;

    try {
      // 1. LIMPIEZA AGRESIVA (Flush)
      for(let i=0; i<5; i++) {
        try { await this.device.transferIn(this.inEndpoint, 64); } catch(e) { break; }
      }

      // 2. WAKE-UP CALL: Enviamos un byte nulo para "despertar" el puerto
      await this.sendRaw("00");
      await this.delay(50);

      // 3. DISPARO: STX (02) + SCAN (05) + ETX (03)
      await this.sendRaw("02 05 03");
      
      // 4. ESPERA DE INTEGRACIÓN: El sensor necesita tiempo para "cocinar" el espectro
      await this.delay(300);

      let allData = new Uint8Array(0);
      const startTime = Date.now();
      
      // 5. BUCLE DE CAPTURA (Hasta 1.5 segundos para no perder paquetes lentos)
      while (Date.now() - startTime < 1500) {
        const result = await this.device.transferIn(this.inEndpoint, 512);
        
        // El chip FTDI siempre devuelve 2 bytes de estado. Datos reales vienen después.
        if (result.data && result.data.byteLength > 2) {
          const chunk = new Uint8Array(result.data.buffer, 2);
          const combined = new Uint8Array(allData.length + chunk.length);
          combined.set(allData);
          combined.set(chunk, allData.length);
          allData = combined;

          // Un espectro típico de MicroNIR tiene ~128 píxeles (256 bytes)
          if (allData.length >= 256) break;
        }
        await this.delay(30);
      }

      // 6. PROCESAMIENTO DE BYTES A 16-BIT
      if (allData.length >= 20) {
        const numPoints = Math.floor(allData.length / 2);
        const spectrum = new Uint16Array(numPoints);
        const view = new DataView(allData.buffer, allData.byteOffset, allData.byteLength);
        
        for (let i = 0; i < numPoints; i++) {
          // MicroNIR usa Big Endian (el byte más significativo primero)
          spectrum[i] = view.getUint16(i * 2, false);
        }
        return spectrum;
      }
      
      return null;
    } catch (e) {
      console.error("Critical Read Error:", e);
      return null;
    }
  }

  async setLamp(on: boolean): Promise<boolean> {
    if (this.isSimulated) return true;
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
