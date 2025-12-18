
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

      // --- CONFIGURACIÓN FTDI ---
      // Reset
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x00, value: 0x00, index: 0x00
      });

      // Baud Rate 115200 (Divisor 0x401A para FT232R)
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x03, value: 0x401A, index: 0x0000
      });

      // DTR & RTS HIGH (Alimentación sensor)
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x01, value: 0x0101, index: 0x0000
      });
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x01, value: 0x0202, index: 0x0000
      });

      // Latency Timer al mínimo (1ms) para evitar que el chip retenga datos
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
      // 1. LIMPIEZA PROFUNDA: Vaciar cualquier dato pendiente en el chip
      // Hacemos varias lecturas pequeñas para purgar el buffer de entrada
      for(let i = 0; i < 10; i++) {
        const purge = await this.device.transferIn(this.inEndpoint, 64);
        if (purge.data.byteLength <= 2) break; // Buffer vacío
      }

      // 2. DISPARO DE ESCANEO
      // Enviamos el comando de escaneo estándar
      await this.sendRaw("02 05 03");
      
      // 3. ESPERA DINÁMICA: Damos tiempo al sensor para procesar la luz
      await this.delay(250);

      let accumulatedBytes = new Uint8Array(0);
      const startTime = Date.now();
      const TIMEOUT = 2000; // 2 segundos máximo de espera por datos

      // 4. BUCLE DE CAPTURA AGRESIVO
      while (Date.now() - startTime < TIMEOUT) {
        // Pedimos paquetes de 512 bytes (el espectro completo suele ser de 256 bytes)
        const result = await this.device.transferIn(this.inEndpoint, 512);
        
        if (result.status === 'ok' && result.data && result.data.byteLength > 2) {
          // El chip FTDI siempre añade 2 bytes de estado al principio de cada transferencia
          const actualData = new Uint8Array(result.data.buffer, 2);
          
          // Acumulamos los nuevos bytes
          const nextBuffer = new Uint8Array(accumulatedBytes.length + actualData.length);
          nextBuffer.set(accumulatedBytes);
          nextBuffer.set(actualData, accumulatedBytes.length);
          accumulatedBytes = nextBuffer;

          // Si ya tenemos al menos 256 bytes (128 puntos x 2 bytes), tenemos un espectro completo
          if (accumulatedBytes.length >= 256) break;
        }
        
        // Pequeña pausa para no saturar el hilo principal
        await this.delay(10);
      }

      // 5. CONVERSIÓN DE DATOS
      if (accumulatedBytes.length >= 20) {
        const numPoints = Math.floor(accumulatedBytes.length / 2);
        const spectrum = new Uint16Array(numPoints);
        const view = new DataView(accumulatedBytes.buffer, accumulatedBytes.byteOffset, accumulatedBytes.byteLength);
        
        for (let i = 0; i < numPoints; i++) {
          // Intentamos Big Endian (estándar MicroNIR)
          // Si los valores parecen erróneos, el siguiente paso sería probar Little Endian
          spectrum[i] = view.getUint16(i * 2, false); 
        }
        return spectrum;
      }

      console.warn("Lectura incompleta. Bytes recibidos:", accumulatedBytes.length);
      return null;
    } catch (e) {
      console.error("Error en la captura física del espectro:", e);
      return null;
    }
  }

  async setLamp(on: boolean): Promise<boolean> {
    if (this.isSimulated) return true;
    // El comando de lámpara funciona (confirmado por logs del usuario)
    return await this.sendRaw(on ? "02 01 01 03" : "02 01 00 03");
  }

  async disconnect() {
    if (this.device?.opened) {
      // Antes de cerrar, intentamos apagar la lámpara por seguridad
      await this.setLamp(false);
      await this.device.close();
    }
    this.device = null;
  }
}

export const microNir = new MicroNIRDevice();
