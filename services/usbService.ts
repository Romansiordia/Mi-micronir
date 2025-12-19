
import { USB_CONFIG } from "../constants";

// Comandos del Protocolo MicroNIR
const CMD = {
  LAMP_CONTROL: 0x01,
  SET_INTEGRATION: 0x02,
  GET_INFO: 0x03,
  SCAN: 0x05,
  GET_TEMP: 0x06,
  RESET: 0x0F
};

// Tabla CRC8
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

export class MicroNIRDriver {
  private device: any | null = null;
  private interfaceNumber = 0;
  private inEndpoint = 2;
  private outEndpoint = 1;
  public isConnected = false;

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
      this.device = await (navigator as any).usb.requestDevice({
        filters: [{ vendorId: USB_CONFIG.vendorId }]
      });

      await this.device.open();
      if (this.device.configuration === null) await this.device.selectConfiguration(1);
      
      try { await this.device.claimInterface(this.interfaceNumber); } 
      catch(e) { console.warn("Interface claimed/busy", e); }

      // --- SECUENCIA DE INICIALIZACIÓN ROBUSTA (POWER CYCLE) ---
      
      // 1. Reset
      await this.ctrl(0x00, 0x00, 0x00);
      
      // 2. Baud Rate 115200
      await this.ctrl(0x03, 0x401A, 0x00);

      // 3. Data Format 8N1
      await this.ctrl(0x04, 0x0008, 0x00);

      // 4. Latency Timer 1ms (Para respuesta rápida)
      await this.ctrl(0x09, 0x0001, 0x00);

      // 5. Flow Control OFF
      await this.ctrl(0x02, 0x0000, 0x00);

      // 6. POWER CYCLE: APAGAR DTR/RTS PRIMERO
      // Esto asegura que si el dispositivo estaba en un estado extraño, se reinicie
      await this.ctrl(0x01, 0x0000, 0x00); 
      await this.sleep(50); 

      // 7. ENCENDER DTR/RTS
      // Value: 0x0303 (Mask=03, Val=03)
      await this.ctrl(0x01, 0x0303, 0x00);

      this.isConnected = true;
      
      // Tiempo crítico para que el MCU del MicroNIR arranque después del Power Up
      await this.sleep(300);

      await this.flushRx();
      
      return "OK";
    } catch (error: any) {
      this.isConnected = false;
      return error.message || "Error USB Desconocido";
    }
  }

  async disconnect() {
    if (this.device && this.device.opened) {
      try { await this.setLamp(false); } catch(e) {}
      await this.device.close();
    }
    this.isConnected = false;
  }

  private async flushRx() {
    if (!this.isConnected) return;
    try {
      for(let i=0; i<5; i++) {
        const res = await this.device.transferIn(this.inEndpoint, 64);
        if (!res.data || res.data.byteLength <= 2) break;
      }
    } catch(e) {}
  }

  async send(opcode: number, data: number[] = []): Promise<boolean> {
    if (!this.isConnected) return false;

    // Flush suave antes de enviar para evitar leer respuestas viejas
    await this.flushRx();

    const len = data.length + 1;
    const rawPayload = new Uint8Array([len, opcode, ...data]);
    const crc = calculateCrc8(rawPayload);

    // [STX, LEN, OPCODE, DATA..., CRC, ETX]
    const packet = new Uint8Array([0x02, ...rawPayload, crc, 0x03]);

    try {
      const res = await this.device.transferOut(this.outEndpoint, packet);
      return res.status === 'ok';
    } catch (e) {
      console.error("TX Error:", e);
      return false;
    }
  }

  async getTemperature(): Promise<number | null> {
    // Intentar hasta 3 veces porque el primer paquete después de conectar suele fallar
    for(let attempt=0; attempt<3; attempt++) {
      if (await this.send(CMD.GET_TEMP)) {
        await this.sleep(30); // Espera breve
        
        // Esperamos respuesta (paquete corto)
        const resp = await this.readPacket(200);
        
        // Validar respuesta de temperatura [STX, LEN, 06, MSB, LSB, CRC, ETX]
        if (resp && resp.length >= 5) {
           // Verificar Opcode (byte 2 en formato estándar)
           const opcodeIdx = 2; // Suponiendo frame [02, LEN, CMD...]
           if (resp[opcodeIdx] === 0x06) {
             const view = new DataView(resp.buffer);
             const rawTemp = view.getUint16(opcodeIdx + 1, false); // Bytes siguientes al opcode
             return rawTemp / 1000.0;
           }
        }
      }
      await this.sleep(100);
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    const ok = await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
    if (ok) {
      await this.sleep(on ? 1200 : 200); 
    }
    return ok;
  }

  async scan(): Promise<Uint16Array | null> {
    if (!await this.send(CMD.SCAN)) return null;

    await this.sleep(50); 

    // El escaneo puede tardar un poco más en llegar
    const packet = await this.readPacket(2000);
    
    if (!packet) return null;

    // Buscar header de Scan (Opcode 0x05)
    let dataStart = -1;
    let dataLen = 0;

    // Analizar la estructura del paquete recibido
    // Puede ser [02, LEN, 05, ...] (Short) o [02, HI, LO, 05...] (Long)
    
    // Verificar formato Short
    if (packet.length > 3 && packet[2] === 0x05) {
      dataLen = packet[1] - 1;
      dataStart = 3;
    } 
    // Verificar formato Long (MicroNIR Pro/ES suele usar este)
    else if (packet.length > 4 && packet[3] === 0x05) {
      dataLen = (packet[1] << 8 | packet[2]) - 1;
      dataStart = 4;
    }

    if (dataStart > 0 && dataLen > 0 && (dataStart + dataLen) <= packet.length) {
      const numPixels = Math.floor(dataLen / 2);
      const spectrum = new Uint16Array(numPixels);
      const view = new DataView(packet.buffer);

      for (let i = 0; i < numPixels; i++) {
        spectrum[i] = view.getUint16(dataStart + (i * 2), false);
      }
      return spectrum;
    }
    
    console.warn("Invalid Spectrum Packet", packet);
    return null;
  }

  /**
   * Lector de Paquetes con "Ventana Deslizante".
   * Tolera basura al principio del buffer y busca activamente el STX (0x02).
   */
  private async readPacket(timeoutMs: number): Promise<Uint8Array | null> {
    const startTime = Date.now();
    let acc = new Uint8Array(0);

    while ((Date.now() - startTime) < timeoutMs) {
      try {
        const res = await this.device.transferIn(this.inEndpoint, 64);
        
        if (res.status === 'ok' && res.data.byteLength > 2) {
          // FTDI Headers: Los primeros 2 bytes son estado, los ignoramos
          const newBytes = new Uint8Array(res.data.buffer.slice(2));
          
          // Concatenar al acumulador
          const temp = new Uint8Array(acc.length + newBytes.length);
          temp.set(acc);
          temp.set(newBytes, acc.length);
          acc = temp;

          // --- LOGICA DE BÚSQUEDA DE PAQUETE ---
          
          // 1. Buscar marcador de inicio STX (0x02)
          let stxIndex = -1;
          for(let i=0; i < acc.length; i++) {
            if (acc[i] === 0x02) {
              stxIndex = i;
              break;
            }
          }

          // Si encontramos un STX
          if (stxIndex !== -1) {
            // Descartar basura anterior al STX
            if (stxIndex > 0) {
              acc = acc.slice(stxIndex);
            }

            // Necesitamos al menos 3 bytes para saber longitud [02, LEN, CMD...]
            if (acc.length >= 3) {
              // Calcular tamaño esperado
              // Nota: La longitud en el protocolo suele ser: LEN byte = Tamaño de (CMD + DATA)
              // Total frame = 1(STX) + 1(LEN) + LEN + 1(CRC) + 1(ETX) = LEN + 4 bytes.
              // O en formato largo: 1(STX) + 2(LEN) + LEN + 1(CRC) + 1(ETX) = LEN + 5 bytes.
              
              let expectedLen = 0;
              let isLongFrame = false;

              // Heurística simple: Si el byte de longitud es muy grande o el opcode no cuadra, verificar formato largo
              // Pero para comandos simples (Temp), es formato corto.
              
              const lenByte = acc[1];
              const totalShort = lenByte + 4;

              // Verificamos si tenemos el paquete completo (Formato Corto)
              if (acc.length >= totalShort) {
                if (acc[totalShort - 1] === 0x03) {
                  return acc.slice(0, totalShort);
                }
              }
              
              // Verificamos formato largo (solo si parece ser escaneo o calibración)
              // [02, LEN_HI, LEN_LO, CMD...]
              const lenLong = (acc[1] << 8) | acc[2];
              const totalLong = lenLong + 5;
              
              if (acc.length >= totalLong) {
                 if (acc[totalLong - 1] === 0x03) {
                   return acc.slice(0, totalLong);
                 }
              }
            }
          }
        }
      } catch (e) {
        // Ignorar timeout de USB (polling)
        await this.sleep(5);
      }
    }
    return null;
  }
}

export const device = new MicroNIRDriver();
