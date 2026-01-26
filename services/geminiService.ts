
import { GoogleGenAI } from "@google/genai";
import { WavelengthPoint, LampStatus, PredictionResult } from "../types";

export const getAIInterpretation = async (
  spectralData: WavelengthPoint[], 
  prediction: PredictionResult | null,
  lampStatus: LampStatus
) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        Contexto: Eres un experto en espectroscopia NIR analizando una muestra de alimento para animales.
        Datos de la sesión:
        - Estado de la lámpara: ${lampStatus}
        - Resultados del Modelo Predictivo: Humedad: ${prediction?.moisture.toFixed(2) || 'N/A'}%, Proteína: ${prediction?.protein.toFixed(2) || 'N/A'}%, Grasa: ${prediction?.fat.toFixed(2) || 'N/A'}%.
        - Puntos clave del espectro (Absorbancia): ${JSON.stringify(spectralData.filter((_, i) => i % 15 === 0))}
        
        Realiza un diagnóstico conciso:
        1. Si la absorbancia es negativa, indica un error de calibración. Si es casi cero, la muestra es idéntica a la referencia.
        2. Si el estado de la lámpara es 'saturado', advierte que el tiempo de integración es muy alto y los resultados no son fiables.
        3. Basado en los picos de absorbancia cerca de 1200nm (grasa) y 1450nm (agua), valida si los resultados predichos son coherentes.
        4. Ofrece un veredicto final de 15 palabras sobre la calidad de la medición.
        
        Responde en Español, con un tono profesional y directo.
      `
    });

    return response.text;
  } catch (error) {
    console.error("AI interpretation error:", error);
    return "Diagnóstico por IA no disponible en este momento.";
  }
};
