
import { GoogleGenAI } from "@google/genai";
import { WavelengthPoint, LampStatus } from "../types";

export const getAIInterpretation = async (
  spectralData: WavelengthPoint[], 
  prediction: string | null,
  lampStatus: LampStatus
) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Usamos el modelo flash para respuestas rápidas de diagnóstico
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        Contexto: Control de Calidad mediante Espectroscopia NIR (MicroNIR).
        Datos de la sesión:
        - Lámpara: ${lampStatus}
        - Resultado Predicho: ${prediction || 'Pendiente'}%
        - Valores Espectrales (puntos críticos): ${JSON.stringify(spectralData.filter((_, i) => i % 20 === 0))}
        
        Analiza si hay anomalías:
        1. Si los valores de absorbancia son negativos o constantes (0), indica que la calibración Dark/White falló.
        2. Si la curva tiene mucho ruido, sugiere limpiar la ventana de zafiro.
        3. Da un veredicto de 15 palabras sobre la integridad del hardware.
        
        Responde en Español, directo y profesional.
      `
    });

    return response.text;
  } catch (error) {
    console.error("AI interpretation error:", error);
    return "Diagnóstico IA no disponible.";
  }
};
