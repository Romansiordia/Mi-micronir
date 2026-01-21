
import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity, RefreshCw, Zap, Terminal, Target, Thermometer, 
  Lightbulb, Search, RotateCcw, Bluetooth, Usb, 
  FlaskConical, ShieldCheck, AlertCircle, Cpu, Layers, BrainCircuit
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { device as usbDevice } from './services/usbService';
import { bleDevice } from './services/bleService';
import { getAIInterpretation } from './services/geminiService';
import { CDM_MODEL } from './constants';
import { CalibrationData, WavelengthPoint, LampStatus } from './types';

export default function App() {
  // Estados de Conexión
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'ready' | 'error'>('disconnected');
  const [connectionMode, setConnectionMode] = useState<'USB' | 'BLE'>('USB');
  const [identity, setIdentity] = useState<{model: string; mode: string} | null>(null);
  const [temp, setTemp] = useState<number | null>(null);
  
  // Estados de Datos Espectrales
  const [spectralData, setSpectralData] = useState<WavelengthPoint[]>([]);
  const [calibration, setCalibration] = useState<CalibrationData>({ dark: null, reference: null, step: 'none' });
  const [prediction, setPrediction] = useState<number | null>(null);
  const [aiReport, setAiReport] = useState<string | null>(null);
  
  // Estados de Hardware
  const [lampOn, setLampOn] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLogEntry = (msg: string) => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 50)]);
  };

  useEffect(() => {
    usbDevice.setLogger(addLogEntry);
    bleDevice.setLogger(addLogEntry);
  }, []);

  const connectDevice = async () => {
    setStatus('connecting');
    try {
      const res = connectionMode === 'USB' ? await usbDevice.connect() : await bleDevice.connect();
      if (res && (typeof res === 'object' || res === "OK")) {
        setStatus('ready');
        setIdentity(typeof res === 'object' ? res : { model: "MicroNIR Wireless", mode: "BLE_MODE" });
        refreshStatus();
      } else {
        setStatus('error');
      }
    } catch (e) {
      setStatus('error');
    }
  };

  const refreshStatus = async () => {
    const device = connectionMode === 'USB' ? usbDevice : bleDevice;
    const t = await device.getTemperature();
    setTemp(t);
  };

  // Lógica de Calibración
  const takeCalibration = async (type: 'dark' | 'reference') => {
    setIsProcessing(true);
    addLogEntry(`Iniciando calibración: ${type.toUpperCase()}...`);
    const device = connectionMode === 'USB' ? usbDevice : bleDevice;
    
    // Si es Dark, nos aseguramos que la lámpara esté apagada
    if (type === 'dark') await device.setLamp(false);
    
    const data = await device.scan();
    if (data) {
      const rawValues = Array.from(data);
      setCalibration(prev => ({
        ...prev,
        [type]: rawValues,
        step: type === 'dark' ? 'dark' : (prev.dark ? 'ready' : 'reference')
      }));
      addLogEntry(`Calibración ${type} exitosa.`);
    }
    setIsProcessing(false);
  };

  // Escaneo y Predicción PLS
  const runAnalysis = async () => {
    if (!calibration.dark || !calibration.reference) {
      addLogEntry("ERROR: Se requiere calibración Dark y Reference primero.");
      return;
    }

    setIsProcessing(true);
    addLogEntry("Ejecutando escaneo de muestra...");
    const device = connectionMode === 'USB' ? usbDevice : bleDevice;
    const rawData = await device.scan();

    if (rawData) {
      // 1. Calcular Absorbancia: -log10((Muestra - Dark) / (Referencia - Dark))
      const processed: WavelengthPoint[] = CDM_MODEL.wavelengths.map((nm, i) => {
        const sample = rawData[i];
        const dark = calibration.dark![i];
        const ref = calibration.reference![i];
        
        // Evitar división por cero o log de negativo
        const intensity = Math.max(0.1, (sample - dark) / (ref - dark));
        const absorbance = -Math.log10(intensity);
        
        return { nm: Math.round(nm), absorbance, raw: sample };
      });

      setSpectralData(processed);

      // 2. Predicción PLS: Sum(Absorbancia * Beta) + Bias
      let sum = CDM_MODEL.bias;
      processed.forEach((p, i) => {
        sum += p.absorbance * (CDM_MODEL.betaCoefficients[i] || 0);
      });
      setPrediction(sum);

      // 3. Consultar IA para Diagnóstico de Hardware
      const report = await getAIInterpretation(processed, sum.toFixed(2), lampOn ? 'ok' : 'off');
      setAiReport(report);
      
      addLogEntry(`Análisis completado. Predicción: ${sum.toFixed(2)}%`);
    }
    setIsProcessing(false);
  };

  const handleAbort = async () => {
    const device = connectionMode === 'USB' ? usbDevice : bleDevice;
    if (connectionMode === 'USB') await usbDevice.abortOperation();
    else await bleDevice.resetHardware();
    setLampOn(false);
    setStatus('disconnected');
    addLogEntry("Hardware reseteado por el usuario.");
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-4 font-sans flex flex-col gap-4">
      {/* Header Compacto */}
      <header className="flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-900/40 backdrop-blur-md p-5 rounded-3xl border border-white/5">
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-2xl ${connectionMode === 'BLE' ? 'bg-blue-500/20' : 'bg-teal-500/20'}`}>
            {connectionMode === 'BLE' ? <Bluetooth className="text-blue-400" /> : <Usb className="text-teal-400" />}
          </div>
          <div>
            <h1 className="text-lg font-black text-white">MicroNIR <span className="opacity-50">Quantum</span></h1>
            <div className="flex gap-2">
               <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-white/5 text-slate-400 uppercase tracking-widest">{connectionMode} LINK</span>
               {temp && <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">{temp.toFixed(1)}°C</span>}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          {status !== 'ready' ? (
            <button onClick={connectDevice} disabled={status === 'connecting'} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-sm transition-all flex items-center gap-2">
              <RefreshCw className={status === 'connecting' ? 'animate-spin' : ''} size={16} />
              {status === 'connecting' ? 'CONECTANDO...' : 'CONECTAR'}
            </button>
          ) : (
            <div className="flex gap-2">
                <button onClick={() => takeCalibration('dark')} disabled={isProcessing} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold border border-white/5">CALIBRAR DARK</button>
                <button onClick={() => takeCalibration('reference')} disabled={isProcessing} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold border border-white/5">CALIBRAR WHITE</button>
                <button onClick={runAnalysis} disabled={isProcessing || !calibration.reference} className="px-6 py-2 bg-teal-600 hover:bg-teal-500 rounded-xl text-xs font-black shadow-lg shadow-teal-900/20 flex items-center gap-2">
                   <Zap size={14} /> ANALIZAR MUESTRA
                </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 overflow-hidden">
        
        {/* Panel Izquierdo: Gráfico y Resultados */}
        <div className="lg:col-span-8 flex flex-col gap-4 overflow-hidden">
          
          {/* Gráfico Espectral */}
          <div className="flex-1 bg-slate-900/20 rounded-[2rem] border border-white/5 p-6 min-h-[400px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
               <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                 <Activity size={14} className="text-teal-500" /> Espectro de Absorbancia (NIR)
               </h2>
               <div className="flex gap-4 text-[10px] font-bold">
                  <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-teal-500"/> MUESTRA</div>
                  <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-slate-700"/> LÍNEA BASE</div>
               </div>
            </div>
            
            <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spectralData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickMargin={10} label={{ value: 'Wavelength (nm)', position: 'insideBottom', offset: -5, fontSize: 10, fill: '#475569' }} />
                  <YAxis stroke="#475569" fontSize={10} label={{ value: 'Absorbance (AU)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#475569' }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', fontSize: '10px' }}
                    itemStyle={{ color: '#2dd4bf' }}
                  />
                  <Line type="monotone" dataKey="absorbance" stroke="#2dd4bf" strokeWidth={3} dot={false} animationDuration={500} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Dash de Resultados */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900/40 p-6 rounded-3xl border border-white/5 flex flex-col items-center justify-center text-center">
               <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">Predicción Final</span>
               <div className="text-4xl font-black text-white tracking-tighter">
                  {prediction !== null ? `${prediction.toFixed(2)}%` : '--.--'}
               </div>
               <span className="text-[8px] text-teal-500 font-bold mt-2 uppercase">{CDM_MODEL.name}</span>
            </div>
            
            <div className="md:col-span-2 bg-gradient-to-br from-blue-600/10 to-transparent p-6 rounded-3xl border border-blue-500/20 relative overflow-hidden">
               <BrainCircuit className="absolute -right-4 -bottom-4 text-blue-500/10" size={100} />
               <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                 <ShieldCheck size={14} /> Diagnóstico Gemini AI
               </h3>
               <p className="text-sm text-slate-300 leading-relaxed italic">
                 {aiReport || "Realiza un escaneo para obtener un diagnóstico de integridad del hardware mediante inteligencia artificial."}
               </p>
            </div>
          </div>
        </div>

        {/* Panel Derecho: Estado y Consola */}
        <div className="lg:col-span-4 flex flex-col gap-4 overflow-hidden">
          
          {/* Status del Equipo */}
          <div className="bg-slate-900/40 rounded-3xl border border-white/5 p-6">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Layers size={14} /> Estado del Sistema
            </h3>
            <div className="space-y-3">
               <div className="flex justify-between items-center p-3 bg-white/5 rounded-xl border border-white/5">
                  <span className="text-xs text-slate-400">Calibración Dark</span>
                  <div className={`w-2 h-2 rounded-full ${calibration.dark ? 'bg-green-500' : 'bg-red-500'}`} />
               </div>
               <div className="flex justify-between items-center p-3 bg-white/5 rounded-xl border border-white/5">
                  <span className="text-xs text-slate-400">Referencia White</span>
                  <div className={`w-2 h-2 rounded-full ${calibration.reference ? 'bg-green-500' : 'bg-red-500'}`} />
               </div>
               <div className="flex justify-between items-center p-3 bg-white/5 rounded-xl border border-white/5">
                  <span className="text-xs text-slate-400">Lámpara NIR</span>
                  <button onClick={() => {
                    const dev = connectionMode === 'USB' ? usbDevice : bleDevice;
                    dev.setLamp(!lampOn);
                    setLampOn(!lampOn);
                  }} className={`px-3 py-1 rounded-lg text-[10px] font-black ${lampOn ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-700 text-slate-500'}`}>
                    {lampOn ? 'ON' : 'OFF'}
                  </button>
               </div>
            </div>
            
            <button onClick={handleAbort} className="w-full mt-4 p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 text-[10px] font-black hover:bg-red-500/10 transition-all">
               DESCONECTAR / RESET
            </button>
          </div>

          {/* Consola Mini */}
          <div className="flex-1 bg-black/40 rounded-3xl border border-white/5 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
               <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                 <Terminal size={12} /> Log de Eventos
               </span>
               <button onClick={() => setLogs([])} className="text-[8px] text-slate-600 hover:text-slate-400 font-bold">LIMPIAR</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-1">
               {logs.map((log, i) => (
                  <div key={i} className={`p-1 ${log.includes('ERROR') ? 'text-red-400' : log.includes('ÉXITO') ? 'text-green-400' : 'text-slate-500'}`}>
                    {log}
                  </div>
               ))}
               <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="text-[9px] text-slate-600 font-bold uppercase tracking-[0.3em] text-center py-2 opacity-50">
        Quantum Control System v3.5 • Real-time PLS Analysis Enabled
      </footer>
    </div>
  );
}
