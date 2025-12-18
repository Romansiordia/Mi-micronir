
import { GoogleGenAI } from "@google/genai";
import { WavelengthPoint, LampStatus } from "../types";

// Inicialización diferida para mayor seguridad
let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    const apiKey = process.env.API_KEY || (window as any).process?.env?.API_KEY;
    aiInstance = new GoogleGenAI({ apiKey: apiKey });
  }
  return aiInstance;
};

export const getAIInterpretation = async (
  spectralData: WavelengthPoint[], 
  prediction: string | null,
  lampStatus: LampStatus
) => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `
        Act as a Chemometrics and NIR Spectroscopy expert. 
        Diagnostic Information:
        - Current Lamp Status: ${lampStatus}
        - Prediction (Protein/Moisture): ${prediction || 'N/A'}%
        - Spectral Sample (first 5 points): ${JSON.stringify(spectralData.slice(0, 5))}
        
        Tasks:
        1. If status is "error_nan", explain technical causes (e.g., USB power sag, ftdi driver issues).
        2. Briefly explain what the current absorbance curve suggests for pig feed quality.
        3. Provide a one-sentence recommendation for the operator.
        
        Keep the response technical but concise. Use Spanish.
      `
    });

    return response.text || "No se pudo generar una interpretación técnica en este momento.";
  } catch (error) {
    console.error("Gemini interpretation error:", error);
    return "Error al conectar con la inteligencia artificial para diagnóstico.";
  }
};
