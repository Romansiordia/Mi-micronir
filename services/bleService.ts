
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
  
  // En BLE puede haber una char para escribir y MÚLTIPLES para recibir (Indications vs Notifications)
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private listeningChars: BluetoothRemoteGATTCharacteristic[] = [];
  
  private keepAliveInterval: any = null;

  public isConnected = false;
  
  // Buffer para reensamblar paquetes BLE fragmentados
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private lastPacket: Uint8Array | null = null;

  private async sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  constructor() {
    // Intentar limpieza al cerrar ventana
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

      // Limpiar estado previo
      this.listeningChars = [];
      this.rxBuffer = new Uint8Array(0);

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
      console.log("Obteniendo servicio primario...");
      const service = await this.server.getPrimaryService(BLE_CONFIG.serviceUUID);

      // 4. ESTRATEGIA PROMISCUA DE CARACTERÍSTICAS
      // El DLL indica que usa CommandControlPoints y múltiples UUIDs. 
      // En lugar de adivinar, obtenemos TODAS y nos suscribimos a TODAS las que hablen.
      const chars = await service.getCharacteristics();
      console.log(`Encontradas ${chars.length} características en el servicio.`);

      let foundTx = false;

      for (const c of chars) {
        const props = c.properties;
        const uuidShort = c.uuid.slice(4, 8); // Log visual
        
        console.log(`Char [${uuidShort}]: Write=${props.write}, Notify=${props.notify}, Indicate=${props.indicate}`);

        // A. Detección de Canal de Escritura (TX)
        // Preferimos Write sobre WriteWithoutResponse para comandos de control
        if ((props.write || props.writeWithoutResponse) && !foundTx) {
          this.txChar = c;
          foundTx = true;
          console.log(` -> ASIGNADO COMO TX: ${c.uuid}`);
        }

        // B. Detección de Canales de Lectura (RX)
        // Nos suscribimos a TODO lo que pueda enviar datos
        if (props.notify || props.indicate) {
          try {
            await c.startNotifications();
            c.addEventListener('characteristicvaluechanged', this.handleNotifications);
            this.listeningChars.push(c);
            console.log(` -> SUSCRITO A: ${c.uuid} (${props.indicate ? 'Indicate' : 'Notify'})`);
          } catch (e) {
            console.warn(`No se pudo suscribir a ${uuidShort}:`, e);
          }
        }
      }

      if (!this.txChar) {
        throw new Error("No se encontró característica de Escritura (TX)");
      }
      if (this.listeningChars.length === 0) {
        throw new Error("No se encontraron características de Notificación (RX)");
      }

      this.isConnected = true;
      
      // 5. INICIAR KEEP ALIVE
      // El dump menciona "txKeepAliveTimer". Los dispositivos BLE a veces desconectan si no hay actividad.
      // Leemos la temperatura cada 4 segundos en segundo plano.
      this.startKeepAlive();
      
      console.log("Conexión BLE establecida y configurada.");
      return "OK";

    } catch (error: any) {
      console.error("BLE Error Fatal:", error);
      this.isConnected = false;
      // Intentar desconectar limpiamente si falló a medias
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
      return error.message || "Error BLE Desconocido";
    }
  }

  private startKeepAlive() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(() => {
      if (this.isConnected && !this.lastPacket) { // Solo si no estamos esperando otra respuesta
         // Enviar un comando inofensivo (GET_TEMP) silenciando errores
         this.send(CMD.GET_TEMP, [], true).catch(() => {});
      }
    }, 4000);
  }

  private onDisconnected = () => {
    console.log("Dispositivo BLE desconectado evento nativo");
    this.isConnected = false;
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
  };

  private handleNotifications = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;

    const chunk = new Uint8Array(value.buffer);
    // console.log("RX Chunk:", chunk); // Debug a bajo nivel si es necesario
    
    // Concatenar chunk al buffer
    const newBuffer = new Uint8Array(this.rxBuffer.length + chunk.length);
    newBuffer.set(this.rxBuffer);
    newBuffer.set(chunk, this.rxBuffer.length);
    this.rxBuffer = newBuffer;

    // Verificar si tenemos un paquete completo (Termina en ETX 0x03)
    // Nota: El protocolo MicroNIR termina en 0x03.
    if (this.rxBuffer.length > 0 && this.rxBuffer[this.rxBuffer.length - 1] === 0x03) {
      // Guardar como último paquete válido
      this.lastPacket = this.rxBuffer;
      // Limpiar buffer
      this.rxBuffer = new Uint8Array(0);
    }
  };

  async disconnect() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    
    if (this.device && this.device.gatt?.connected) {
      try {
        // Intentar desuscribirse de todo
        for(const c of this.listeningChars) {
           await c.stopNotifications();
        }
      } catch(e) { console.warn("Error parando notificaciones", e); }
      
      this.device.gatt.disconnect();
    }
    this.isConnected = false;
    this.listeningChars = [];
    this.txChar = null;
  }

  async send(opcode: number, data: number[] = [], silent = false): Promise<boolean> {
    if (!this.isConnected || !this.txChar) return false;

    // Si no es un keep-alive, limpiamos el buffer de respuesta anterior
    if (!silent) {
        this.lastPacket = null;
        this.rxBuffer = new Uint8Array(0);
    }

    const len = data.length + 1;
    const rawPayload = new Uint8Array([len, opcode, ...data]);
    const crc = calculateCrc8(rawPayload);

    // [STX, LEN, OPCODE, DATA..., CRC, ETX]
    const packet = new Uint8Array([0x02, ...rawPayload, crc, 0x03]);

    try {
      await this.txChar.writeValue(packet);
      return true;
    } catch (e) {
      if (!silent) console.error("BLE TX Error:", e);
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
    // Reintentos automáticos
    for (let attempt = 0; attempt < 3; attempt++) {
        if (!await this.send(CMD.GET_TEMP)) {
            await this.sleep(200);
            continue;
        }
        
        const resp = await this.waitForPacket(2500);
        
        if (resp && resp.length >= 5) {
          // Buscar Opcode 0x06
          for(let i=0; i<resp.length-2; i++) {
            if (resp[i] === 0x06) {
              const view = new DataView(resp.buffer);
              if (i + 2 < resp.length) {
                const rawTemp = view.getUint16(i+1, false); // Big Endian
                const t = rawTemp / 1000.0;
                // Filtrar lecturas basura (ej. 0 o >100 son improbables en ambiente normal)
                if (t > 0 && t < 100) return t;
              }
            }
          }
        }
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
    // Detener KeepAlive momentáneamente para no ensuciar el buffer durante el scan
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);

    if (!await this.send(CMD.SCAN)) {
        this.startKeepAlive();
        return null;
    }

    // Esperar a que lleguen todos los chunks BLE (Scan es grande, ~288 bytes)
    const raw = await this.waitForPacket(6000); 
    
    // Reiniciar KeepAlive
    this.startKeepAlive();

    if (!raw) return null;

    let spectrum: Uint16Array | null = null;

    // Lógica de parseo robusta (Short vs Long format)
    for(let i=0; i < raw.length - 10; i++) {
      if (raw[i] === 0x02) { 
        if (raw[i+2] === 0x05) { // Short format
          const len = raw[i+1] - 1;
          const dataStart = i + 3;
          if (dataStart + len <= raw.length) {
             spectrum = this.parseSpectrum(raw, dataStart, len/2);
             break;
          }
        }
        else if (raw[i+3] === 0x05) { // Long format
          const len = (raw[i+1] << 8 | raw[i+2]) - 1;
          const dataStart = i + 4;
          if (dataStart + len <= raw.length) {
             spectrum = this.parseSpectrum(raw, dataStart, len/2);
             break;
          }
        }
      }
    }

    // Fallback paquete raw si el header se corrompió pero la longitud cuadra
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
