
import { GoogleGenAI } from "@google/genai";
import { WavelengthPoint, LampStatus } from "../types";

export const getAIInterpretation = async (
  spectralData: WavelengthPoint[], 
  prediction: string | null,
  lampStatus: LampStatus
) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `
        Actúa como un experto en Quimiometría y Espectroscopia NIR. 
        Información de Diagnóstico:
        - Estado actual de la lámpara: ${lampStatus}
        - Predicción calculada (Proteína/Humedad): ${prediction || 'N/A'}%
        - Muestra espectral (primeros 5 puntos): ${JSON.stringify(spectralData.slice(0, 5))}
        
        Tareas:
        1. Si el estado es "error_nan", explica causas técnicas posibles.
        2. Explica brevemente qué sugiere la curva de absorbancia actual para la calidad del producto.
        3. Proporciona una recomendación de una frase para el operador.
        
        Mantén la respuesta técnica pero concisa. Usa Español.
      `
    });

    return response.text || "No se pudo generar una interpretación técnica en este momento.";
  } catch (error) {
    console.error("Gemini interpretation error:", error);
    return "Error al conectar con la inteligencia artificial para diagnóstico.";
  }
};
