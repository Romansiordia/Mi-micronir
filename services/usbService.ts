
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
  GET_STATUS: 0x03,
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
      
      this.inEndpoint = alt.endpoints.find((e: any) => e.direction === 'in')?.endpointNumber || 2;
      this.outEndpoint = alt.endpoints.find((e: any) => e.direction === 'out')?.endpointNumber || 1;
      
      try { await this.device.claimInterface(intf.interfaceNumber); } catch(e) {}

      // FTDI Initialization (Purge & Config)
      await this.ctrl(0x00, 0x00, 0x00);
      await this.ctrl(0x03, 0x401A, 0x00); // 115200 baud
      await this.ctrl(0x04, 0x0008, 0x00); // 8N1
      await this.ctrl(0x01, 0x0303, 0x00);

      this.isConnected = true;
      this.log("Hardware detectado. Sincronizando bus...");
      await this.flushRx();
      
      // Ping inicial para validar comunicación
      const temp = await this.getTemperature();
      if (temp === null) {
          // Si no responde, intentamos un reset suave
          await this.resetHardware();
          return "Reintentando conexión... El sensor estaba en reposo.";
      }

      this.log(`Sensor Online (${temp.toFixed(1)}°C). Configurando integración...`);
      // Configuración estándar VIAVI: 500 scans, 12.5ms integración
      await this.send(CMD.SET_INTEGRATION, [0x00, 0x00, 0x01, 0xF4, 0x00, 0x00, 0x30, 0xD4]);
      
      return "OK";
    } catch (error: any) {
      this.isConnected = false;
      return error.message || "Error USB";
    }
  }

  async resetHardware(): Promise<boolean> {
    this.log("Comando HARD RESET (0x0F) enviado...");
    const ok = await this.send(CMD.RESET);
    if (ok) {
      await this.sleep(1500);
      await this.flushRx();
    }
    return ok;
  }

  async disconnect() {
    if (this.device?.opened) {
        await this.setLamp(false);
        await this.device.close();
    }
    this.isConnected = false;
  }

  private async flushRx() {
    try { await this.device.transferIn(this.inEndpoint, 1024); } catch(e) {}
  }

  async send(opcode: number, data: number[] = []): Promise<boolean> {
    if (!this.isConnected) return false;
    const rawPayload = new Uint8Array([data.length + 1, opcode, ...data]);
    const packet = new Uint8Array([0x02, ...rawPayload, 0x00, 0x03]); // Protocolo STX/ETX
    try {
      const res = await this.device.transferOut(this.outEndpoint, packet);
      return res.status === 'ok';
    } catch (e) { return false; }
  }

  async isAutonomous(): Promise<boolean> {
    // Consulta byte 8 del paquete de estado (VIAVI Autonomous Flag)
    if (await this.send(CMD.GET_STATUS)) {
      const resp = await this.readPacket(this.STATUS_PACKET_SIZE, 300);
      if (resp && resp.length >= 10) {
        return resp[8] !== 0; // 0 = Ready, != 0 = Autonomous/Busy
      }
    }
    return false;
  }

  async getTemperature(): Promise<number | null> {
    if (await this.send(CMD.GET_TEMP)) {
      const resp = await this.readPacket(this.STATUS_PACKET_SIZE, 500);
      if (resp && resp.length >= 15) {
        const view = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
        return view.getUint16(13, false) / 100.0;
      }
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    this.log(`Lámpara comando: ${on ? 'ENCENDER' : 'APAGAR'}`);
    return await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
  }

  async scan(): Promise<Uint16Array | null> {
    // Protección contra error "Cannot execute scan during autonomous mode"
    let ready = false;
    for(let i=0; i<5; i++) {
        if (!(await this.isAutonomous())) {
            ready = true;
            break;
        }
        this.log(`Hardware ocupado (Ciclo ${i+1}/5). Esperando...`);
        await this.sleep(800);
    }

    if (!ready) {
        this.log("Error crítico: El hardware no salió del modo autónomo.");
        return null;
    }

    if (!await this.send(CMD.SCAN)) return null;
    
    // Esperamos el paquete de datos (289 bytes)
    const raw = await this.readPacket(this.SCAN_PACKET_SIZE, 5000);
    if (!raw) {
        this.log("Error: Tiempo de espera de escaneo agotado.");
        return null;
    }
    return this.parseSpectrum(raw);
  }

  private parseSpectrum(buffer: Uint8Array): Uint16Array {
    const s = new Uint16Array(128);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    // El offset 33 es donde terminan los metadatos y empiezan los píxeles en el paquete de 289 bytes
    const offset = 33; 
    for(let j=0; j<128; j++) {
      const idx = offset + (j*2);
      if (idx + 1 < buffer.length) {
        s[j] = view.getUint16(idx, false);
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
          const chunk = new Uint8Array(res.data.buffer.slice(2)); // Quitar overhead de 2 bytes FTDI
          const next = new Uint8Array(acc.length + chunk.length);
          next.set(acc); 
          next.set(chunk, acc.length);
          acc = next;
          
          // Si recibimos un paquete de estado (33) pero buscamos datos (289), 
          // verificamos si el paquete de estado indica error autónomo
          if (acc.length === this.STATUS_PACKET_SIZE && expectedSize === this.SCAN_PACKET_SIZE) {
              if (acc[8] !== 0) {
                  this.log("Aviso: Hardware reportó estado ocupado durante la lectura.");
              }
              // Seguimos esperando los datos reales
          }

          if (acc.length >= expectedSize) {
              // Si acumulamos de más, buscamos el marcador de inicio STX (0x02)
              const stx = acc.indexOf(0x02);
              if (stx !== -1) {
                  return acc.slice(stx, stx + expectedSize);
              }
              return acc.slice(0, expectedSize);
          }
        }
      } catch (e) { await this.sleep(30); }
    }
    return null;
  }
}

export const device = new MicroNIRDriver();
