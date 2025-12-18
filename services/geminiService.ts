
import { GoogleGenAI } from "@google/genai";
import { WavelengthPoint, LampStatus } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getAIInterpretation = async (
  spectralData: WavelengthPoint[], 
  prediction: string | null,
  lampStatus: LampStatus
) => {
  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
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

  try {
    const result = await model;
    return result.text;
  } catch (error) {
    console.error("Gemini interpretation error:", error);
    return "Error al conectar con la inteligencia artificial para diagnóstico.";
  }
};
