
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
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }
      
      const interfaceNum = 0;
      await this.device.claimInterface(interfaceNum);

      const endpoints = this.device.configuration.interfaces[interfaceNum].alternate.endpoints;
      endpoints.forEach((ep: any) => {
        if (ep.direction === 'in') this.inEndpoint = ep.endpointNumber;
        if (ep.direction === 'out') this.outEndpoint = ep.endpointNumber;
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
      // Espectro base de proteína (~15%) con variaciones reales
      return new Uint16Array(Array.from({ length: 100 }, (_, i) => {
        const base = 20000 + Math.sin(i / 10) * 5000;
        return Math.floor(base + Math.random() * 200);
      }));
    }

    if (!this.device?.opened) return null;

    try {
      // Limpiar buffer previo antes de pedir nuevo espectro
      await this.device.transferIn(this.inEndpoint, 512).catch(() => {});
      
      await this.sendRaw("05"); 
      const result = await this.device.transferIn(this.inEndpoint, 512);
      
      if (result.data && result.data.byteLength >= 200) {
        const data = new Uint16Array(result.data.buffer);
        // Validación extra: ¿Hay señal real?
        const sum = data.reduce((a, b) => a + b, 0);
        if (sum === 0) return null;
        return data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async setLamp(on: boolean): Promise<boolean> {
    const cmd = on ? "02 01 03" : "02 00 03";
    return this.sendRaw(cmd);
  }

  setSimulation(enabled: boolean) {
    this.isSimulated = enabled;
  }
}

export const microNir = new MicroNIRDevice();
