
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
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
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
  SET_CONFIG: 0x02, 
  GET_INFO: 0x03, 
  SCAN: 0x05,
  GET_TEMP: 0x06,
  RESET: 0x0F
};

export class MicroNIRBLEDriver {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  
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

      this.log("Iniciando 'Impressa Approach' (M1-0000343)...");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: BLE_CONFIG.namePrefix }],
        optionalServices: [BLE_CONFIG.serviceUUID]
      });

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
      
      this.log("Conectando GATT...");
      this.server = await this.device.gatt!.connect();
      
      this.log("Estabilizando (3s)...");
      await this.sleep(3000); 

      const service = await this.server.getPrimaryService(BLE_CONFIG.serviceUUID);
      this.txChar = await service.getCharacteristic(BLE_CONFIG.txCharUUID);
      this.rxChar = await service.getCharacteristic(BLE_CONFIG.rxCharUUID);

      this.log("Habilitando notificaciones...");
      await this.rxChar.startNotifications();
      this.rxChar.addEventListener('characteristicvaluechanged', this.handleNotifications);

      this.isConnected = true;
      
      // Esperar un momento antes de la configuración inicial
      await this.sleep(1000);
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
    this.log("Sincronizando con MicroNIR 1700...");

    // Limpiar buffers
    await this.send(CMD.GET_INFO, [], true);
    await this.sleep(1000);

    const scanCount = 500; 
    const integrationTime = 12500; 

    // Payload A: Big Endian (Estándar 8 bytes)
    const payloadBE = [
        (scanCount >> 24) & 0xFF, (scanCount >> 16) & 0xFF, (scanCount >> 8) & 0xFF, scanCount & 0xFF,
        (integrationTime >> 24) & 0xFF, (integrationTime >> 16) & 0xFF, (integrationTime >> 8) & 0xFF, integrationTime & 0xFF
    ];

    // Payload B: Little Endian (Frecuente en hardware industrial/OnSite-W)
    const payloadLE = [
        scanCount & 0xFF, (scanCount >> 8) & 0xFF, (scanCount >> 16) & 0xFF, (scanCount >> 24) & 0xFF,
        integrationTime & 0xFF, (integrationTime >> 8) & 0xFF, (integrationTime >> 16) & 0xFF, (integrationTime >> 24) & 0xFF
    ];

    // Payload C: 12 bytes (4 count + 4 time + 4 padding) - Evita MTU issues de 16 bytes
    const payload12 = [...payloadBE, 0, 0, 0, 0];

    let configured = false;
    
    // Intento 1: Little Endian (Muchos sensores OnSite-W usan LE internamente)
    this.log("Intento 1: Little Endian (8 bytes)...");
    if (await this.send(CMD.SET_CONFIG, payloadLE)) {
        const ack = await this.waitForPacket(2500);
        if (ack && ack[2] !== 0x15) {
            configured = true;
        } else {
            this.log("NAK 0x15 con LE. Probando Big Endian...");
        }
    }

    // Intento 2: Big Endian
    if (!configured) {
        await this.sleep(1000);
        this.log("Intento 2: Big Endian (8 bytes)...");
        if (await this.send(CMD.SET_CONFIG, payloadBE)) {
            const ack = await this.waitForPacket(2500);
            if (ack && ack[2] !== 0x15) {
                configured = true;
            } else {
                this.log("NAK 0x15 con BE. Probando 12-byte payload...");
            }
        }
    }

    // Intento 3: Payload de 12 bytes (algunos firmwares requieren padding específico pero < 16b para GATT)
    if (!configured) {
        await this.sleep(1000);
        this.log("Intento 3: Formato extendido (12 bytes)...");
        if (await this.send(CMD.SET_CONFIG, payload12)) {
            const ack = await this.waitForPacket(2500);
            if (ack && ack[2] !== 0x15) {
                configured = true;
            }
        }
    }
    
    if (!configured) {
        this.log("Error crítico: El sensor denegó la configuración.");
        throw new Error("NAK Config persistente");
    }

    this.log("MicroNIR 1700 (M1-0000343) Listo.");
    this.isBusy = false;
  }

  async disconnect(): Promise<void> {
    if (this.server && this.server.connected) {
        if (this.rxChar) {
            try { await this.rxChar.stopNotifications(); } catch(e){}
        }
        this.server.disconnect();
    }
    this.disconnectCleanly();
  }

  private startKeepAlive() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(() => {
      if (this.isConnected && !this.pendingResponse && !this.isBusy) { 
         this.getTemperature().catch(() => {});
      }
    }, 15000); 
  }

  private disconnectCleanly() {
    this.isConnected = false;
    this.isBusy = false;
    this.pendingResponse = false;
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.rxBuffer = new Uint8Array(0);
    this.txChar = null;
    this.rxChar = null;
  }

  private onDisconnected = () => {
    this.log("Dispositivo desconectado.");
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
    let stxIndex = this.rxBuffer.indexOf(0x02);
    if (stxIndex === -1) {
       if (this.rxBuffer.length > 8192) this.rxBuffer = new Uint8Array(0);
       return;
    }

    for (let i = stxIndex + 1; i < this.rxBuffer.length; i++) {
        if (this.rxBuffer[i] === 0x03) {
            const candidate = this.rxBuffer.slice(stxIndex, i + 1);
            if (candidate.length >= 5) {
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

    const len = data.length + 1;
    const rawPayload = new Uint8Array([len, opcode, ...data]);
    const crc = calculateCrc8(rawPayload);
    const packet = new Uint8Array([0x02, ...rawPayload, crc, 0x03]);
    
    if (!silent) this.log(`TX >>> OP ${opcode.toString(16).toUpperCase()} (${packet.length} bytes: ${toHex(packet)})`);

    try {
      // Uso de writeValue() estándar con reintento ante fallos de buffer
      await this.txChar.writeValue(packet);
      return true;
    } catch (e: any) {
      if (!silent) {
          this.log(`Error GATT: ${e.message}. Reintentando sin respuesta...`);
          try {
              // Algunos dispositivos fallan en 'writeValue' si el stack está saturado
              if (this.txChar.writeValueWithoutResponse) {
                  await this.txChar.writeValueWithoutResponse(packet);
                  return true;
              }
          } catch(e2) {}
          this.pendingResponse = false;
      }
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
    const resp = await this.waitForPacket(2000);
    if (resp && resp.length >= 6 && resp[2] === 0x06) {
        const view = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
        return view.getUint16(3, false) / 1000.0;
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    this.isBusy = true; 
    const ok = await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
    await this.waitForPacket(3000);
    if (on) {
        this.log("Calentando lámpara (5s)...");
        await this.sleep(5000); 
    }
    this.isBusy = false;
    return ok;
  }

  async resetHardware(): Promise<boolean> {
      this.isBusy = true;
      const ok = await this.send(CMD.RESET);
      await this.sleep(4000);
      this.isBusy = false;
      return ok;
  }

  async scan(): Promise<Uint16Array | null> {
    this.isBusy = true;
    this.log("Capturando espectro (500 promedios)...");
    this.rxBuffer = new Uint8Array(0);
    this.lastPacket = null;

    if (!await this.send(CMD.SCAN)) { this.isBusy = false; return null; }
    
    // Con 500 scans a 12.5ms, el hardware tarda 6.25s. Damos margen de 15s.
    const raw = await this.waitForPacket(15000); 
    this.isBusy = false;

    if (!raw) {
        this.log("Error: Timeout en lectura de espectro.");
        return null;
    }

    if (raw[2] === 0x15) {
        this.log("Error: Escaneo rechazado por el sensor (NAK).");
        return null;
    }

    let dataOffset = 3; 
    if (raw[1] > 0x80) dataOffset = 4;
    else if (raw[2] === 0x05) dataOffset = 3;

    const s = new Uint16Array(128);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    try {
        for(let j=0; j<128; j++) {
            const idx = dataOffset + (j*2);
            if (idx + 1 < raw.length) s[j] = view.getUint16(idx, false);
        }
    } catch(err) {
        this.log("Error parseando espectro.");
    }
    return s;
  }
}

export const bleDevice = new MicroNIRBLEDriver();
