
import { BLE_CONFIG } from "../constants";

interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATTService {
  uuid: string;
  getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  uuid: string;
  value?: DataView;
  properties: {
      write: boolean;
      writeWithoutResponse: boolean;
      notify: boolean;
      indicate: boolean;
      read: boolean;
  };
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

declare global {
  interface Navigator {
    bluetooth: {
      requestDevice(options: any): Promise<BluetoothDevice>;
    }
  }
}

const CRC8_TABLE = new Uint8Array([
  0x00, 0x5e, 0xbc, 0xe2, 0x61, 0x3f, 0xdd, 0x83, 0xc2, 0x9c, 0x7e, 0x20, 0xa3, 0xfd, 0x1f, 0x41,
  0x9d, 0xc3, 0x21, 0x7f, 0xfc, 0xa2, 0x40, 0x1e, 0x5f, 0x01, 0xe3, 0xbd, 0x3e, 0x60, 0x82, 0xdc,
  0x23, 0x7d, 0x9f, 0xc1, 0x42, 0x1c, 0xfe, 0xa0, 0xe1, 0xbf, 0x5d, 0x03, 0x80, 0xde, 0x3c, 0x62,
  0xbe, 0xe0, 0x02, 0x5c, 0xdf, 0x81, 0x63, 0x3d, 0x7c, 0x22, 0xc0, 0x9e, 0x1d, 0x43, 0xa1, 0xff,
  0x46, 0x18, 0xfa, 0xa4, 0x27, 0x79, 0x9b, 0xc5, 0x84, 0xda, 0x38, 0x66, 0xe5, 0xbb, 0x59, 0x07,
  0xdb, 0x85, 0x67, 0x39, 0xba, 0xe4, 0x06, 0x58, 0x19, 0x47, 0xa5, 0xfb, 0x78, 0x26, 0xc4, 0x9a,
  0x65, 0x3b, 0xd9, 0x87, 0x04, 0x5a, 0xb8, 0xe6, 0xa7, 0xf9, 0x1b, 0x45, 0xc6, 0x98, 0x7a, 0x24,
  0xf8, 0xa6, 0x44, 0x1a, 0x99, 0xc7, 0x25, 0x7b, 0x3a, 0x64, 0x86, 0xd8, 0x5b, 0x05, 0xe7, 0xb9,
  0x8c, 0xd2, 0x30, 0x6e, 0xed, 0xb3, 0x51, 0x0f, 0x4e, 0x10, 0xf2, 0xac, 0x2f, 0x71, 0x93, 0xcd,
  0x11, 0x4f, 0xad, 0xf3, 0x70, 0x2e, 0xcc, 0x92, 0xd3, 0x8d, 0x6f, 0x31, 0x8f, 0xd1, 0x50, 0x0e,
  0xaf, 0xf1, 0x13, 0x4d, 0xce, 0x90, 0x72, 0x2c, 0x6d, 0x33, 0x81, 0xdf, 0x0c, 0x52, 0xb0, 0xee,
  0x32, 0x6c, 0x8e, 0xd0, 0x53, 0x0d, 0xef, 0xb1, 0xf0, 0xae, 0x4c, 0x12, 0x91, 0xcf, 0x2d, 0x73,
  0xca, 0x94, 0x76, 0x28, 0xab, 0xf5, 0x17, 0x49, 0x08, 0x56, 0xb4, 0xea, 0x69, 0x37, 0x85, 0xdb,
  0x57, 0x09, 0xeb, 0xb5, 0x36, 0x68, 0x8a, 0xd4, 0x95, 0xcb, 0x29, 0x77, 0xf4, 0xaa, 0x48, 0x16,
  0xe9, 0xb7, 0x55, 0x0b, 0x88, 0xd6, 0x34, 0x6a, 0x2b, 0x75, 0x97, 0xc9, 0x4a, 0x14, 0xf6, 0xa8,
  0x74, 0x2a, 0xc8, 0x96, 0x15, 0x4b, 0xa9, 0xf7, 0xb6, 0xe8, 0x0a, 0x54, 0xd7, 0x89, 0x6b, 0x35
]);

function calculateCrc8(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = CRC8_TABLE[crc ^ data[i]];
  }
  return crc;
}

const CMD = {
  LAMP_CONTROL: 0x01,
  SCAN: 0x05,
  GET_TEMP: 0x06,
  PING: 0x14,
  RESET: 0x0F
};

export class MicroNIRBLEDriver {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  
  public isConnected = false;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private lastPacket: Uint8Array | null = null;
  private logger: (msg: string) => void = () => {};

  public setLogger(fn: (msg: string) => void) { this.logger = fn; }
  private log(msg: string) { this.logger(`[BLE] ${msg}`); }
  private async sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  async connect(): Promise<string> {
    try {
      if (!navigator.bluetooth) return "Navegador incompatible con Bluetooth.";
      
      this.log("Buscando equipos MicroNIR...");
      
      // SOLUCIÓN: Usar UUIDs completos de 128 bits y evitar strings cortos inválidos
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
            { namePrefix: "MicroNIR" },
            { namePrefix: "VIAVI" }
        ],
        optionalServices: [
            BLE_CONFIG.serviceUUID, 
            BLE_CONFIG.nordicService,
            '0000fee9-0000-1000-8000-00805f9b34fb', // Alias para FEE9
            '0000180a-0000-1000-8000-00805f9b34fb'  // Device Information
        ]
      });

      this.log(`Conectando a: ${this.device.name}...`);
      this.server = await this.device.gatt!.connect();
      
      this.log("Mapeando servicios del hardware...");
      const services = await this.server.getPrimaryServices();
      this.log(`Encontrados ${services.length} servicios.`);
      
      let mainService: BluetoothRemoteGATTService | null = null;

      // Intentar encontrar el servicio por UUID conocido
      for (const s of services) {
          const uuid = s.uuid.toLowerCase();
          this.log(`- Servicio: ${uuid}`);
          if (uuid.includes('ff01') || uuid.includes('6e400001')) {
              mainService = s;
              break;
          }
      }

      // Si no encontramos por UUID, usamos el primer servicio que no sea estándar de batería/info
      if (!mainService && services.length > 0) {
          this.log("UUID específico no hallado. Buscando servicio de datos genérico...");
          mainService = services.find(s => !s.uuid.includes('180a') && !s.uuid.includes('1800')) || services[0];
      }

      if (!mainService) throw new Error("No se halló un servicio de datos válido.");

      this.log(`Usando servicio: ${mainService.uuid}`);
      const characteristics = await mainService.getCharacteristics();
      this.log(`Encontradas ${characteristics.length} características.`);

      // Mapeo dinámico de TX y RX basándose en propiedades
      for (const char of characteristics) {
          const props = char.properties;
          this.log(`- Char: ${char.uuid} [Write:${props.write}, Notify:${props.notify}]`);
          
          if ((props.write || props.writeWithoutResponse) && !this.txChar) {
              this.txChar = char;
          }
          if ((props.notify || props.indicate) && !this.rxChar) {
              this.rxChar = char;
          }
      }

      if (!this.txChar || !this.rxChar) {
          throw new Error("No se pudieron mapear los canales de entrada/salida.");
      }

      this.log("Configurando canal de respuesta...");
      await this.rxChar.startNotifications();
      this.rxChar.addEventListener('characteristicvaluechanged', this.onDataReceived);

      this.isConnected = true;
      this.log("SINCRONIZACIÓN EXITOSA.");
      
      // Despertar sensor
      await this.send(CMD.PING, [], true);
      
      return "OK";
    } catch (error: any) {
      this.log(`ERROR DE ENLACE: ${error.message}`);
      this.isConnected = false;
      return error.message;
    }
  }

  private onDataReceived = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const chunk = new Uint8Array(value.buffer);
    
    const combined = new Uint8Array(this.rxBuffer.length + chunk.length);
    combined.set(this.rxBuffer);
    combined.set(chunk, this.rxBuffer.length);
    this.rxBuffer = combined;
    
    this.processBuffer();
  };

  private processBuffer() {
    let stx = this.rxBuffer.indexOf(0x02);
    if (stx === -1) {
        if (this.rxBuffer.length > 1024) this.rxBuffer = new Uint8Array(0);
        return;
    }

    let etx = this.rxBuffer.indexOf(0x03, stx + 1);
    while (etx !== -1) {
        const pkt = this.rxBuffer.slice(stx, etx + 1);
        if (pkt.length >= 5) {
            const payload = pkt.slice(1, pkt.length - 2);
            const crc = pkt[pkt.length - 2];
            if (calculateCrc8(payload) === crc) {
                this.lastPacket = pkt;
                this.rxBuffer = this.rxBuffer.slice(etx + 1);
                stx = this.rxBuffer.indexOf(0x02);
                if (stx === -1) break;
                etx = this.rxBuffer.indexOf(0x03, stx + 1);
                continue;
            }
        }
        this.rxBuffer = this.rxBuffer.slice(stx + 1);
        stx = this.rxBuffer.indexOf(0x02);
        if (stx === -1) break;
        etx = this.rxBuffer.indexOf(0x03, stx + 1);
    }
  }

  async send(opcode: number, data: number[] = [], silent = false): Promise<boolean> {
    if (!this.isConnected || !this.txChar) return false;
    
    const len = data.length + 1;
    const payload = new Uint8Array([len, opcode, ...data]);
    const crc = calculateCrc8(payload);
    const packet = new Uint8Array([0x02, ...payload, crc, 0x03]);
    
    try {
      if (this.txChar.writeValueWithResponse) {
        await this.txChar.writeValueWithResponse(packet);
      } else {
        await this.txChar.writeValue(packet);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  private async waitForPacket(timeout: number): Promise<Uint8Array | null> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.lastPacket) {
        const p = this.lastPacket;
        this.lastPacket = null;
        return p;
      }
      await this.sleep(20);
    }
    return null;
  }

  async getTemperature(): Promise<number | null> {
    if (await this.send(CMD.GET_TEMP)) {
        const resp = await this.waitForPacket(1000);
        if (resp) {
            const idx = resp.indexOf(CMD.GET_TEMP);
            if (idx !== -1 && idx + 2 < resp.length) {
                const raw = (resp[idx+1] << 8) | resp[idx+2];
                return ((raw & 0xFFF8) >> 3) / 16.0;
            }
        }
    }
    return null;
  }

  async scan(): Promise<Uint16Array | null> {
    this.log("Capturando espectro (Wireless)...");
    if (!await this.send(CMD.SCAN)) return null;
    const raw = await this.waitForPacket(10000);
    if (!raw) return null;
    
    const offset = raw.indexOf(CMD.SCAN) + 1;
    const s = new Uint16Array(128);
    for(let j=0; j<128; j++) {
        const idx = offset + (j*2);
        if (idx + 1 < raw.length) s[j] = (raw[idx] << 8) | raw[idx+1];
    }
    return s;
  }

  async setLamp(on: boolean): Promise<boolean> {
    const ok = await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
    if (on && ok) await this.sleep(2000);
    return ok;
  }

  async resetHardware(): Promise<void> {
      await this.send(CMD.RESET);
      if (this.server) this.server.disconnect();
      this.isConnected = false;
  }
}

export const bleDevice = new MicroNIRBLEDriver();
