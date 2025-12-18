
import { USB_CONFIG } from "../constants";

export class MicroNIRDevice {
  private device: any | null = null;
  private inEndpoint: number = 2;
  private outEndpoint: number = 1;
  public isSimulated: boolean = false;

  async connect(): Promise<boolean> {
    if (this.isSimulated) return true;

    try {
      this.device = await (navigator as any).usb.requestDevice({
        filters: [{ vendorId: USB_CONFIG.vendorId }]
      });

      await this.device.open();
      
      // Selección dinámica de configuración e interfaz
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }
      
      const interfaceNum = 0;
      await this.device.claimInterface(interfaceNum);

      // Descubrimiento de Endpoints (Evita errores de hardcoding)
      const endpoints = this.device.configuration.interfaces[interfaceNum].alternate.endpoints;
      endpoints.forEach((ep: any) => {
        if (ep.direction === 'in') this.inEndpoint = ep.endpointNumber;
        if (ep.direction === 'out') this.outEndpoint = ep.endpointNumber;
      });

      console.log(`Endpoints detectados - IN: ${this.inEndpoint}, OUT: ${this.outEndpoint}`);
      return true;
    } catch (error) {
      console.error("Fallo en conexión física:", error);
      return false;
    }
  }

  async sendRaw(hexString: string): Promise<boolean> {
    if (this.isSimulated) return true;
    if (!this.device?.opened) return false;

    try {
      const cleanHex = hexString.replace(/\s/g, '');
      const bytes = new Uint8Array(cleanHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      
      // Usamos el endpoint descubierto dinámicamente
      const result = await this.device.transferOut(this.outEndpoint, bytes);
      return result.status === 'ok';
    } catch (e) {
      console.error("Error de transmisión:", e);
      return false;
    }
  }

  async readSpectrum(): Promise<Uint16Array | null> {
    if (this.isSimulated) {
      // Generar espectro simulado con ruido gaussiano para pruebas
      return new Uint16Array(Array.from({ length: 100 }, () => 15000 + Math.random() * 5000));
    }

    if (!this.device?.opened) return null;

    try {
      // Comando de adquisición (estándar MicroNIR)
      await this.sendRaw("05"); 
      const result = await this.device.transferIn(this.inEndpoint, 512);
      
      if (result.data && result.data.byteLength > 0) {
        return new Uint16Array(result.data.buffer);
      }
      return null;
    } catch (e) {
      console.error("Error de lectura:", e);
      return null;
    }
  }

  async setLamp(on: boolean): Promise<boolean> {
    // Comando estándar para encender/apagar lámparas
    const cmd = on ? "02 01 03" : "02 00 03";
    return this.sendRaw(cmd);
  }

  get isConnected() {
    return this.isSimulated || (this.device?.opened || false);
  }

  setSimulation(enabled: boolean) {
    this.isSimulated = enabled;
  }
}

export const microNir = new MicroNIRDevice();
