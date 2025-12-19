
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

  // Enviar comando de control al chip FTDI
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

      // --- CONFIGURACIÓN FTDI AGRESIVA ---
      
      // 1. Reset General
      await this.ctrl(0x00, 0x00, 0x00); 
      // 1.1 Purga RX (Buffer Recepción)
      await this.ctrl(0x00, 0x01, 0x00);
      // 1.2 Purga TX (Buffer Envío)
      await this.ctrl(0x00, 0x02, 0x00);

      // 2. Baud Rate: 115200
      await this.ctrl(0x03, 0x401A, 0x00);

      // 3. Formato: 8 Data bits, No Parity, 1 Stop bit
      await this.ctrl(0x04, 0x0008, 0x00);

      // 4. Latency Timer: 1ms (Muy importante para respuestas rápidas)
      await this.ctrl(0x09, 0x0001, 0x00);

      // 5. Flow Control: OFF
      await this.ctrl(0x02, 0x0000, 0x00);

      // 6. POWER UP (DTR High + RTS High) - Alimenta el microcontrolador
      // Value: 0x0303 (Mask=03, Val=03)
      await this.ctrl(0x01, 0x0303, 0x00);

      this.isConnected = true;
      
      // Esperar que el voltaje se estabilice
      await this.sleep(200);

      // Limpieza final de tuberías
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

  /**
   * Lee y descarta todo lo que haya en el buffer de entrada.
   * Útil antes de enviar un comando para asegurar que la respuesta es nueva.
   */
  private async flushRx() {
    if (!this.isConnected) return;
    try {
      // Intentar leer hasta 3 veces o hasta que venga vacío
      for(let i=0; i<3; i++) {
        const res = await this.device.transferIn(this.inEndpoint, 64);
        if (!res.data || res.data.byteLength <= 2) break; // Solo headers (2 bytes) = vacío
      }
    } catch(e) { /* Timeout esperado si está vacío */ }
  }

  /**
   * Envía comando [STX, LEN, OPCODE, DATA, CRC, ETX]
   */
  async send(opcode: number, data: number[] = []): Promise<boolean> {
    if (!this.isConnected) return false;

    await this.flushRx(); // Limpiar antes de preguntar

    const len = data.length + 1;
    const rawPayload = new Uint8Array([len, opcode, ...data]);
    const crc = calculateCrc8(rawPayload);

    // Construir paquete
    const packet = new Uint8Array([0x02, ...rawPayload, crc, 0x03]);

    try {
      const res = await this.device.transferOut(this.outEndpoint, packet);
      return res.status === 'ok';
    } catch (e) {
      console.error("TX Error:", e);
      return false;
    }
  }

  /**
   * Lee la temperatura del sensor.
   * Se usa un timeout mayor (300ms) para dar tiempo al sensor de despertar.
   */
  async getTemperature(): Promise<number | null> {
    // Reintento: A veces el primer comando falla si el chip se acaba de encender
    for(let attempt=0; attempt<2; attempt++) {
      if (await this.send(CMD.GET_TEMP)) {
        await this.sleep(50); // Tiempo de proceso del sensor
        
        // Esperamos respuesta hasta 300ms
        const resp = await this.readPacket(300);
        
        // Verificar si es respuesta de Temp (Opcode 0x06)
        // [02, LEN, 06, MSB, LSB, CRC, 03]
        if (resp && resp.length >= 5 && resp[2] === 0x06) {
           const view = new DataView(resp.buffer);
           const rawTemp = view.getUint16(3, false); // Big Endian
           return rawTemp / 1000.0;
        }
      }
      await this.sleep(100); // Esperar antes de reintentar
    }
    return null;
  }

  async setLamp(on: boolean): Promise<boolean> {
    const ok = await this.send(CMD.LAMP_CONTROL, [on ? 1 : 0]);
    if (ok) {
      // La lámpara halógena tarda en estabilizar temperatura y corriente
      await this.sleep(on ? 1500 : 200); 
    }
    return ok;
  }

  async scan(): Promise<Uint16Array | null> {
    if (!await this.send(CMD.SCAN)) return null;

    // Tiempo de integración (fijo o variable según config)
    await this.sleep(100); 

    // El escaneo envía muchos datos (~300 bytes). Damos 2 segundos.
    const packet = await this.readPacket(2000);
    
    if (!packet) return null;

    // Buscar header de Scan (Opcode 0x05)
    // Formato normal: [02, LEN, 05, DATA..., CRC, 03]
    if (packet.length > 10 && packet[0] === 0x02) {
      let dataStart = 0;
      let dataLen = 0;

      if (packet[2] === 0x05) { // Formato corto
        dataLen = packet[1] - 1;
        dataStart = 3;
      } else if (packet[3] === 0x05) { // Formato largo
        dataLen = (packet[1] << 8 | packet[2]) - 1;
        dataStart = 4;
      }

      if (dataLen > 0 && (dataStart + dataLen) <= packet.length) {
        const numPixels = dataLen / 2;
        const spectrum = new Uint16Array(numPixels);
        const view = new DataView(packet.buffer);

        for (let i = 0; i < numPixels; i++) {
          spectrum[i] = view.getUint16(dataStart + (i * 2), false);
        }
        return spectrum;
      }
    }
    
    console.warn("Invalid Packet Structure:", packet);
    return null;
  }

  /**
   * Lee del USB, elimina headers FTDI (2 bytes cada 64 bytes) y ensambla.
   * Busca STX (0x02) y ETX (0x03).
   */
  private async readPacket(timeoutMs: number): Promise<Uint8Array | null> {
    const startTime = Date.now();
    let acc = new Uint8Array(0);

    while ((Date.now() - startTime) < timeoutMs) {
      try {
        // Pedimos 64 bytes (Max Packet Size para Full Speed)
        const res = await this.device.transferIn(this.inEndpoint, 64);
        
        if (res.status === 'ok' && res.data.byteLength > 2) {
          // Los primeros 2 bytes son SIEMPRE Modem Status del FTDI. Los ignoramos.
          const newBytes = new Uint8Array(res.data.buffer.slice(2));
          
          // Concatenar
          const temp = new Uint8Array(acc.length + newBytes.length);
          temp.set(acc);
          temp.set(newBytes, acc.length);
          acc = temp;

          // Chequeo rápido: ¿Tenemos STX al principio y ETX al final?
          if (acc.length > 5 && acc[0] === 0x02 && acc[acc.length-1] === 0x03) {
            return acc;
          }
        }
      } catch (e) {
        // Ignorar STALL o timeouts cortos de polling
        await this.sleep(10);
      }
    }
    
    return acc.length > 0 ? acc : null;
  }
}

export const device = new MicroNIRDriver();
