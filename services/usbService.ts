
import { USB_CONFIG } from "../constants";

export class MicroNIRDevice {
  private device: any | null = null;

  async connect(): Promise<boolean> {
    try {
      this.device = await (navigator as any).usb.requestDevice({
        filters: [{ vendorId: USB_CONFIG.vendorId }]
      });

      await this.device.open();
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }
      await this.device.claimInterface(0);
      
      console.log("Hardware detectado:", this.device.productName);
      return true;
    } catch (error) {
      console.error("Error USB:", error);
      return false;
    }
  }

  // Permite enviar cualquier comando en Hex para probar el encendido de la lámpara
  async sendRaw(hexString: string): Promise<boolean> {
    if (!this.device) return false;
    try {
      const bytes = new Uint8Array(hexString.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      await this.device.transferOut(1, bytes);
      return true;
    } catch (e) {
      console.error("Error enviando raw bytes:", e);
      return false;
    }
  }

  async setLamp(on: boolean) {
    if (!this.device) return;
    // Comandos comunes en sensores NIR (pueden variar según versión de firmware)
    // Intentamos comando estándar de activación de fuente
    const cmd = on ? "020103" : "020003"; 
    return this.sendRaw(cmd);
  }

  async readSpectrum(): Promise<Uint16Array | null> {
    if (!this.device) return null;
    try {
      // 1. Enviar Trigger de escaneo
      await this.sendRaw("05"); 
      
      // 2. Leer respuesta (Ajustado a 256 bytes para 128 píxeles)
      const result = await this.device.transferIn(2, 256);
      
      if (result.data && result.data.byteLength > 0) {
        return new Uint16Array(result.data.buffer);
      }
      return null;
    } catch (e) {
      console.error("Error en lectura de espectro:", e);
      return null;
    }
  }

  get isConnected() {
    return this.device?.opened || false;
  }
}

export const microNir = new MicroNIRDevice();
