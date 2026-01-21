
import { useState, useEffect, useRef } from 'react';
import { 
  Activity, RefreshCw, Zap, Terminal, Bluetooth, Usb, 
  ShieldCheck, Layers, BrainCircuit
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { device as usbDevice } from './services/usbService';
import { bleDevice } from './services/bleService';
import { getAIInterpretation } from './services/geminiService';
import { CDM_MODEL } from './constants';
import { CalibrationData, WavelengthPoint } from './types';

export default function App() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'ready' | 'error'>('disconnected');
  const [connectionMode, setConnectionMode] = useState<'USB' | 'BLE'>('USB');
  const [temp, setTemp] = useState<number | null>(null);
  const [spectralData, setSpectralData] = useState<WavelengthPoint[]>([]);
  const [calibration, setCalibration] = useState<CalibrationData>({ dark: null, reference: null, step: 'none' });
  const [prediction, setPrediction] = useState<number | null>(null);
  const [aiReport, setAiReport] = useState<string | null>(null);
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
    if (isProcessing) return;
    setIsProcessing(true);
    setStatus('connecting');
    try {
      const res = connectionMode === 'USB' ? await usbDevice.connect() : await bleDevice.connect();
      if (res && (typeof res === 'object' || res === "OK")) {
        setStatus('ready');
        const device = connectionMode === 'USB' ? usbDevice : bleDevice;
        const t = await device.getTemperature();
        setTemp(t);
      } else {
        setStatus('error');
        addLogEntry("Error de conexión: Reintente.");
      }
    } catch (e) {
      setStatus('error');
      addLogEntry(`Falla crítica: ${e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const takeCalibration = async (type: 'dark' | 'reference') => {
    if (isProcessing || status !== 'ready') return;
    setIsProcessing(true);
    addLogEntry(`EJECUTANDO ${type.toUpperCase()}...`);
    
    try {
      const device = connectionMode === 'USB' ? usbDevice : bleDevice;
      // Pass the isDark flag to the scan method
      const data = await device.scan(type === 'dark');
      
      if (data) {
        const rawValues = Array.from(data);
        setCalibration(prev => ({
          ...prev,
          [type]: rawValues,
          step: type === 'dark' ? (prev.reference ? 'ready' : 'dark') : (prev.dark ? 'ready' : 'reference')
        }));
        addLogEntry(`Calibración ${type} exitosa.`);
        if (type === 'reference') setLampOn(true);
        if (type === 'dark') setLampOn(false);
      } else {
        addLogEntry(`Error: El sensor no devolvió datos para ${type}.`);
      }
    } catch (e) {
      addLogEntry(`Falla en calibración: ${e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const runAnalysis = async () => {
    if (isProcessing || !calibration.dark || !calibration.reference) return;
    setIsProcessing(true);
    addLogEntry("Analizando muestra...");

    try {
      const device = connectionMode === 'USB' ? usbDevice : bleDevice;
      const rawData = await device.scan(false);

      if (rawData) {
        const processed: WavelengthPoint[] = CDM_MODEL.wavelengths.map((nm, i) => {
          const sample = rawData[i];
          const dark = calibration.dark![i];
          const ref = calibration.reference![i];
          const intensity = Math.max(0.0001, (sample - dark) / (ref - dark));
          const absorbance = -Math.log10(intensity);
          return { nm: Math.round(nm), absorbance, raw: sample };
        });

        setSpectralData(processed);
        let sum = CDM_MODEL.bias;
        processed.forEach((p, i) => {
          sum += p.absorbance * (CDM_MODEL.betaCoefficients[i] || 0);
        });
        setPrediction(sum);

        const report = await getAIInterpretation(processed, sum.toFixed(2), 'ok');
        setAiReport(report);
        addLogEntry(`Predicción: ${sum.toFixed(2)}%`);
      }
    } catch (e) {
      addLogEntry(`Error en análisis: ${e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAbort = async () => {
    const device = connectionMode === 'USB' ? usbDevice : bleDevice;
    try {
      if (connectionMode === 'USB') await usbDevice.abortOperation();
      else await bleDevice.resetHardware();
    } catch(e) {}
    setLampOn(false);
    setStatus('disconnected');
    setCalibration({ dark: null, reference: null, step: 'none' });
    addLogEntry("Sistema reseteado.");
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-4 font-sans flex flex-col gap-4">
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
            <div className="flex gap-2">
              <select 
                value={connectionMode} 
                onChange={(e) => setConnectionMode(e.target.value as 'USB' | 'BLE')}
                className="bg-slate-800 border-none rounded-xl text-xs font-bold px-3 focus:ring-0"
              >
                <option value="USB">MODO USB</option>
                <option value="BLE">MODO BLE</option>
              </select>
              <button onClick={connectDevice} disabled={isProcessing} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl font-bold text-sm transition-all flex items-center gap-2">
                <RefreshCw className={isProcessing ? 'animate-spin' : ''} size={16} />
                {isProcessing ? 'CONECTANDO...' : 'CONECTAR'}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
                <button 
                  onClick={() => takeCalibration('dark')} 
                  disabled={isProcessing} 
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-xl text-xs font-bold border border-white/5 transition-all"
                >
                  CALIBRAR DARK
                </button>
                <button 
                  onClick={() => takeCalibration('reference')} 
                  disabled={isProcessing} 
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-xl text-xs font-bold border border-white/5 transition-all"
                >
                  CALIBRAR WHITE
                </button>
                <button 
                  onClick={runAnalysis} 
                  disabled={isProcessing || !calibration.dark || !calibration.reference} 
                  className="px-6 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl text-xs font-black shadow-lg shadow-teal-900/20 flex items-center gap-2 transition-all"
                >
                   <Zap size={14} /> ANALIZAR MUESTRA
                </button>
            </div>
          )}
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 overflow-hidden">
        <div className="lg:col-span-8 flex flex-col gap-4 overflow-hidden">
          <div className="flex-1 bg-slate-900/20 rounded-[2rem] border border-white/5 p-6 min-h-[400px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
               <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                 <Activity size={14} className="text-teal-500" /> Espectro de Absorbancia (NIR)
               </h2>
            </div>
            <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spectralData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} />
                  <YAxis stroke="#475569" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', fontSize: '10px' }} />
                  <Line type="monotone" dataKey="absorbance" stroke="#2dd4bf" strokeWidth={3} dot={false} animationDuration={300} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900/40 p-6 rounded-3xl border border-white/5 flex flex-col items-center justify-center text-center">
               <span className="text-[9px] font-black text-slate-500 uppercase mb-2">Predicción Final</span>
               <div className="text-4xl font-black text-white">
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
                 {aiReport || "Listo para análisis."}
               </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-4 overflow-hidden">
          <div className="bg-slate-900/40 rounded-3xl border border-white/5 p-6">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Layers size={14} /> Estado del Sistema
            </h3>
            <div className="space-y-3 text-xs">
               <div className="flex justify-between items-center p-3 bg-white/5 rounded-xl">
                  <span>Calibración DARK</span>
                  <div className={`w-2 h-2 rounded-full ${calibration.dark ? 'bg-green-500' : 'bg-red-500'}`} />
               </div>
               <div className="flex justify-between items-center p-3 bg-white/5 rounded-xl">
                  <span>Referencia WHITE</span>
                  <div className={`w-2 h-2 rounded-full ${calibration.reference ? 'bg-green-500' : 'bg-red-500'}`} />
               </div>
            </div>
            <button onClick={handleAbort} className="w-full mt-4 p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 text-[10px] font-black hover:bg-red-500/10 transition-all">
               DESCONECTAR / RESET
            </button>
          </div>

          <div className="flex-1 bg-black/40 rounded-3xl border border-white/5 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-white/5 bg-white/5 flex items-center justify-between uppercase text-[9px] font-black text-slate-500">
               <span className="flex items-center gap-2"><Terminal size={12} /> Log de Eventos</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-1">
               {logs.map((log, i) => (
                  <div key={i} className={`p-1 ${log.includes('ERROR') ? 'text-red-400' : 'text-slate-500'}`}>
                    {log}
                  </div>
               ))}
               <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
