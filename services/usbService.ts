
import { USB_CONFIG } from "../constants";

export class MicroNIRDevice {
  // Use 'any' type to fix "Cannot find name 'USBDevice'" as WebUSB types are not globally available in this context
  private device: any | null = null;
  private inEndpoint: number = 2;
  private outEndpoint: number = 1;
  public isSimulated: boolean = false;

  async connect(): Promise<boolean> {
    if (this.isSimulated) return true;
    try {
      // Cast navigator to 'any' to fix "Property 'usb' does not exist on type 'Navigator'"
      // 1. Solicitar dispositivo
      this.device = await (navigator as any).usb.requestDevice({
        filters: [{ vendorId: USB_CONFIG.vendorId }]
      });

      await this.device.open();

      // 2. Configuración estándar FTDI/MicroNIR
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }
      
      const interfaceNum = 0;
      // Liberar si ya estaba reclamada (evita errores de reconexión)
      try {
        await this.device.claimInterface(interfaceNum);
      } catch (e) {
        // Si ya está reclamada, intentamos continuar
      }

      // 3. Identificar endpoints dinámicamente
      const endpoints = this.device.configuration?.interfaces[interfaceNum].alternate.endpoints;
      endpoints?.forEach((ep: any) => {
        if (ep.direction === 'in') this.inEndpoint = ep.endpointNumber;
        if (ep.direction === 'out') this.outEndpoint = ep.endpointNumber;
      });

      // 4. Inicialización crítica (Comando de Reset para FTDI)
      // Muchos MicroNIR no responden si no se limpia el buffer inicial
      await this.device.controlTransferOut({
        requestType: 'vendor',
        recipient: 'device',
        request: 0x00, // RESET
        value: 0x00,
        index: 0x00
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
      return new Uint16Array(Array.from({ length: 100 }, (_, i) => {
        const base = 20000 + Math.sin(i / 10) * 5000;
        return Math.floor(base + Math.random() * 200);
      }));
    }

    if (!this.device?.opened) return null;

    try {
      // Limpiar buffer de entrada antes de pedir nuevo dato
      try {
        await this.device.transferIn(this.inEndpoint, 64);
      } catch(e) { /* ignore timeout */ }

      // Comando de disparo (05 es el estándar para disparar escaneo en muchos NIR)
      const sent = await this.sendRaw("05");
      if (!sent) return null;

      // Esperar la respuesta (MicroNIR devuelve típicamente 100-128 puntos de 16 bits)
      const result = await this.device.transferIn(this.inEndpoint, 512);
      
      if (result.data && result.data.byteLength >= 128) {
        // Convertir bytes a Uint16 (Big Endian o Little Endian según firmware)
        return new Uint16Array(result.data.buffer);
      }
      return null;
    } catch (e) {
      console.error("Read Error:", e);
      return null;
    }
  }

  async setLamp(on: boolean): Promise<boolean> {
    if (this.isSimulated) return true;
    // Comandos de paquete MicroNIR típicos: [Header, Op, Val, Footer]
    const cmd = on ? "02 01 01 03" : "02 01 00 03";
    return this.sendRaw(cmd);
  }

  setSimulation(enabled: boolean) {
    this.isSimulated = enabled;
  }

  async disconnect() {
    if (this.device?.opened) {
      await this.device.close();
    }
    this.device = null;
  }
}

export const microNir = new MicroNIRDevice();
