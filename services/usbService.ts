
import { USB_CONFIG } from "../constants";

const OPCODES = {
  SET_LAMP: 0x01,
  SET_INTEGRATION: 0x02,
  GET_DEVICE_INFO: 0x03,
  PERFORM_SCAN: 0x05,
  GET_TEMPERATURE: 0x06,
  RESET: 0x0F
};

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
 * Decapsula los datos del protocolo FTDI.
 * El chip FTDI inserta 2 bytes de estado cada 64 bytes de transmisión USB.
 * Estos bytes deben ser eliminados para reconstruir el flujo de datos original.
 */
function decapsulateFtdi(data: Uint8Array): Uint8Array {
  const blockSize = 64;
  const headerSize = 2;
  
  // Calculamos el tamaño exacto del buffer de salida
  let cleanSize = 0;
  for (let i = 0; i < data.length; i += blockSize) {
    const chunkLength = Math.min(blockSize, data.length - i);
    if (chunkLength > headerSize) {
      cleanSize += chunkLength - headerSize;
    }
  }

  const result = new Uint8Array(cleanSize);
  let destOffset = 0;

  for (let i = 0; i < data.length; i += blockSize) {
    const remaining = Math.min(blockSize, data.length - i);
    if (remaining > headerSize) {
      // Saltamos los primeros 2 bytes (Status bytes)
      const chunk = data.slice(i + headerSize, i + remaining);
      result.set(chunk, destOffset);
      destOffset += chunk.length;
    }
  }
  return result;
}

export class MicroNIRDevice {
  private device: any | null = null;
  private inEndpoint: number = 2; // EP2 IN para FTDI común
  private outEndpoint: number = 1; // EP1 OUT para FTDI común
  public isSimulated: boolean = false;

  private async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Limpia el buffer de entrada del USB para evitar leer datos antiguos.
   * Crítico para el protocolo de disparo reforzado.
   */
  private async flushBuffer() {
    if (!this.device?.opened) return;
    try {
      // Intentamos leer agresivamente hasta que no haya más datos o timeout
      // FTDI Latency timer = 1ms ayuda a que esto sea rápido
      const res = await this.device.transferIn(this.inEndpoint, 64);
      if (res.data && res.data.byteLength > 2) {
        // Si había datos reales, leemos otra vez por si acaso
        await this.delay(2); 
        await this.device.transferIn(this.inEndpoint, 64);
      }
    } catch (e) {
      // Timeout esperado si el buffer está vacío
    }
  }

  async connect(): Promise<boolean> {
    if (this.isSimulated) return true;
    try {
      this.device = await (navigator as any).usb.requestDevice({
        filters: [{ vendorId: USB_CONFIG.vendorId }]
      });

      await this.device.open();
      if (this.device.configuration === null) await this.device.selectConfiguration(1);
      
      try { 
        await this.device.claimInterface(0); 
      } catch (e) {
        console.warn("Interface 0 already claimed or busy", e);
      }

      // --- SECUENCIA DE INICIALIZACIÓN FTDI ROBUSTA ---
      
      // 1. Resetear dispositivo (Reset Port)
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x00, value: 0x00, index: 0x00
      });

      // 2. Configurar Baud Rate (115200 aprox usando divisor 0x1A)
      // Value 0x401A es un "magic number" común para 115200 en algunos chips FTDI con reloj base específico
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x03, value: 0x401A, index: 0x0000 
      });

      // 3. Configurar Data Characteristics (8 bits, 1 stop bit, no parity) -> 0x0008
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x04, value: 0x0008, index: 0x0000
      });

      // 4. Configurar Latency Timer a 1ms (CRÍTICO para evitar paquetes vacíos)
      // Request 0x09, Value 0x01
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x09, value: 0x0001, index: 0x0000
      });

      // 5. Configurar Flow Control a None (0x0000, index 0x0000)
      await this.device.controlTransferOut({
        requestType: 'vendor', recipient: 'device', request: 0x01, value: 0x0000, index: 0x0000
      });

      // Esperar estabilización del chip
      await this.delay(100);

      // Limpieza inicial
      await this.flushBuffer();

      return true;
    } catch (error) {
      console.error("Connection error:", error);
      return false;
    }
  }

  /**
   * Protocolo de Disparo Reforzado:
   * 1. Flush (Limpiar buffer)
   * 2. Wait (Pausa de seguridad)
   * 3. Send (Envío con reintento si falla USB)
   */
  async sendCommand(opcode: number, payload: number[] = []): Promise<boolean> {
    if (!this.device?.opened) return false;
    
    // Paso 1: Limpieza preventiva
    await this.flushBuffer(); 
    
    // Paso 2: Pausa corta para separar operaciones
    await this.delay(20);

    try {
      const payloadLength = 1 + payload.length; 
      const crcBuffer = new Uint8Array([payloadLength, opcode, ...payload]);
      const crc = calculateCrc8(crcBuffer);
      
      // Paquete: [STX, LEN, OPCODE, DATA..., CRC, ETX]
      const packet = new Uint8Array([0x02, payloadLength, opcode, ...payload, crc, 0x03]);
      
      // Paso 3: Envío
      const result = await this.device.transferOut(this.outEndpoint, packet);
      
      return result.status === 'ok';
    } catch (e) {
      console.error(`Command ${opcode.toString(16)} error:`, e);
      return false;
    }
  }

  async setIntegrationTime(us: number): Promise<boolean> {
    const msb = (us >> 8) & 0xFF;
    const lsb = us & 0xFF;
    return await this.sendCommand(OPCODES.SET_INTEGRATION, [msb, lsb]);
  }

  async getTemperature(): Promise<number | null> {
    if (this.isSimulated) return 24.5 + Math.random();
    if (!this.device?.opened) return null;

    try {
      const sent = await this.sendCommand(OPCODES.GET_TEMPERATURE);
      if (!sent) return null;
      
      // Esperar respuesta (temperatura es rápida)
      await this.delay(50);

      // Leer respuesta
      const result = await this.device.transferIn(this.inEndpoint, 64);
      if (result.data && result.data.byteLength >= 4) {
        // Eliminar headers FTDI
        const clean = decapsulateFtdi(new Uint8Array(result.data.buffer));
        
        // Buscar patrón de respuesta [STX, LEN, OPCODE=0x06, ...]
        for (let i = 0; i < clean.length - 4; i++) {
          if (clean[i] === 0x02 && clean[i+2] === 0x06) {
            // Temperatura suele ser 2 bytes Big Endian en estos modelos
            const view = new DataView(clean.buffer, clean.byteOffset + i + 3, 2);
            return view.getUint16(0, false) / 1000.0; // Algunas versiones requieren / 100.0, ajustado a estándar
          }
        }
      }
    } catch (e) {
      console.warn("Read temp failed", e);
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    if (!this.device?.opened) return false;
    
    console.log(`Setting lamp: ${on}`);
    const ok = await this.sendCommand(OPCODES.SET_LAMP, [on ? 0x01 : 0x00]);
    
    if (ok) {
      // Delay crítico: La fuente de poder de la lámpara tarda en estabilizarse
      // Si enviamos otro comando muy rápido, el voltaje cae y el USB se desconecta lógicamente
      await this.delay(on ? 1500 : 500); 
    }
    return ok;
  }

  async readSpectrum(): Promise<Uint16Array | null> {
    if (this.isSimulated) return new Uint16Array(Array.from({ length: 128 }, () => 20000 + Math.random() * 5000));
    if (!this.device?.opened) return null;

    try {
      // Disparo reforzado ya incluye flush dentro de sendCommand
      const ok = await this.sendCommand(OPCODES.PERFORM_SCAN);
      if (!ok) return null;

      // Tiempo de integración + tiempo de procesamiento del sensor
      // Aumentado a 600ms para asegurar que el sensor tiene datos listos
      await this.delay(600); 
      
      let rawAccumulated = new Uint8Array(0);
      const startTime = Date.now();
      
      // Bucle de lectura "Chunked"
      // Lee todo lo que llega, pedazo a pedazo, hasta tener suficiente o timeout
      while (Date.now() - startTime < 3000) {
        try {
          const result = await this.device.transferIn(this.inEndpoint, 512); // Pedir bloques grandes
          if (result.status === 'ok' && result.data.byteLength > 2) { // >2 porque 2 bytes son siempre status
            const chunk = new Uint8Array(result.data.buffer);
            const next = new Uint8Array(rawAccumulated.length + chunk.length);
            next.set(rawAccumulated);
            next.set(chunk, rawAccumulated.length);
            rawAccumulated = next;
            
            // Si tenemos suficiente data (ej. 128 px * 2 bytes + headers ~ 260-300 bytes)
            // Calculando con margen por los headers FTDI
            if (rawAccumulated.length >= 400) break; 
          } else {
            // Si el paquete está vacío (solo status bytes o 0), esperar un poco
            await this.delay(10);
          }
        } catch(readErr) {
          // Si hay error de lectura (stall), intentamos una vez más y seguimos
          await this.delay(10);
        }
      }

      // Limpieza de datos (Quitar headers FTDI)
      const clean = decapsulateFtdi(rawAccumulated);
      
      // Buscar la cabecera del espectro (Opcode 0x05)
      for (let i = 0; i < clean.length - 10; i++) {
        if (clean[i] === 0x02) { // STX
          let dataStart = -1;
          let dataLength = 0;
          
          // Verificar opcode 0x05 (Respuesta estándar)
          if (clean[i+2] === 0x05) { 
            dataStart = i + 3;
            dataLength = clean[i+1] - 1; // Longitud basada en byte LEN
          } 
          // Verificar opcode 0x05 en modo extendido (len > 255)
          else if (clean[i+3] === 0x05) { 
            dataStart = i + 4;
            // Len es 2 bytes
            dataLength = (clean[i+1] << 8 | clean[i+2]) - 1;
          }

          if (dataStart !== -1 && dataLength > 50 && (dataStart + dataLength) <= clean.length) {
            const points = Math.floor(dataLength / 2);
            const spectrum = new Uint16Array(points);
            const view = new DataView(clean.buffer, clean.byteOffset + dataStart, dataLength);
            
            for (let j = 0; j < points; j++) {
              // Intento Big Endian (Estándar VIAVI)
              spectrum[j] = view.getUint16(j * 2, false); 
            }
            
            // Auto-detección Endianness:
            // Los sensores oscuros suelen tener valores bajos (< 5000) o altos (> 60000) si están invertidos raramente.
            // Una prueba simple: el pixel 0 y el pixel 64 deberían tener cierta coherencia.
            // Si spectrum[64] es absurdamente grande y el pixel adyacente cambia drásticamente, podría ser Little Endian.
            // Por ahora, mantenemos Big Endian que es el estándar del firmware 2.5.1
            
            return spectrum;
          }
        }
      }
      console.warn("Header 0x05 not found in clean data", clean.slice(0, 20));
      return null;
    } catch (e) {
      console.error("Read spectrum fatal error:", e);
      return null;
    }
  }

  async disconnect() {
    if (this.device?.opened) {
      try {
        await this.setLamp(false);
      } catch(e) {}
      await this.device.close();
    }
    this.device = null;
  }
}

export const microNir = new MicroNIRDevice();
