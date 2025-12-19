
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

const CMD = {
  LAMP_CONTROL: 0x01,
  SCAN: 0x05,
  GET_TEMP: 0x06,
};

export class MicroNIRBLEDriver {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  
  public isConnected = false;
  
  // Buffer para reensamblar paquetes BLE fragmentados
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private lastPacket: Uint8Array | null = null;

  private async sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  async connect(): Promise<string> {
    try {
      if (!navigator.bluetooth) {
        return "Navegador no soporta Web Bluetooth";
      }

      // 1. Buscar Dispositivo
      console.log("Buscando dispositivo MicroNIR BLE...");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: BLE_CONFIG.namePrefix }],
        optionalServices: [BLE_CONFIG.serviceUUID]
      });

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected);

      // 2. Conectar al Servidor GATT
      console.log("Conectando a servidor GATT...");
      this.server = await this.device.gatt!.connect();

      // 3. Obtener Servicio
      const service = await this.server.getPrimaryService(BLE_CONFIG.serviceUUID);

      // 4. CONFIGURACIÓN INTELIGENTE DE UUIDs
      // Obtenemos explícitamente las dos características conocidas (B1 y B2)
      console.log("Configurando canales de comunicación...");
      const char1 = await service.getCharacteristic(BLE_CONFIG.txCharUUID); // Termina en c9b1
      const char2 = await service.getCharacteristic(BLE_CONFIG.rxCharUUID); // Termina en c9b2

      const char1Props = char1.properties;
      const char2Props = char2.properties;

      const char1CanWrite = char1Props.write || char1Props.writeWithoutResponse;
      const char1CanNotify = char1Props.notify || char1Props.indicate;
      
      const char2CanWrite = char2Props.write || char2Props.writeWithoutResponse;
      const char2CanNotify = char2Props.notify || char2Props.indicate;

      console.log(`Char B1 (${char1.uuid.slice(-4)}): Write=${char1CanWrite}, Notify=${char1CanNotify}`);
      console.log(`Char B2 (${char2.uuid.slice(-4)}): Write=${char2CanWrite}, Notify=${char2CanNotify}`);

      // Lógica de decisión:
      if (char1CanWrite && !char1CanNotify && char2CanNotify) {
        // Caso Claro 1: B1 es TX, B2 es RX
        this.txChar = char1;
        this.rxChar = char2;
      } else if (char2CanWrite && !char2CanNotify && char1CanNotify) {
        // Caso Claro 2 (Invertido): B2 es TX, B1 es RX
        this.txChar = char2;
        this.rxChar = char1;
      } else {
        // Caso Ambiguo (ambos pueden hacer todo): Usamos B1 para TX y B2 para RX por defecto
        console.warn("Propiedades ambiguas, usando asignación estándar B1->TX, B2->RX");
        this.txChar = char1;
        this.rxChar = char2;
      }
      
      console.log(`ASIGNADO: TX -> ${this.txChar?.uuid.slice(-4)}, RX -> ${this.rxChar?.uuid.slice(-4)}`);

      // 5. Habilitar Notificaciones (Lectura de datos)
      if (this.rxChar) {
        await this.rxChar.startNotifications();
        this.rxChar.addEventListener('characteristicvaluechanged', this.handleNotifications);
        console.log("Notificaciones habilitadas");
      }

      this.isConnected = true;
      
      // Limpiar buffer por si acaso
      this.rxBuffer = new Uint8Array(0);
      this.lastPacket = null;
      
      // Espera de estabilización
      await this.sleep(300);

      return "OK";
    } catch (error: any) {
      console.error("BLE Error:", error);
      this.isConnected = false;
      return error.message || "Error BLE Desconocido";
    }
  }

  private onDisconnected = () => {
    console.log("Dispositivo BLE desconectado");
    this.isConnected = false;
  };

  private handleNotifications = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;

    const chunk = new Uint8Array(value.buffer);
    
    // Concatenar chunk al buffer
    const newBuffer = new Uint8Array(this.rxBuffer.length + chunk.length);
    newBuffer.set(this.rxBuffer);
    newBuffer.set(chunk, this.rxBuffer.length);
    this.rxBuffer = newBuffer;

    // Verificar si tenemos un paquete completo (Termina en ETX 0x03)
    if (this.rxBuffer.length > 0 && this.rxBuffer[this.rxBuffer.length - 1] === 0x03) {
      // Guardar como último paquete válido y limpiar buffer para el siguiente
      this.lastPacket = this.rxBuffer;
      this.rxBuffer = new Uint8Array(0);
    }
  };

  async disconnect() {
    if (this.device && this.device.gatt?.connected) {
      try {
        if (this.rxChar) await this.rxChar.stopNotifications();
      } catch(e) {}
      this.device.gatt.disconnect();
    }
    this.isConnected = false;
  }

  async send(opcode: number, data: number[] = []): Promise<boolean> {
    if (!this.isConnected || !this.txChar) return false;

    // Limpiar paquete anterior recibido para asegurar que la respuesta corresponde a este comando
    this.lastPacket = null;
    this.rxBuffer = new Uint8Array(0);

    const len = data.length + 1;
    const rawPayload = new Uint8Array([len, opcode, ...data]);
    const crc = calculateCrc8(rawPayload);

    // [STX, LEN, OPCODE, DATA..., CRC, ETX]
    const packet = new Uint8Array([0x02, ...rawPayload, crc, 0x03]);

    try {
      await this.txChar.writeValue(packet);
      return true;
    } catch (e) {
      console.error("BLE TX Error:", e);
      return false;
    }
  }

  // Espera a que llegue un paquete completo vía Notificaciones
  private async waitForPacket(timeoutMs: number): Promise<Uint8Array | null> {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
      if (this.lastPacket) {
        const pkt = this.lastPacket;
        this.lastPacket = null; // Consumir
        return pkt;
      }
      await this.sleep(10);
    }
    return null;
  }

  async getTemperature(): Promise<number | null> {
    // Reintentos automáticos para robustez en la conexión inicial
    for (let attempt = 0; attempt < 3; attempt++) {
        if (!await this.send(CMD.GET_TEMP)) {
            await this.sleep(200);
            continue;
        }
        
        // Esperar respuesta (puede venir en varios chunks BLE, aunque temp es corta)
        const resp = await this.waitForPacket(2000); // Timeout generoso
        
        if (resp && resp.length >= 5) {
          // Buscar Opcode 0x06
          for(let i=0; i<resp.length-2; i++) {
            if (resp[i] === 0x06) {
              const view = new DataView(resp.buffer);
              if (i + 2 < resp.length) {
                const rawTemp = view.getUint16(i+1, false); // Big Endian
                return rawTemp / 1000.0;
              }
            }
          }
        }
        
        // Si falló, esperar antes de reintentar
        console.warn(`Intento ${attempt + 1} de leer temperatura fallido, reintentando...`);
        await this.sleep(300);
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

    // Esperar a que lleguen todos los chunks BLE y se reensamble el paquete
    const raw = await this.waitForPacket(5000); // Aumentado timeout para scan BLE
    
    if (!raw) return null;

    let spectrum: Uint16Array | null = null;

    // Lógica de parseo idéntica al USB
    for(let i=0; i < raw.length - 10; i++) {
      if (raw[i] === 0x02) { 
        if (raw[i+2] === 0x05) { // Short
          const len = raw[i+1] - 1;
          const dataStart = i + 3;
          if (dataStart + len <= raw.length) {
             spectrum = this.parseSpectrum(raw, dataStart, len/2);
             break;
          }
        }
        else if (raw[i+3] === 0x05) { // Long
          const len = (raw[i+1] << 8 | raw[i+2]) - 1;
          const dataStart = i + 4;
          if (dataStart + len <= raw.length) {
             spectrum = this.parseSpectrum(raw, dataStart, len/2);
             break;
          }
        }
      }
    }

    // Fallback paquete raw
    if (!spectrum && raw.length >= 256) {
       spectrum = this.parseSpectrum(raw, 0, 128);
    }

    return spectrum;
  }

  private parseSpectrum(buffer: Uint8Array, offset: number, pixels: number): Uint16Array {
    const s = new Uint16Array(pixels);
    const view = new DataView(buffer.buffer);
    for(let j=0; j<pixels; j++) {
      if (offset + (j*2) + 1 < buffer.length) {
        s[j] = view.getUint16(offset + (j*2), false); 
      }
    }
    return s;
  }
}

export const bleDevice = new MicroNIRBLEDriver();
