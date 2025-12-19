
import { USB_CONFIG } from "../constants";

// Comandos Hexadecimales del Protocolo VIAVI MicroNIR
const CMD = {
  LAMP_CONTROL: 0x01,
  SET_INTEGRATION: 0x02,
  GET_INFO: 0x03,
  SCAN: 0x05,
  GET_TEMP: 0x06,
  RESET: 0x0F
};

// Tabla CRC8 Oficial para validación de tramas
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

/**
 * Driver de bajo nivel para chips FTDI en navegador.
 * Elimina los 2 bytes de "Modem Status" que el chip inserta cada 64 bytes.
 */
function stripFtdiHeaders(raw: Uint8Array): Uint8Array {
  const PACKET_SIZE = 64;
  const HEADER_SIZE = 2;
  
  // Calcular tamaño final
  let validBytes = 0;
  for (let i = 0; i < raw.length; i += PACKET_SIZE) {
    const chunk = Math.min(PACKET_SIZE, raw.length - i);
    if (chunk > HEADER_SIZE) validBytes += (chunk - HEADER_SIZE);
  }

  const clean = new Uint8Array(validBytes);
  let writePtr = 0;
  
  for (let i = 0; i < raw.length; i += PACKET_SIZE) {
    const chunk = Math.min(PACKET_SIZE, raw.length - i);
    if (chunk > HEADER_SIZE) {
      // Copiar datos saltando los primeros 2 bytes
      clean.set(raw.slice(i + HEADER_SIZE, i + chunk), writePtr);
      writePtr += (chunk - HEADER_SIZE);
    }
  }
  return clean;
}

export class MicroNIRDriver {
  private device: any | null = null;
  private interfaceNumber = 0;
  private inEndpoint = 2;
  private outEndpoint = 1;
  
  public isConnected = false;

  private async sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Conexión Hardware Estricta.
   * Configura el chip FTDI con los parámetros exactos para equipos OnSite-W.
   */
  async connect(): Promise<string> {
    try {
      this.device = await (navigator as any).usb.requestDevice({
        filters: [{ vendorId: USB_CONFIG.vendorId }] // FTDI
      });

      await this.device.open();
      if (this.device.configuration === null) await this.device.selectConfiguration(1);
      
      try { await this.device.claimInterface(this.interfaceNumber); } catch(e) { console.warn("Interface busy/claimed"); }

      // --- SECUENCIA DE INICIALIZACIÓN FTDI (CRÍTICO) ---
      
      // 1. Resetear el chip
      await this.ctrl(0x00, 0x00, 0x00); 

      // 2. Configurar Baud Rate 115200 (Magic Number 0x401A para FT232R)
      await this.ctrl(0x03, 0x401A, 0x00);

      // 3. Configurar Formato Datos: 8 bits, 1 Stop bit, No Parity
      await this.ctrl(0x04, 0x0008, 0x00);

      // 4. Configurar Latency Timer a 1ms (Para evitar buffers retenidos)
      await this.ctrl(0x09, 0x0001, 0x00);

      // 5. ACTIVAR ENERGÍA (DTR High + RTS High)
      // High Byte = Mask (03), Low Byte = Value (03) => 0x0303
      // Esto "despierta" al microcontrolador del MicroNIR.
      await this.ctrl(0x01, 0x0303, 0x00);

      // 6. Desactivar Flow Control (Para evitar bloqueos si el buffer se llena)
      await this.ctrl(0x02, 0x0000, 0x00);

      this.isConnected = true;
      
      // Limpieza inicial de tuberías
      await this.purgeRx();
      
      return "OK";
    } catch (error: any) {
      this.isConnected = false;
      console.error("Connection Failed:", error);
      return error.message || "USB Error";
    }
  }

  // Helper para Control Transfers
  private async ctrl(req: number, val: number, idx: number) {
    return this.device.controlTransferOut({
      requestType: 'vendor', recipient: 'device', request: req, value: val, index: idx
    });
  }

  /**
   * Vacía el buffer de lectura del hardware.
   * Se usa antes de enviar comandos para asegurar que la respuesta
   * que leamos corresponda a lo que acabamos de pedir.
   */
  async purgeRx() {
    if (!this.isConnected) return;
    try {
      // Leer agresivamente hasta que devuelva paquetes vacíos (solo headers)
      for(let i=0; i<10; i++) {
        const res = await this.device.transferIn(this.inEndpoint, 64);
        if (res.data.byteLength <= 2) break; // Solo headers FTDI (status)
      }
    } catch(e) { /* Ignore timeouts during purge */ }
  }

  /**
   * Envía un comando formateado con protocolo STX/ETX/CRC
   */
  async send(opcode: number, data: number[] = []): Promise<boolean> {
    if (!this.isConnected) return false;

    // Purga preventiva
    await this.purgeRx();

    const len = data.length + 1; // Data + Opcode
    const rawPayload = new Uint8Array([len, opcode, ...data]);
    const crc = calculateCrc8(rawPayload);

    // Estructura: STX (02) | LEN | OPCODE | DATA... | CRC | ETX (03)
    const packet = new Uint8Array([0x02, ...rawPayload, crc, 0x03]);

    try {
      const res = await this.device.transferOut(this.outEndpoint, packet);
      return res.status === 'ok';
    } catch (e) {
      console.error("Write Error:", e);
      return false;
    }
  }

  /**
   * Lee la temperatura. Útil como "Ping" para verificar vida del sensor.
   */
  async getTemperature(): Promise<number | null> {
    if (!await this.send(CMD.GET_TEMP)) return null;
    
    // Esperar respuesta (temperatura es rápida)
    await this.sleep(50);

    const raw = await this.readRawBytes(100, 64); // Leer max 100ms
    if (!raw) return null;

    // Buscar paquete [02, LEN, 06, ... ]
    for(let i=0; i < raw.length - 4; i++) {
      if (raw[i] === 0x02 && raw[i+2] === 0x06) {
        const view = new DataView(raw.buffer);
        // Temperatura suele estar en bytes 3 y 4
        const tempRaw = view.getUint16(i+3, false); // Big Endian
        return tempRaw / 1000.0; // O /100.0 dependiendo del firmware
      }
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    const ok = await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
    if (ok) {
      // La lámpara necesita tiempo físico para estabilizar su corriente
      await this.sleep(on ? 1000 : 200);
    }
    return ok;
  }

  /**
   * Captura Espectral Robusta.
   * 1. Envía comando SCAN.
   * 2. Entra en bucle de lectura acumulativa.
   * 3. Reensambla chunks y busca header 0x05.
   */
  async scan(): Promise<Uint16Array | null> {
    if (!await this.send(CMD.SCAN)) return null;

    // Tiempo de integración hardware
    await this.sleep(100); 

    // Leer hasta 2 segundos esperando datos
    // Un espectro típico son ~300 bytes, pero FTDI fragmenta.
    const raw = await this.readRawBytes(2000, 1024); 

    if (!raw) {
      console.error("Scan Timeout: Sensor did not send data.");
      return null;
    }

    // Buscar cabecera de espectro (Opcode 0x05)
    for(let i=0; i < raw.length - 10; i++) {
      if (raw[i] === 0x02) { // STX
        let len = 0;
        let dataIdx = 0;

        // Formato Corto: [02, LEN, 05, ...]
        if (raw[i+2] === 0x05) {
          len = raw[i+1] - 1; // Restar opcode
          dataIdx = i + 3;
        }
        // Formato Largo/Extendido: [02, LEN_HI, LEN_LO, 05, ...]
        else if (raw[i+3] === 0x05) {
          len = (raw[i+1] << 8 | raw[i+2]) - 1;
          dataIdx = i + 4;
        }

        // Si encontramos una trama válida con suficientes datos
        if (len > 0 && (dataIdx + len) <= raw.length) {
          // MicroNIR 1700 tiene 128 pixeles (256 bytes)
          const pixelCount = len / 2;
          const spectrum = new Uint16Array(pixelCount);
          const view = new DataView(raw.buffer);
          
          for(let p=0; p < pixelCount; p++) {
            spectrum[p] = view.getUint16(dataIdx + (p*2), false); // Big Endian
          }
          return spectrum;
        }
      }
    }
    
    console.error("Invalid Spectrum Packet Frame");
    return null;
  }

  /**
   * Lee bytes crudos del USB durante un tiempo determinado,
   * acumulando fragmentos y limpiando headers FTDI.
   */
  private async readRawBytes(timeoutMs: number, bufferSize: number): Promise<Uint8Array | null> {
    const startTime = Date.now();
    let accumulated = new Uint8Array(0);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await this.device.transferIn(this.inEndpoint, bufferSize);
        if (res.status === 'ok' && res.data.byteLength > 2) {
          const rawChunk = new Uint8Array(res.data.buffer);
          const cleanChunk = stripFtdiHeaders(rawChunk); // Quitar basura FTDI
          
          if (cleanChunk.length > 0) {
            const next = new Uint8Array(accumulated.length + cleanChunk.length);
            next.set(accumulated);
            next.set(cleanChunk, accumulated.length);
            accumulated = next;
          }
        }
        // Verificar si ya tenemos el byte de cierre ETX (0x03) al final
        if (accumulated.length > 10 && accumulated[accumulated.length-1] === 0x03) {
           return accumulated;
        }
      } catch (e) {
        // Ignorar errores transitorios (Stall)
        await this.sleep(10);
      }
    }
    
    return accumulated.length > 0 ? accumulated : null;
  }
}

export const device = new MicroNIRDriver();
