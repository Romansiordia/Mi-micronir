
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
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean; indicate: boolean; read: boolean; };
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
  SET_INTEGRATION: 0x02, 
  GET_INFO: 0x03, 
  SCAN: 0x05,
  GET_TEMP: 0x06,
  RESET: 0x0F
};

export class MicroNIRBLEDriver {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private listeningChars: BluetoothRemoteGATTCharacteristic[] = [];
  
  private keepAliveInterval: any = null;
  private pendingResponse = false;
  private isBusy = false; 

  public isConnected = false;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private lastPacket: Uint8Array | null = null;
  private logger: (msg: string) => void = () => {};

  public setLogger(fn: (msg: string) => void) { this.logger = fn; }
  private log(msg: string) { this.logger(`[BLE] ${msg}`); }
  private async sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  async connect(): Promise<string> {
    try {
      if (!navigator.bluetooth) return "Navegador incompatible";
      await this.disconnect(); 

      this.log("Escaneando MicroNIR...");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: BLE_CONFIG.namePrefix }],
        optionalServices: [BLE_CONFIG.serviceUUID]
      });

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
      
      this.log("Conectando GATT...");
      this.server = await this.device.gatt!.connect();
      
      this.log("Estabilizando...");
      await this.sleep(1500); 

      const service = await this.server.getPrimaryService(BLE_CONFIG.serviceUUID);
      this.txChar = await service.getCharacteristic(BLE_CONFIG.txCharUUID);
      const rxChar = await service.getCharacteristic(BLE_CONFIG.rxCharUUID);

      await rxChar.startNotifications();
      rxChar.addEventListener('characteristicvaluechanged', this.handleNotifications);
      this.listeningChars.push(rxChar);

      this.isConnected = true;
      
      // Intentar ping suave
      await this.send(CMD.GET_INFO, [], true);
      await this.sleep(500);

      await this.softStartSensor();
      this.startKeepAlive();
      
      return "OK";
    } catch (error: any) {
      this.isConnected = false;
      this.log(`Error: ${error.message}`);
      return error.message || "Error BLE";
    }
  }

  private async softStartSensor() {
    this.isBusy = true;
    this.log("Sincronizando Sensor...");

    // Parámetros seguros para BLE
    const scanCount = 100; 
    const integrationTime = 10000; 

    // En BLE el payload suele ser directo sin padding largo si no es necesario, 
    // pero algunos firmwares requieren exactamente 8 bytes para SET_INTEGRATION
    const payload = [
        (scanCount >> 24) & 0xFF, (scanCount >> 16) & 0xFF, (scanCount >> 8) & 0xFF, scanCount & 0xFF,
        (integrationTime >> 24) & 0xFF, (integrationTime >> 16) & 0xFF, (integrationTime >> 8) & 0xFF, integrationTime & 0xFF
    ];

    let configured = false;
    for(let i=0; i<2; i++) {
        // Probamos enviar SIN byte de longitud
        configured = await this.send(CMD.SET_INTEGRATION, payload);
        const ack = await this.waitForPacket(1500);
        
        if (ack && ack.length > 1) {
            const opcode = ack[1]; // En modo sin LEN, el opcode es el byte 1
            if (opcode !== 0x15) {
                this.log("Config OK.");
                configured = true;
                break;
            } else {
                this.log("Sensor ocupado o NAK. Reintentando...");
            }
        }
        await this.sleep(500);
    }
    
    this.log("Sensor Listo.");
    this.isBusy = false;
  }

  async disconnect(): Promise<void> {
    if (this.server && this.server.connected) this.server.disconnect();
    this.disconnectCleanly();
  }

  private startKeepAlive() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(() => {
      if (this.isConnected && !this.pendingResponse && !this.isBusy) { 
         this.getTemperature().catch(() => {});
      }
    }, 10000); 
  }

  private disconnectCleanly() {
    this.isConnected = false;
    this.isBusy = false;
    this.pendingResponse = false;
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.listeningChars = [];
    this.rxBuffer = new Uint8Array(0);
    this.txChar = null;
  }

  private onDisconnected = () => {
    this.log("Desconectado.");
    this.disconnectCleanly();
  };

  private handleNotifications = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const chunk = new Uint8Array(value.buffer);
    this.log(`RX <<< ${toHex(chunk)}`);
    
    const newBuffer = new Uint8Array(this.rxBuffer.length + chunk.length);
    newBuffer.set(this.rxBuffer);
    newBuffer.set(chunk, this.rxBuffer.length);
    this.rxBuffer = newBuffer;
    this.scanForPackets();
  };

  private scanForPackets() {
    const stxIndex = this.rxBuffer.indexOf(0x02);
    if (stxIndex === -1) {
       if (this.rxBuffer.length > 2048) this.rxBuffer = new Uint8Array(0);
       return;
    }

    // Buscamos el ETX (0x03)
    for (let i = stxIndex + 1; i < this.rxBuffer.length; i++) {
        if (this.rxBuffer[i] === 0x03) {
            const candidate = this.rxBuffer.slice(stxIndex, i + 1);
            if (candidate.length >= 4) {
                // El CRC en MicroNIR BLE suele ser del Opcode + Datos
                const payloadForCrc = candidate.slice(1, candidate.length - 2);
                const packetCrc = candidate[candidate.length - 2];
                
                if (calculateCrc8(payloadForCrc) === packetCrc) {
                    this.lastPacket = candidate;
                    this.pendingResponse = false;
                    this.rxBuffer = this.rxBuffer.slice(i + 1);
                    return;
                }
            }
        }
    }
  }

  async send(opcode: number, data: number[] = [], silent = false): Promise<boolean> {
    if (!this.isConnected || !this.txChar) return false;
    if (!silent) { this.lastPacket = null; this.pendingResponse = true; }

    // PROTOCOLO BLE: [STX] [OPCODE] [DATA...] [CRC8] [ETX]
    // Eliminamos el byte de longitud que causaba el NAK 0x15
    const rawPayload = new Uint8Array([opcode, ...data]);
    const crc = calculateCrc8(rawPayload);
    const packet = new Uint8Array([0x02, ...rawPayload, crc, 0x03]);
    
    if (!silent) this.log(`TX >>> Op ${opcode} (${packet.length}B)`);

    try {
      await this.txChar.writeValue(packet);
      return true;
    } catch (e) {
      if (!silent) this.pendingResponse = false;
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
      await this.sleep(50);
    }
    this.pendingResponse = false;
    return null;
  }

  async getTemperature(): Promise<number | null> {
    if (!await this.send(CMD.GET_TEMP, [], true)) return null;
    const resp = await this.waitForPacket(1500);
    // En modo sin LEN, el opcode está en resp[1] y el dato empieza en resp[2]
    if (resp && resp.length >= 5 && resp[1] === 0x06) {
        const view = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
        return view.getUint16(2, false) / 1000.0;
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    this.isBusy = true; 
    const ok = await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
    await this.waitForPacket(1000);
    await this.sleep(on ? 2000 : 500); 
    this.isBusy = false;
    return ok;
  }

  async scan(): Promise<Uint16Array | null> {
    this.isBusy = true;
    this.log("Escaneando...");
    this.rxBuffer = new Uint8Array(0);
    this.lastPacket = null;

    if (!await this.send(CMD.SCAN)) { this.isBusy = false; return null; }
    
    const raw = await this.waitForPacket(12000);
    this.isBusy = false;

    if (!raw || (raw.length > 1 && raw[1] === 0x15)) {
        this.log(raw && raw[1] === 0x15 ? "Error: Sensor Ocupado" : "Error: Sin respuesta");
        return null;
    }

    // Parseo del espectro (128 pixeles * 2 bytes)
    // Estructura: [02] [05] [DATA...] [CRC] [03]
    const s = new Uint16Array(128);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const dataOffset = 2; // El primer byte de datos tras STX y Opcode
    
    try {
        for(let j=0; j<128; j++) {
            const idx = dataOffset + (j*2);
            if (idx + 1 < raw.length) s[j] = view.getUint16(idx, false);
        }
    } catch(err) {
        this.log("Error de datos.");
    }
    return s;
  }
}

export const bleDevice = new MicroNIRBLEDriver();
