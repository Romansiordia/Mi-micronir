
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { 
  Usb, Activity, AlertCircle, CheckCircle2, 
  Play, RefreshCw, Lightbulb, ZapOff,
  Cpu, Terminal, BrainCircuit, ShieldCheck,
  Moon, Sun, Gauge, Send, FlaskConical,
  Settings2, Info, AlertTriangle, History, Trash2, TrendingUp,
  Database, Zap, XCircle
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
  const [scanHistory, setScanHistory] = useState<{val: number, isReal: boolean}[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (scanHistory.length === 0) return { avg: 0, std: 0, cv: 0 };
    const values = scanHistory.map(h => h.val);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    const std = Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
    return { avg: avg.toFixed(2), std: std.toFixed(2), cv: ((std / avg) * 100).toFixed(1) };
  }, [scanHistory]);

  const addLog = useCallback((message: string, type: LogEntry['type']) => {
    setLogs(prev => [{ timestamp: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 30));
  }, []);

  const handleConnect = async () => {
    addLog("USB: Solicitando acceso al hardware...", "info");
    microNir.setSimulation(false);
    const success = await microNir.connect();
    if (success) {
      setIsConnected(true);
      setSimulationMode(false);
      addLog("HARDWARE REAL: MicroNIR vinculado y canal de datos abierto.", "success");
    } else {
      addLog("USB: Error al reclamar interfaz. Asegúrese de que ninguna otra app use el sensor.", "error");
    }
  };

  const toggleSimulation = () => {
    const nextSimState = !simulationMode;
    setSimulationMode(nextSimState);
    microNir.setSimulation(nextSimState);
    if (!nextSimState) {
      const hardwareStillThere = microNir.isHardwareReady;
      setIsConnected(hardwareStillThere);
      addLog(hardwareStillThere ? "SISTEMA: Conexión recuperada con el sensor físico." : "MODO REAL: No se detecta sensor conectado.", hardwareStillThere ? "info" : "warning");
    } else {
      setIsConnected(true);
      addLog("SISTEMA: Entrando en modo de simulación segura.", "warning");
    }
  };

  const toggleLamp = async () => {
    const nextOn = lampStatus !== 'ok';
    addLog(`LAMP: Enviando comando ${nextOn ? 'ON' : 'OFF'}...`, "info");
    const ok = await microNir.setLamp(nextOn);
    if (ok) {
      setLampStatus(nextOn ? 'ok' : 'off');
      addLog(`LAMP: Confirmación de hardware recibida.`, "success");
    } else {
      addLog("LAMP: El hardware no respondió al comando de luz.", "error");
    }
  };

  const runCalibration = async (type: 'dark' | 'reference') => {
    if (!isConnected && !simulationMode) {
      addLog("BLOQUEO: Debe vincular el equipo antes de calibrar.", "error");
      return;
    }

    setIsMeasuring(true);
    const sourceTag = simulationMode ? "[SIM]" : "[HW]";
    addLog(`${sourceTag} Capturando ${type.toUpperCase()}... No mueva el sensor.`, "info");
    
    try {
      const raw = await microNir.readSpectrum();
      
      if (raw && raw.length > 0) {
        setCalib(prev => {
          const next = { ...prev, [type]: Array.from(raw) };
          const hasBoth = (type === 'dark' && !!prev.reference) || (type === 'reference' && !!prev.dark);
          next.step = hasBoth ? 'ready' : type;
          return next;
        });
        addLog(`${sourceTag} ${type.toUpperCase()} guardado correctamente (${raw.length} puntos).`, "success");
      } else {
        addLog(`${sourceTag} ERROR: El sensor devolvió un paquete vacío o inválido.`, "error");
      }
    } catch (err) {
      addLog(`ERROR CRÍTICO: ${err}`, "error");
    } finally {
      setIsMeasuring(false);
    }
  };

  const runScan = async () => {
    if (calib.step !== 'ready' && !simulationMode) {
      addLog("CALIBRACIÓN PENDIENTE: Realice Dark y White scan primero.", "warning");
      return;
    }
    setIsMeasuring(true);
    const isReal = !simulationMode;
    const sourceTag = isReal ? "[HW]" : "[SIM]";
    
    try {
      const raw = await microNir.readSpectrum();
      if (raw && raw.length > 0) {
        const sample = Array.from(raw);
        const absData = sample.map((s, i) => {
          const d = calib.dark?.[i] || 0;
          const r = calib.reference?.[i] || 65535;
          const refl = Math.min(Math.max((s - d) / Math.max(r - d, 1), 0.0001), 1.0);
          return -Math.log10(refl);
        });

        let sum = CDM_MODEL.bias;
        absData.forEach((val, i) => {
          if (CDM_MODEL.betaCoefficients[i] !== undefined) {
            sum += val * CDM_MODEL.betaCoefficients[i];
          }
        });

        const val = parseFloat(sum.toFixed(2));
        setPrediction(val.toString());
        setScanHistory(prev => [{val, isReal}, ...prev].slice(0, 10));
        
        // Fix: Use local variable to avoid stale state in the AI interpretation call
        const currentSpectralData = CDM_MODEL.wavelengths.map((nm, i) => ({ nm, absorbance: absData[i] }));
        setSpectralData(currentSpectralData);
        addLog(`${sourceTag} Medición exitosa: ${val}%`, isReal ? "success" : "warning");
        
        // Fix: Await or handle the AI call with the current data directly
        getAIInterpretation(currentSpectralData, val.toString(), lampStatus).then(setAiInsight);
      } else {
        addLog(`${sourceTag} Error: No se pudo obtener el espectro de la muestra.`, "error");
      }
    } catch (e) {
      addLog(`Fallo en escaneo: ${e}`, "error");
    } finally {
      setIsMeasuring(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-4 lg:p-8 font-sans">
      <nav className="glass-panel p-6 rounded-[2.5rem] mb-8 flex flex-col md:flex-row justify-between items-center border-white/5 shadow-2xl">
        <div className="flex items-center gap-5">
          <div className="relative bg-slate-900 p-4 rounded-2xl border border-white/10">
            <Cpu size={28} className={isConnected ? (simulationMode ? 'text-orange-400' : 'text-emerald-400') : 'text-blue-400'} />
            {!simulationMode && isConnected && <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full animate-ping"></div>}
          </div>
          <div>
            <h1 className="text-2xl font-black italic tracking-tighter text-white uppercase">Quantum NIR</h1>
            <p className="text-slate-500 text-[10px] font-bold tracking-[0.3em] uppercase">
              {simulationMode ? 'LABORATORIO VIRTUAL' : isConnected ? 'SENSOR FÍSICO CONECTADO' : 'ESPERANDO HARDWARE'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4 md:mt-0">
          <button onClick={toggleSimulation} className={`px-5 py-2.5 rounded-full text-xs font-bold border transition-all ${simulationMode ? 'bg-orange-500/20 border-orange-500/50 text-orange-400' : 'bg-slate-800/50 border-white/5 text-slate-500'}`}>
            <Settings2 size={14} className="inline mr-2" />
            {simulationMode ? 'MODO SIMULACIÓN' : 'MODO HARDWARE'}
          </button>
          
          {!isConnected && !simulationMode ? (
            <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-full font-black text-sm flex items-center gap-3 shadow-lg shadow-blue-500/20 transition-all animate-pulse">
              <Usb size={18} /> VINCULAR EQUIPO
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-slate-900/50 p-1.5 rounded-full border border-white/5">
              <button 
                disabled={simulationMode}
                onClick={toggleLamp} 
                className={`px-6 py-2 rounded-full font-bold text-xs transition-all ${lampStatus === 'ok' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' : 'bg-slate-800 text-slate-500'}`}
              >
                {lampStatus === 'ok' ? 'LÁMPARA ON' : 'LÁMPARA OFF'}
              </button>
              <div className="px-5 py-2 text-emerald-400 font-bold text-xs flex items-center gap-2">
                <Database size={14} /> {simulationMode ? 'DATA-VIRTUAL' : 'S/N: NIR-0403-X'}
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <aside className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <FlaskConical size={14} className="text-blue-400" /> Protocolo de Calibración
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <button 
                disabled={(!isConnected && !simulationMode) || isMeasuring} 
                onClick={() => runCalibration('dark')} 
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${calib.dark ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900/60 border-white/5 text-slate-400 hover:border-blue-500/50'}`}
              >
                <div className="flex items-center gap-3">
                  <Moon size={18} />
                  <div className="text-left">
                    <span className="text-[11px] font-black block uppercase">Escaneo Dark</span>
                    <p className="text-[8px] opacity-60">Sin luz / Tapa negra</p>
                  </div>
                </div>
                {calib.dark ? <CheckCircle2 size={16} /> : isMeasuring && <RefreshCw size={14} className="animate-spin" />}
              </button>

              <button 
                disabled={(!isConnected && !simulationMode) || isMeasuring} 
                onClick={() => runCalibration('reference')} 
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${calib.reference ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900/60 border-white/5 text-slate-400 hover:border-blue-500/50'}`}
              >
                <div className="flex items-center gap-3">
                  <Sun size={18} />
                  <div className="text-left">
                    <span className="text-[11px] font-black block uppercase">Escaneo White</span>
                    <p className="text-[8px] opacity-60">Estándar Blanco 99%</p>
                  </div>
                </div>
                {calib.reference ? <CheckCircle2 size={16} /> : isMeasuring && <RefreshCw size={14} className="animate-spin" />}
              </button>
            </div>
          </div>

          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Terminal size={14} className="text-blue-400" /> Consola de Sistema
            </h3>
            <div className="h-[250px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
              {logs.map((log, i) => (
                <div key={i} className={`text-[10px] p-2 rounded-lg border flex gap-2 ${
                  log.type === 'error' ? 'bg-red-500/5 border-red-500/20 text-red-400' : 
                  log.type === 'success' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' :
                  log.type === 'warning' ? 'bg-orange-500/5 border-orange-500/20 text-orange-400' :
                  'bg-slate-900/50 border-white/5 text-slate-400'
                }`}>
                  <span className="opacity-40 font-mono">[{log.timestamp}]</span>
                  <span className="font-medium">{log.message}</span>
                </div>
              ))}
              {logs.length === 0 && <p className="text-center text-slate-600 text-[10px] mt-10 italic">No hay actividad reciente...</p>}
            </div>
          </div>
        </aside>

        <main className="lg:col-span-8 space-y-8">
          <div className="glass-panel p-10 rounded-[3rem] border-white/5 relative shadow-2xl overflow-hidden">
            <div className="flex flex-col md:flex-row justify-between items-start mb-10 gap-6">
              <div>
                <h2 className="text-3xl font-black italic tracking-tighter text-white flex items-center gap-3 uppercase">
                  <Activity className="text-blue-500" /> Monitoreo Espectral
                </h2>
                <div className="flex gap-2 mt-2">
                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${!simulationMode && isConnected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-500 border border-white/5'}`}>
                    {simulationMode ? 'DATOS SINTÉTICOS' : isConnected ? 'HARDWARE ACTIVO' : 'SIN CONEXIÓN'}
                  </span>
                </div>
              </div>
              <div className="bg-slate-900/50 p-6 rounded-[2rem] border border-white/5 min-w-[240px] text-center shadow-inner relative">
                <p className="text-[9px] font-black text-slate-500 uppercase mb-1 tracking-widest">Proteína CDM v2.4</p>
                <div className={`text-6xl font-black transition-all ${parseFloat(stats.cv) > 8 ? 'text-orange-500' : 'text-emerald-400'}`}>
                  {prediction || '--.--'}<span className="text-xl ml-1 opacity-40">%</span>
                </div>
              </div>
            </div>

            <div className="h-[380px] w-full bg-slate-950/30 rounded-[2rem] p-4 border border-white/5 mb-8">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectralData}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={simulationMode ? "#f97316" : "#3b82f6"} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={simulationMode ? "#f97316" : "#3b82f6"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.1} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickFormatter={(v) => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={10} domain={[0, 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '16px', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="absorbance" stroke={simulationMode ? "#f97316" : "#3b82f6"} fillOpacity={1} fill="url(#colorAbs)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* AI Insights Display */}
            {aiInsight && (
              <div className="mb-8 p-6 bg-blue-500/10 border border-blue-500/30 rounded-[2rem] flex gap-4 transition-all">
                <BrainCircuit className="text-blue-400 shrink-0" size={24} />
                <div className="space-y-1">
                  <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Inteligencia Quantum Gemini</h4>
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{aiInsight}</p>
                </div>
              </div>
            )}

            <button
              disabled={(!isConnected && !simulationMode) || isMeasuring || (calib.step !== 'ready' && !simulationMode)}
              onClick={runScan}
              className={`w-full py-8 rounded-[2rem] transition-all flex items-center justify-center gap-5 shadow-2xl relative group ${
                ((!isConnected && !simulationMode) || isMeasuring || (calib.step !== 'ready' && !simulationMode))
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed' 
                : 'bg-white text-black hover:bg-emerald-500 hover:text-white active:scale-[0.98]'
              }`}
            >
              {isMeasuring ? <RefreshCw className="animate-spin" size={28} /> : <Play size={28} fill="currentColor" />}
              <span className="text-2xl font-black italic tracking-tighter uppercase">Disparo Analítico NIR</span>
            </button>
          </div>
        </main>
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
      `}</style>
    </div>
  );
};

export default App;
