
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
    const nextSimState = !simulationMode;
    setSimulationMode(nextSimState);
    microNir.setSimulation(nextSimState);
    
    // Si desactivamos simulación, comprobamos si el hardware real sigue conectado
    if (!nextSimState) {
      const hardwareStillThere = microNir.isHardwareReady;
      setIsConnected(hardwareStillThere);
      if (!hardwareStillThere) {
        addLog("Hardware real no detectado. Reenlace el sensor.", "warning");
      } else {
        addLog("Hardware real reactivado.", "success");
      }
    } else {
      setIsConnected(true);
      addLog("SIMULACIÓN: Datos sintéticos activos.", "warning");
    }
    
    setSignalError(null);
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
      const isNull = raw.every(v => v === 0);
      if (isNull && !simulationMode) {
        setSignalError(`Señal ${type} nula. Reinicie sensor.`);
        addLog(`Error: El sensor devolvió ceros en ${type}.`, "error");
      } else {
        setCalib(prev => {
          const next = { ...prev, [type]: Array.from(raw) };
          const hasBoth = (type === 'dark' && !!prev.reference) || (type === 'reference' && !!prev.dark);
          next.step = hasBoth ? 'ready' : type;
          return next;
        });
        addLog(`${type.toUpperCase()} capturado correctamente.`, "success");
      }
    } else {
      addLog(`Fallo al leer ${type}. Verifique conexión.`, "error");
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
      const EPSILON = 0.000001;

      const absData = sample.map((s, i) => {
        const d = calib.dark?.[i] || 0;
        const r = calib.reference?.[i] || 65535;
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

  const isScanDisabled = !isConnected || isMeasuring || (calib.step !== 'ready' && !simulationMode);

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
          <button 
            onClick={toggleSimulation} 
            className={`px-5 py-2.5 rounded-full text-xs font-bold border transition-all ${simulationMode ? 'bg-orange-500/10 border-orange-500/50 text-orange-400' : 'bg-slate-800/50 border-white/5 text-slate-500'}`}
          >
            <Settings2 size={14} className="inline mr-2" /> 
            {simulationMode ? 'MODO SIMULACIÓN' : 'MODO REAL'}
          </button>
          
          {!isConnected ? (
            <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-full font-black text-sm flex items-center gap-3 transition-all">
              <Usb size={18} /> ENLAZAR SENSOR
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-slate-900/50 p-1.5 rounded-full border border-white/5">
              <button onClick={toggleLamp} className={`px-6 py-2 rounded-full font-bold text-xs transition-all ${lampStatus === 'ok' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                {lampStatus === 'ok' ? <Lightbulb size={14} className="animate-pulse mr-2" /> : <ZapOff size={14} className="mr-2" />}
                LÁMPARA: {lampStatus === 'ok' ? 'ON' : 'OFF'}
              </button>
              <div className="px-5 py-2 text-emerald-400 font-bold text-xs flex items-center gap-2">
                <ShieldCheck size={14} /> ONLINE
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* PANEL IZQUIERDO */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5 shadow-xl">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <FlaskConical size={14} className="text-blue-400" /> Protocolo de Calibración
            </h3>
            
            <div className="space-y-4">
              <button
                disabled={!isConnected || isMeasuring}
                onClick={() => runCalibration('dark')}
                className={`w-full p-5 rounded-3xl border text-left flex items-center justify-between transition-all hover:scale-[1.02] ${calib.dark ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-slate-900/60 border-white/5'}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl ${calib.dark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                    <Moon size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-tight">Escaneo Dark</p>
                    <p className="text-[9px] text-slate-500 font-bold uppercase">Sin luz (0% Ref)</p>
                  </div>
                </div>
                {calib.dark && <CheckCircle2 size={20} className="text-emerald-400" />}
              </button>

              <button
                disabled={!isConnected || isMeasuring}
                onClick={() => runCalibration('reference')}
                className={`w-full p-5 rounded-3xl border text-left flex items-center justify-between transition-all hover:scale-[1.02] ${calib.reference ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-slate-900/60 border-white/5'}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl ${calib.reference ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-600'}`}>
                    <Sun size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-tight">Escaneo Blanco</p>
                    <p className="text-[9px] text-slate-500 font-bold uppercase">Con luz (100% Ref)</p>
                  </div>
                </div>
                {calib.reference && <CheckCircle2 size={20} className="text-emerald-400" />}
              </button>
            </div>

            {!simulationMode && calib.step !== 'ready' && isConnected && (
              <p className="mt-6 text-[10px] text-orange-400/70 font-bold uppercase flex items-center gap-2 bg-orange-400/5 p-3 rounded-xl border border-orange-400/20">
                <AlertCircle size={12} /> Requiere Dark y Ref para activar Escaneo
              </p>
            )}
          </div>

          <div className="glass-panel p-6 rounded-[2.5rem] border-white/5 h-[400px] flex flex-col shadow-inner">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Terminal size={14} /> Terminal de Eventos
            </h3>
            <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-2 pr-2 custom-scrollbar">
              {logs.map((log, i) => (
                <div key={i} className={`flex gap-3 p-2 rounded-lg ${log.type === 'error' ? 'bg-red-500/5 text-red-400' : log.type === 'success' ? 'bg-emerald-500/5 text-emerald-400' : 'text-blue-400'}`}>
                  <span className="text-slate-600 font-bold shrink-0">{log.timestamp}</span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* PANEL DERECHO */}
        <main className="lg:col-span-8 space-y-8">
          
          <div className="glass-panel p-10 rounded-[3rem] border-white/5 relative shadow-2xl overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-emerald-500 to-blue-600 opacity-50"></div>
            
            <div className="flex flex-col md:flex-row justify-between items-start mb-10 gap-6">
              <div>
                <h2 className="text-3xl font-black italic tracking-tighter flex items-center gap-3 text-white">
                  <Activity className="text-blue-500" size={32} /> ANÁLISIS EN TIEMPO REAL
                </h2>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mt-2">Tecnología de Red de Sensores Cuánticos</p>
              </div>
              <div className="bg-slate-900/50 p-6 rounded-[2rem] border border-white/5 min-w-[200px] text-center">
                <p className="text-[10px] font-black text-slate-500 uppercase mb-2 tracking-widest">Proteína (%)</p>
                <div className={`text-6xl font-black transition-all ${signalError ? 'text-red-500 scale-95' : 'text-emerald-400'}`}>
                  {signalError ? 'ERROR' : (prediction || '--.--')}
                </div>
              </div>
            </div>

            {signalError && (
              <div className="bg-red-500/10 border border-red-500/30 p-5 rounded-3xl mb-8 flex items-center gap-4 text-red-400 text-sm font-bold animate-pulse">
                <AlertTriangle size={24} />
                <div>
                  <p className="uppercase text-[10px]">Error de Integridad de Señal</p>
                  <p>{signalError}</p>
                </div>
              </div>
            )}

            <div className="h-[380px] w-full bg-slate-950/30 rounded-[2rem] p-4 border border-white/5">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectralData}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.1} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={11} tickFormatter={(v) => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '16px', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)' }} />
                  <Area type="monotone" dataKey="absorbance" stroke="#3b82f6" fillOpacity={1} fill="url(#colorAbs)" strokeWidth={4} animationDuration={1000} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <button
              disabled={isScanDisabled}
              onClick={runScan}
              className={`w-full mt-10 py-7 rounded-[2rem] transition-all flex items-center justify-center gap-5 shadow-2xl relative group ${
                isScanDisabled 
                ? 'bg-slate-800 text-slate-600 opacity-40 cursor-not-allowed' 
                : 'bg-white text-black hover:bg-blue-600 hover:text-white active:scale-[0.98]'
              }`}
            >
              {isMeasuring ? (
                <RefreshCw className="animate-spin" size={28} />
              ) : (
                <Play size={28} fill="currentColor" className="group-hover:scale-110 transition-transform" />
              )}
              <span className="text-2xl font-black italic tracking-tighter uppercase">
                {isMeasuring ? 'Procesando...' : 'Iniciar Escaneo NIR'}
              </span>
            </button>
          </div>

          {aiInsight && (
            <div className="glass-panel p-8 rounded-[3rem] border-indigo-500/20 bg-indigo-500/5 animate-in slide-in-from-bottom-8 shadow-2xl">
              <div className="flex items-center gap-4 mb-6">
                <div className="bg-indigo-500/20 p-3 rounded-2xl">
                  <BrainCircuit className="text-indigo-400" size={24} />
                </div>
                <h4 className="text-sm font-black text-white uppercase tracking-widest italic">Diagnóstico Inteligente</h4>
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
