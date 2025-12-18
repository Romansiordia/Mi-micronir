
import React, { useState, useCallback, useEffect } from 'react';
import { 
  Usb, Activity, AlertCircle, CheckCircle2, 
  Play, RefreshCw, Lightbulb, ZapOff,
  Cpu, Terminal, BrainCircuit, ShieldCheck,
  Moon, Sun, Gauge, Send, FlaskConical,
  Settings2, Info, AlertTriangle
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { WavelengthPoint, LampStatus, LogEntry, CalibrationData } from './types';
import { CDM_MODEL } from './constants';
import { getAIInterpretation } from './services/geminiService';
import { microNir } from './services/usbService';

const App: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [simulationMode, setSimulationMode] = useState(false);
  const [lampStatus, setLampStatus] = useState<LampStatus>('off');
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [calib, setCalib] = useState<CalibrationData>({ dark: null, reference: null, step: 'none' });
  const [spectralData, setSpectralData] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);

  const addLog = useCallback((message: string, type: LogEntry['type']) => {
    setLogs(prev => [{ timestamp: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 30));
  }, []);

  const handleConnect = async () => {
    microNir.setSimulation(false);
    const success = await microNir.connect();
    if (success) {
      setIsConnected(true);
      setSimulationMode(false);
      addLog("Hardware MicroNIR vinculado. Listo para calibración.", "success");
    } else {
      addLog("Fallo de detección USB. Verifique cable o drivers.", "error");
    }
  };

  const toggleSimulation = () => {
    const newState = !simulationMode;
    setSimulationMode(newState);
    microNir.setSimulation(newState);
    setIsConnected(newState);
    setSignalError(null);
    addLog(newState ? "SIMULACIÓN: Datos sintéticos activos." : "Hardware real activado.", "warning");
  };

  const toggleLamp = async () => {
    const nextOn = lampStatus !== 'ok';
    const ok = await microNir.setLamp(nextOn);
    if (ok) {
      setLampStatus(nextOn ? 'ok' : 'off');
      addLog(`Lámpara: ${nextOn ? 'ENCENDIDA' : 'APAGADA'}`, "info");
    } else {
      addLog("Error al conmutar lámpara.", "error");
    }
  };

  const runCalibration = async (type: 'dark' | 'reference') => {
    setIsMeasuring(true);
    setSignalError(null);
    addLog(`Capturando ${type.toUpperCase()}...`, "info");
    
    const raw = await microNir.readSpectrum();
    if (raw) {
      // Validar si la señal es nula (todo ceros)
      const isNull = raw.every(v => v === 0);
      if (isNull && !simulationMode) {
        setSignalError(`Señal ${type} nula. Reinicie sensor.`);
        addLog(`Error: El sensor devolvió ceros en ${type}.`, "error");
      } else {
        setCalib(prev => {
          const next = { ...prev, [type]: Array.from(raw) };
          next.step = (type === 'dark' && prev.reference) || (type === 'reference' && prev.dark) ? 'ready' : type;
          return next;
        });
        addLog(`${type.toUpperCase()} capturado correctamente.`, "success");
      }
    }
    setIsMeasuring(false);
  };

  const runScan = async () => {
    if (calib.step !== 'ready' && !simulationMode) {
      addLog("Calibración requerida antes de medir.", "error");
      return;
    }

    setIsMeasuring(true);
    setSignalError(null);
    addLog("Escaneando muestra...", "info");
    
    const raw = await microNir.readSpectrum();
    if (raw) {
      const sample = Array.from(raw);
      const EPSILON = 0.000001; // Evita división por cero

      const absData = sample.map((s, i) => {
        const d = calib.dark?.[i] || 0;
        const r = calib.reference?.[i] || 65535;
        
        // El núcleo del cálculo de Absorbancia: -log10((S-D)/(R-D))
        const divisor = Math.max(r - d, EPSILON);
        const dividendo = Math.max(s - d, EPSILON);
        const refl = Math.min(Math.max(dividendo / divisor, 0.0001), 1.0);
        
        const absorbance = -Math.log10(refl);
        return isNaN(absorbance) ? 0 : absorbance;
      });

      const formatted = CDM_MODEL.wavelengths.map((nm, i) => ({
        nm,
        absorbance: absData[i] || 0
      }));

      // Predicción PLS
      let sum = CDM_MODEL.bias;
      let hasValidData = true;

      absData.forEach((val, i) => {
        if (CDM_MODEL.betaCoefficients[i] !== undefined) {
          const contrib = val * CDM_MODEL.betaCoefficients[i];
          if (isNaN(contrib)) hasValidData = false;
          sum += contrib;
        }
      });

      if (!hasValidData || isNaN(sum)) {
        setPrediction(null);
        setSignalError("Datos incoherentes (NaN). Recalibre DARK/REF.");
        addLog("Fallo matemático: Resultado NaN detectado.", "error");
      } else {
        const finalPred = sum.toFixed(2);
        setSpectralData(formatted);
        setPrediction(finalPred);
        setSignalError(null);
        addLog(`Medición exitosa: ${finalPred}%`, "success");
        getAIInterpretation(formatted, finalPred, lampStatus).then(setAiInsight);
      }
    } else {
      addLog("Error de lectura física del sensor.", "error");
    }
    setIsMeasuring(false);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-4 lg:p-8 font-sans">
      
      {/* HEADER */}
      <nav className="glass-panel p-6 rounded-[2.5rem] mb-8 flex flex-col md:flex-row justify-between items-center border-white/5 shadow-2xl">
        <div className="flex items-center gap-5">
          <div className="relative bg-slate-900 p-4 rounded-2xl border border-white/10">
            <Cpu size={28} className={isConnected ? 'text-emerald-400' : 'text-blue-400'} />
          </div>
          <div>
            <h1 className="text-2xl font-black italic tracking-tighter text-white">QUANTUM NIR</h1>
            <p className="text-slate-500 text-[10px] font-bold tracking-[0.3em] uppercase">Control de Hardware Pro</p>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4 md:mt-0">
          <button onClick={toggleSimulation} className={`px-5 py-2.5 rounded-full text-xs font-bold border transition-all ${simulationMode ? 'bg-orange-500/10 border-orange-500/50 text-orange-400' : 'bg-slate-800/50 border-white/5 text-slate-500'}`}>
            <Settings2 size={14} className="inline mr-2" /> SIMULADOR
          </button>
          
          {!isConnected ? (
            <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-full font-black text-sm flex items-center gap-3 transition-all">
              <Usb size={18} /> ENLAZAR SENSOR
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-slate-900/50 p-1.5 rounded-full border border-white/5">
              <button onClick={toggleLamp} className={`px-6 py-2 rounded-full font-bold text-xs transition-all ${lampStatus === 'ok' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                {lampStatus === 'ok' ? <Lightbulb size={14} className="animate-pulse" /> : <ZapOff size={14} />}
                {lampStatus === 'ok' ? 'ON' : 'OFF'}
              </button>
              <div className="px-5 py-2 text-emerald-400 font-bold text-xs flex items-center gap-2">
                <ShieldCheck size={14} /> ONLINE
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* PANEL IZQUIERDO: CALIBRACIÓN Y LOGS */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <FlaskConical size={14} className="text-blue-400" /> Protocolo de Referencia
            </h3>
            
            <div className="space-y-3">
              <button
                disabled={!isConnected || isMeasuring}
                onClick={() => runCalibration('dark')}
                className={`w-full p-4 rounded-3xl border text-left flex items-center justify-between transition-all ${calib.dark ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900/40 border-white/5'}`}
              >
                <div className="flex items-center gap-4">
                  <Moon size={20} className={calib.dark ? 'text-emerald-400' : 'text-slate-500'} />
                  <div>
                    <p className="text-xs font-black uppercase">Dark Scan</p>
                    <p className="text-[9px] text-slate-500">Lámpara OFF</p>
                  </div>
                </div>
                {calib.dark && <CheckCircle2 size={18} className="text-emerald-400" />}
              </button>

              <button
                disabled={!isConnected || isMeasuring}
                onClick={() => runCalibration('reference')}
                className={`w-full p-4 rounded-3xl border text-left flex items-center justify-between transition-all ${calib.reference ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900/40 border-white/5'}`}
              >
                <div className="flex items-center gap-4">
                  <Sun size={20} className={calib.reference ? 'text-emerald-400' : 'text-slate-500'} />
                  <div>
                    <p className="text-xs font-black uppercase">Ref. Scan</p>
                    <p className="text-[9px] text-slate-500">Lámpara ON (Blanco)</p>
                  </div>
                </div>
                {calib.reference && <CheckCircle2 size={18} className="text-emerald-400" />}
              </button>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-[2.5rem] border-white/5 h-[400px] flex flex-col">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Terminal size={14} /> Consola de Depuración
            </h3>
            <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-2 pr-2 custom-scrollbar">
              {logs.map((log, i) => (
                <div key={i} className={`flex gap-3 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-blue-400'}`}>
                  <span className="text-slate-600 shrink-0">{log.timestamp}</span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* PANEL DERECHO: RESULTADOS E IA */}
        <main className="lg:col-span-8 space-y-8">
          
          <div className="glass-panel p-10 rounded-[3rem] border-white/5 relative">
            <div className="flex justify-between items-start mb-10">
              <div>
                <h2 className="text-3xl font-black italic tracking-tighter flex items-center gap-3">
                  <Activity className="text-blue-500" size={32} /> Datos Espectrales
                </h2>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-2">Sensor MicroNIR On-Site-W</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black text-slate-500 uppercase mb-1 tracking-widest">Proteína Est. (%)</p>
                <div className={`text-6xl font-black transition-colors ${signalError ? 'text-red-500 animate-pulse' : 'text-emerald-400'}`}>
                  {signalError ? 'ERR' : (prediction || '--.--')}
                </div>
              </div>
            </div>

            {signalError && (
              <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-2xl mb-6 flex items-center gap-3 text-red-400 text-xs font-bold">
                <AlertTriangle size={18} />
                {signalError}
              </div>
            )}

            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectralData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.2} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={11} tickFormatter={(v) => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px' }} />
                  <Area type="monotone" dataKey="absorbance" stroke="#3b82f6" fill="#3b82f610" strokeWidth={4} animationDuration={600} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <button
              disabled={!isConnected || isMeasuring || (calib.step !== 'ready' && !simulationMode)}
              onClick={runScan}
              className="w-full mt-8 bg-white text-black font-black py-6 rounded-[2rem] transition-all hover:bg-blue-600 hover:text-white disabled:opacity-20 active:scale-95 flex items-center justify-center gap-4 shadow-xl"
            >
              {isMeasuring ? <RefreshCw className="animate-spin" /> : <Play size={24} fill="currentColor" />}
              <span className="text-xl italic tracking-tighter uppercase">Iniciar Escaneo NIR</span>
            </button>
          </div>

          {aiInsight && (
            <div className="glass-panel p-8 rounded-[2.5rem] border-indigo-500/20 bg-indigo-500/5 animate-in slide-in-from-bottom-5">
              <div className="flex items-center gap-4 mb-4">
                <BrainCircuit className="text-indigo-400" size={24} />
                <h4 className="text-sm font-black text-white uppercase tracking-widest italic">Diagnóstico de Inteligencia Artificial</h4>
              </div>
              <p className="text-slate-300 leading-relaxed text-sm italic bg-slate-950/40 p-6 rounded-3xl border border-white/5 shadow-inner">
                "{aiInsight}"
              </p>
            </div>
          )}
        </main>
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default App;
