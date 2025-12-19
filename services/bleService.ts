
import { BLE_CONFIG } from "../constants";

// Definiciones de tipos para Web Bluetooth API
interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothCharacteristicProperties {
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
  read: boolean;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  uuid: string;
  properties: BluetoothCharacteristicProperties;
  value?: DataView;
  writeValue(value: BufferSource): Promise<void>;
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

// Tabla CRC8 (Misma que USB)
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

function toHex(buffer: Uint8Array | number[]): string {
  const arr = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

const CMD = {
  LAMP_CONTROL: 0x01,
  SET_CONFIG: 0x02, 
  GET_INFO: 0x03, 
  SCAN: 0x05,
  GET_TEMP: 0x06,
  RESET: 0x0F // Comando Reset
};

export class MicroNIRBLEDriver {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private listeningChars: BluetoothRemoteGATTCharacteristic[] = [];
  
  private keepAliveInterval: any = null;
  private pendingResponse = false;

  public isConnected = false;
  
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private lastPacket: Uint8Array | null = null;
  
  private logger: (msg: string) => void = () => {};

  public setLogger(fn: (msg: string) => void) {
    this.logger = fn;
  }

  private log(msg: string) {
    this.logger(`[BLE] ${msg}`);
  }

  private async sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.disconnect();
      });
    }
  }

  async connect(): Promise<string> {
    try {
      if (!navigator.bluetooth) {
        return "Navegador no soporta Web Bluetooth";
      }

      this.disconnectCleanly();

      this.log("Buscando dispositivo MicroNIR BLE...");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: BLE_CONFIG.namePrefix }],
        optionalServices: [BLE_CONFIG.serviceUUID]
      });

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected);

      this.log("Conectando a servidor GATT...");
      this.server = await this.device.gatt!.connect();

      this.log("Obteniendo servicio primario...");
      const service = await this.server.getPrimaryService(BLE_CONFIG.serviceUUID);

      const chars = await service.getCharacteristics();
      this.log(`Encontradas ${chars.length} características.`);

      let foundTx = false;

      for (const c of chars) {
        const props = c.properties;
        
        // TX
        if ((props.write || props.writeWithoutResponse) && !foundTx) {
          this.txChar = c;
          foundTx = true;
          this.log(` -> ASIGNADO TX: ${c.uuid}`);
        }

        // RX
        if (props.notify || props.indicate) {
          try {
            await c.startNotifications();
            c.addEventListener('characteristicvaluechanged', this.handleNotifications);
            this.listeningChars.push(c);
            this.log(` -> SUSCRITO RX: ${c.uuid}`);
          } catch (e) {
            console.warn(`Error suscribiendo:`, e);
            this.log(`Error suscribiendo a ${c.uuid}: ${e}`);
          }
        }
      }

      if (!this.txChar) throw new Error("No TX channel found");
      if (this.listeningChars.length === 0) throw new Error("No RX channel found");

      this.isConnected = true;
      this.rxBuffer = new Uint8Array(0);

      // --- ESTRATEGIA DE CONEXIÓN V6 (Paridad con USB) ---
      
      // 1. Inicialización: Solo Configurar Integración (4 Bytes)
      // Esto desbloquea la máquina de estados igual que en USB
      this.log("Inicializando Sensor (Set Integration)...");
      await this.initializeSensor();
      
      // 2. Handshake Final
      this.log("Verificando Estado (GET INFO)...");
      await this.send(CMD.GET_INFO, [], true); 

      this.startKeepAlive();
      
      this.log("BLE Listo.");
      return "OK";

    } catch (error: any) {
      console.error("BLE Connect Error:", error);
      this.isConnected = false;
      this.log(`Error Conexión: ${error.message}`);
      return error.message || "Error BLE Desconocido";
    }
  }

  private async initializeSensor() {
    // Comando 0x02: Set Integration Time
    // CORRECCIÓN V6: Enviar exactamente lo mismo que el driver USB.
    // Solo 4 bytes (Big Endian) para el tiempo de integración.
    
    const integrationTime = 6800; // 6800us

    // TIME (Big Endian)
    const t0 = (integrationTime >> 24) & 0xFF;
    const t1 = (integrationTime >> 16) & 0xFF;
    const t2 = (integrationTime >> 8) & 0xFF;
    const t3 = (integrationTime) & 0xFF;

    // Payload de 4 bytes
    const payload = [t0, t1, t2, t3];

    this.log(`Enviando Config USB-Style [${payload.join(', ')}]`);
    await this.send(CMD.SET_CONFIG, payload, true); 
    await this.sleep(500); 
  }

  async disconnect(): Promise<void> {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    } else {
      this.disconnectCleanly();
    }
    this.log("Desconectado.");
  }

  private startKeepAlive() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(() => {
      if (this.isConnected && !this.pendingResponse) { 
         this.send(CMD.GET_TEMP, [], true).catch(() => {});
      }
    }, 4000);
  }

  private disconnectCleanly() {
    this.isConnected = false;
    this.pendingResponse = false;
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.listeningChars = [];
    this.rxBuffer = new Uint8Array(0);
    this.txChar = null;
  }

  private onDisconnected = () => {
    this.log("Evento Desconectado recibido");
    this.disconnectCleanly();
  };

  private handleNotifications = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;

    const chunk = new Uint8Array(value.buffer);
    this.log(`RX Notify <<< ${toHex(chunk)}`);

    const newBuffer = new Uint8Array(this.rxBuffer.length + chunk.length);
    newBuffer.set(this.rxBuffer);
    newBuffer.set(chunk, this.rxBuffer.length);
    this.rxBuffer = newBuffer;

    this.scanForPackets();
  };

  private scanForPackets() {
    if (this.rxBuffer.length === 0) return;

    const stxIndex = this.rxBuffer.indexOf(0x02);
    if (stxIndex === -1) {
       if (this.rxBuffer.length > 2048) this.rxBuffer = new Uint8Array(0);
       return;
    }

    let packetFound = false;
    
    for (let i = stxIndex + 1; i < this.rxBuffer.length; i++) {
        if (this.rxBuffer[i] === 0x03) {
            const candidate = this.rxBuffer.slice(stxIndex, i + 1);
            
            // Validar NAK (0x15)
            if (candidate.length > 1 && candidate[1] === 0x15) {
                console.warn("Sensor NAK (0x15) - Comando Rechazado");
                this.log(`NAK Recibido (0x15) - Comando Rechazado`);
                this.pendingResponse = false; 
                this.rxBuffer = this.rxBuffer.slice(i + 1);
                packetFound = true;
                break; 
            }

            if (candidate.length >= 4) {
                const payloadForCrc = candidate.slice(1, candidate.length - 2);
                const packetCrc = candidate[candidate.length - 2];
                const calcCrc = calculateCrc8(payloadForCrc);

                if (calcCrc === packetCrc) {
                    // console.log("Paquete CRC OK:", candidate);
                    this.lastPacket = candidate;
                    this.pendingResponse = false;
                    this.rxBuffer = this.rxBuffer.slice(i + 1);
                    packetFound = true;
                    break;
                } else {
                    this.log(`CRC Error en paquete: ${toHex(candidate)}`);
                }
            }
        }
    }

    if (packetFound && this.rxBuffer.length > 0) {
        this.scanForPackets();
    }
  }

  async send(opcode: number, data: number[] = [], silent = false): Promise<boolean> {
    if (!this.isConnected || !this.txChar) return false;

    if (!silent) {
        this.lastPacket = null;
        this.rxBuffer = new Uint8Array(0);
        this.pendingResponse = true;
    }

    const len = data.length + 1;
    const rawPayload = new Uint8Array([len, opcode, ...data]);
    const crc = calculateCrc8(rawPayload);
    const packet = new Uint8Array([0x02, ...rawPayload, crc, 0x03]);

    this.log(`TX >>> ${toHex(packet)}`);

    try {
      await this.txChar.writeValue(packet);
      return true;
    } catch (e) {
      if (!silent) this.pendingResponse = false;
      this.log(`Error TX: ${e}`);
      return false;
    }
  }

  private async waitForPacket(timeoutMs: number): Promise<Uint8Array | null> {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
      if (!this.pendingResponse && this.lastPacket) {
        const pkt = this.lastPacket;
        this.lastPacket = null;
        return pkt;
      }
      if (!this.pendingResponse && !this.lastPacket) {
          // Si pendingResponse se volvió false (por NAK u otro), salir.
          return null; 
      }
      await this.sleep(20);
    }
    this.pendingResponse = false;
    this.log("Timeout esperando paquete");
    return null;
  }

  async getTemperature(): Promise<number | null> {
    for (let i = 0; i < 3; i++) {
        if (!await this.send(CMD.GET_TEMP)) {
            await this.sleep(100);
            continue;
        }
        
        const resp = await this.waitForPacket(2500);
        if (resp && resp.length >= 5) {
            if (resp[2] === 0x06) { 
                const view = new DataView(resp.buffer);
                const val = view.getUint16(3, false); 
                return val / 1000.0;
            }
        }
        await this.sleep(200);
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    const ok = await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
    if (ok) await this.sleep(on ? 1500 : 200);
    return ok;
  }

  async scan(): Promise<Uint16Array | null> {
    if (!await this.send(CMD.SCAN)) return null;

    const raw = await this.waitForPacket(6000);
    if (!raw) return null;

    let spectrum: Uint16Array | null = null;

    // Detectar si es respuesta válida de escaneo (Opcode 0x05)
    // Formato corto: [02, LEN, 05, ...DATA..., CRC, 03]
    if (raw.length > 3 && raw[2] === 0x05) {
        const len = raw[1] - 1;
        spectrum = this.parseSpectrum(raw, 3, len/2);
    }
    // Formato largo (Extended Length): [02, HI, LO, 05, ...DATA..., CRC, 03]
    else if (raw.length > 4 && raw[3] === 0x05) {
        const len = (raw[1] << 8 | raw[2]) - 1;
        spectrum = this.parseSpectrum(raw, 4, len/2);
    }
    // Fallback simple por tamaño
    else if (raw.length >= 256) {
        spectrum = this.parseSpectrum(raw, 0, 128);
    }

    return spectrum;
  }

  private parseSpectrum(buffer: Uint8Array, offset: number, pixels: number): Uint16Array {
    const bytesAvailable = buffer.length - offset;
    const pixelsPossible = Math.floor(bytesAvailable / 2);
    const targetPixels = (pixelsPossible >= 128) ? 128 : pixels;

    const s = new Uint16Array(targetPixels);
    const view = new DataView(buffer.buffer);
    for(let j=0; j<targetPixels; j++) {
       // Offset + j*2 debe ser < buffer.length - overhead
       if (offset + (j*2) + 1 < buffer.length) {
         s[j] = view.getUint16(offset + (j*2), false); 
       }
    }
    return s;
  }
}

export const bleDevice = new MicroNIRBLEDriver();
