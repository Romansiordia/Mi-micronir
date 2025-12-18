
import React, { useState, useCallback, useEffect } from 'react';
import { 
  Usb, Activity, Settings, AlertCircle, CheckCircle2, 
  Play, RefreshCw, Database, Info, Lightbulb, ZapOff,
  Cpu, Terminal, BrainCircuit, History, ShieldCheck,
  Moon, Sun, Gauge, Send
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { WavelengthPoint, LampStatus, LogEntry, ScanResult, CalibrationData } from './types';
import { CDM_MODEL } from './constants';
import { getAIInterpretation } from './services/geminiService';
import { microNir } from './services/usbService';

const App: React.FC = () => {
  const [initError, setInitError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lampStatus, setLampStatus] = useState<LampStatus>('off');
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [rawCommand, setRawCommand] = useState("020103");

  const [calib, setCalib] = useState<CalibrationData>({
    dark: null,
    reference: null,
    step: 'none'
  });

  const [spectralData, setSpectralData] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);

  // Captura de errores de renderizado
  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      setInitError(e.message);
      console.error("Runtime Error:", e);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  const addLog = useCallback((message: string, type: LogEntry['type']) => {
    setLogs(prev => [{ timestamp: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
  }, []);

  const handleConnect = async () => {
    try {
      const success = await microNir.connect();
      if (success) {
        setIsConnected(true);
        addLog("Conexión USB establecida. Puerto abierto.", "success");
      } else {
        addLog("Error de conexión. Verifique permisos o conexión física.", "error");
      }
    } catch (err) {
      addLog("Fallo crítico al acceder a WebUSB.", "error");
    }
  };

  const testRawCommand = async () => {
    addLog(`Enviando RAW HEX: ${rawCommand}`, "info");
    const ok = await microNir.sendRaw(rawCommand);
    if (ok) addLog("Comando enviado exitosamente.", "success");
    else addLog("Fallo al enviar comando.", "error");
  };

  const toggleLamp = async () => {
    const nextOn = lampStatus !== 'ok';
    const ok = await microNir.setLamp(nextOn);
    if (ok) {
      setLampStatus(nextOn ? 'ok' : 'off');
      addLog(`Lámpara conmutada a: ${nextOn ? 'ON' : 'OFF'}`, "warning");
    } else {
      addLog("El hardware no respondió al comando de lámpara.", "error");
    }
  };

  const processHardwareRead = async () => {
    const rawBuffer = await microNir.readSpectrum();
    if (!rawBuffer) {
      addLog("Error: El equipo no devolvió datos. Revise alimentación USB.", "error");
      return null;
    }
    return Array.from(rawBuffer);
  };

  const runCalibrationStep = async (step: 'dark' | 'reference') => {
    setIsMeasuring(true);
    addLog(`Capturando hardware para ${step.toUpperCase()}...`, 'info');
    const data = await processHardwareRead();
    if (data) {
      setCalib(prev => {
        const newState = { ...prev, [step]: data };
        newState.step = (step === 'dark' && prev.reference) || (step === 'reference' && prev.dark) ? 'ready' : step;
        return newState;
      });
      addLog(`${step.toUpperCase()} almacenado correctamente.`, 'success');
    }
    setIsMeasuring(false);
  };

  const startScan = async () => {
    if (calib.step !== 'ready') {
      addLog("Debe completar Dark y Reference Scan primero.", "error");
      return;
    }
    setIsMeasuring(true);
    addLog("Iniciando escaneo de muestra...", "info");
    const sampleRaw = await processHardwareRead();
    if (sampleRaw) {
      const absValues = sampleRaw.map((s, i) => {
        const d = calib.dark![i] || 0;
        const r = calib.reference![i] || 1;
        const reflectance = (s - d) / (r - d);
        return -Math.log10(Math.max(reflectance, 0.0001));
      });

      const newData = CDM_MODEL.wavelengths.map((nm, i) => ({
        nm,
        absorbance: absValues[i] || 0,
        raw: sampleRaw[i]
      }));

      let sum = CDM_MODEL.bias;
      absValues.forEach((v, i) => { if (CDM_MODEL.betaCoefficients[i]) sum += v * CDM_MODEL.betaCoefficients[i]; });
      
      const pred = sum.toFixed(2);
      setSpectralData(newData);
      setPrediction(pred);
      addLog(`Análisis completado: ${pred}%`, "success");
      getAIInterpretation(newData, pred, lampStatus).then(setAiInsight);
    }
    setIsMeasuring(false);
  };

  if (initError) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4">
          <AlertCircle size={64} className="text-red-500 mx-auto" />
          <h1 className="text-2xl font-bold text-white">Error de Iniciación</h1>
          <p className="text-slate-400 text-sm font-mono bg-slate-900 p-4 rounded-xl border border-red-500/20">
            {initError}
          </p>
          <button onClick={() => window.location.reload()} className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-8 flex flex-col gap-6 text-slate-100 bg-[#020617]">
      
      <header className="glass-panel p-6 rounded-[2rem] flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 text-blue-400">
            <Cpu size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent italic">
              MicroNIR Quantum Control
            </h1>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Hardware Debug & Spectroscopy</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isConnected ? (
            <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-full font-bold text-sm shadow-xl shadow-blue-900/40 flex items-center gap-2">
              <Usb size={18} /> ACTIVAR WEBUSB
            </button>
          ) : (
            <div className="flex items-center gap-2">
               <button onClick={toggleLamp} className={`px-6 py-3 rounded-full font-bold text-sm flex items-center gap-2 transition-all ${lampStatus === 'ok' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                {lampStatus === 'ok' ? <Lightbulb className="animate-pulse" /> : <ZapOff />}
                LÁMPARA: {lampStatus === 'ok' ? 'ON' : 'OFF'}
              </button>
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-4 py-3 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck size={14} /> Hardware Conectado
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <aside className="lg:col-span-4 flex flex-col gap-6">
          <section className="glass-panel p-6 rounded-[2rem] border-orange-500/20">
            <h3 className="text-orange-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <Terminal size={14} /> Inyector de Comandos (Raw Hex)
            </h3>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={rawCommand}
                onChange={(e) => setRawCommand(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs font-mono text-orange-200 outline-none focus:border-orange-500/50"
                placeholder="Ej: 020103"
              />
              <button onClick={testRawCommand} className="bg-slate-800 p-3 rounded-xl hover:bg-slate-700 text-orange-400 transition-all">
                <Send size={16} />
              </button>
            </div>
          </section>

          <section className="glass-panel p-6 rounded-[2rem]">
            <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <Gauge size={14} /> Calibración Requerida
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <button 
                disabled={!isConnected || isMeasuring}
                onClick={() => runCalibrationStep('dark')}
                className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${calib.dark ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800/30 border-slate-700/50'}`}
              >
                <div className="flex items-center gap-3">
                  <Moon size={20} />
                  <div className="text-left">
                    <p className="text-xs font-bold uppercase tracking-tighter">Dark Scan</p>
                    <p className="text-[10px] opacity-60">Fondo (Lámpara OFF)</p>
                  </div>
                </div>
                {calib.dark && <CheckCircle2 size={16} />}
              </button>

              <button 
                disabled={!isConnected || isMeasuring}
                onClick={() => runCalibrationStep('reference')}
                className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${calib.reference ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800/30 border-slate-700/50'}`}
              >
                <div className="flex items-center gap-3">
                  <Sun size={20} />
                  <div className="text-left">
                    <p className="text-xs font-bold uppercase tracking-tighter">Reference Scan</p>
                    <p className="text-[10px] opacity-60">Standard Blanco 99%</p>
                  </div>
                </div>
                {calib.reference && <CheckCircle2 size={16} />}
              </button>
            </div>
          </section>

          <section className="glass-panel p-6 rounded-[2rem] flex-1 flex flex-col overflow-hidden min-h-[200px]">
            <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <Terminal size={14} /> Hardware Debug Log
            </h3>
            <div className="flex-1 overflow-y-auto space-y-2 font-mono text-[9px]">
              {logs.map((log, i) => (
                <div key={i} className={`p-1 border-l-2 pl-2 ${log.type === 'error' ? 'border-red-500 text-red-400' : log.type === 'success' ? 'border-emerald-500 text-emerald-400' : 'border-slate-800 text-slate-400'}`}>
                  [{log.timestamp}] {log.message}
                </div>
              ))}
              {logs.length === 0 && <p className="text-slate-700 italic">Esperando actividad...</p>}
            </div>
          </section>
        </aside>

        <main className="lg:col-span-8 space-y-6">
          <section className="glass-panel p-8 rounded-[2rem] min-h-[450px] flex flex-col border-blue-500/10">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Activity className="text-blue-400" /> Espectro Absorbancia
                </h2>
                <p className="text-slate-500 text-xs">Datos procesados en tiempo real</p>
              </div>
              <div className="bg-slate-900/50 px-6 py-3 rounded-2xl border border-slate-800 text-right">
                 <p className="text-[9px] text-slate-500 uppercase font-black">Muestra Predictiva</p>
                 <p className="text-3xl font-black text-emerald-400">{prediction ? `${prediction}%` : '---'}</p>
              </div>
            </div>

            <div className="flex-1 w-full min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectralData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.3} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickFormatter={(v) => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }} />
                  <Area type="monotone" dataKey="absorbance" stroke="#3b82f6" fillOpacity={0.1} fill="#3b82f6" strokeWidth={3} animationDuration={500} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-8">
              <button 
                disabled={!isConnected || calib.step !== 'ready' || isMeasuring}
                onClick={startScan}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-20 disabled:grayscale text-white font-black py-6 rounded-[1.5rem] transition-all flex items-center justify-center gap-4"
              >
                {isMeasuring ? <RefreshCw className="animate-spin" /> : <Play size={24} fill="currentColor" />}
                <span className="text-lg uppercase tracking-tight">
                  {isMeasuring ? 'Escaneando...' : 'MEDIR MUESTRA (WEBUSB)'}
                </span>
              </button>
            </div>
          </section>

          {aiInsight && (
            <section className="glass-panel p-6 rounded-[2rem] border-indigo-500/20 bg-indigo-500/5">
              <div className="flex items-center gap-3 mb-4">
                <BrainCircuit className="text-indigo-400" size={20} />
                <h4 className="text-sm font-black text-indigo-200 uppercase tracking-widest">Diagnóstico AI</h4>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed italic">"{aiInsight}"</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
