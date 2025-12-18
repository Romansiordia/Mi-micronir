
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { 
  Usb, Activity, AlertCircle, CheckCircle2, 
  Play, RefreshCw, Lightbulb, ZapOff,
  Cpu, Terminal, BrainCircuit, ShieldCheck,
  Moon, Sun, Gauge, Send, FlaskConical,
  Settings2, Info, AlertTriangle, History, Trash2, TrendingUp,
  Database, Zap
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
  const [signalError, setSignalError] = useState<string | null>(null);

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
    microNir.setSimulation(false);
    const success = await microNir.connect();
    if (success) {
      setIsConnected(true);
      setSimulationMode(false);
      addLog("HARDWARE REAL: MicroNIR USB conectado y listo.", "success");
    } else {
      addLog("USB: No se encontró el dispositivo 0x0403.", "error");
    }
  };

  const toggleSimulation = () => {
    const nextSimState = !simulationMode;
    setSimulationMode(nextSimState);
    microNir.setSimulation(nextSimState);
    if (!nextSimState) {
      const hardwareStillThere = microNir.isHardwareReady;
      setIsConnected(hardwareStillThere);
      addLog(hardwareStillThere ? "SISTEMA: Cambiado a Sensor Físico." : "ADVERTENCIA: Sensor Físico desconectado.", hardwareStillThere ? "info" : "warning");
    } else {
      setIsConnected(true);
      addLog("SISTEMA: Modo Simulación (Datos Sintéticos).", "warning");
    }
  };

  const toggleLamp = async () => {
    const nextOn = lampStatus !== 'ok';
    const ok = await microNir.setLamp(nextOn);
    if (ok) {
      setLampStatus(nextOn ? 'ok' : 'off');
      addLog(`LAMP: Comandado ${nextOn ? 'ON' : 'OFF'} vía USB`, "info");
    }
  };

  const runCalibration = async (type: 'dark' | 'reference') => {
    if (!isConnected && !simulationMode) {
      addLog("Conecte el sensor antes de calibrar.", "error");
      return;
    }

    setIsMeasuring(true);
    const sourceTag = simulationMode ? "[SIM]" : "[HW]";
    addLog(`${sourceTag} Iniciando captura de ${type.toUpperCase()}...`, "info");
    
    try {
      // Para Dark Scan en hardware real, usualmente se apaga la lámpara o se usa tapón negro
      const raw = await microNir.readSpectrum();
      
      if (raw) {
        setCalib(prev => {
          const next = { ...prev, [type]: Array.from(raw) };
          const hasBoth = (type === 'dark' && !!prev.reference) || (type === 'reference' && !!prev.dark);
          next.step = hasBoth ? 'ready' : type;
          return next;
        });
        addLog(`${sourceTag} Calibración ${type.toUpperCase()} guardada con éxito.`, "success");
      } else {
        addLog(`${sourceTag} Error: No se recibieron datos del sensor para ${type}.`, "error");
      }
    } catch (err) {
      addLog(`Fallo crítico en calibración ${type}: ${err}`, "error");
    } finally {
      setIsMeasuring(false);
    }
  };

  const runScan = async () => {
    if (calib.step !== 'ready' && !simulationMode) {
      addLog("BLOQUEO: Calibración necesaria (Dark y White).", "error");
      return;
    }
    setIsMeasuring(true);
    const isReal = !simulationMode;
    const sourceTag = isReal ? "[HW]" : "[SIM]";
    
    const raw = await microNir.readSpectrum();
    if (raw) {
      const sample = Array.from(raw);
      const absData = sample.map((s, i) => {
        const d = calib.dark?.[i] || 0;
        const r = calib.reference?.[i] || 65535;
        // Cálculo de Absorbancia: -log10((Muestra - Dark) / (Referencia - Dark))
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
      setSpectralData(CDM_MODEL.wavelengths.map((nm, i) => ({ nm, absorbance: absData[i] })));
      addLog(`${sourceTag} Medición: ${val}%`, isReal ? "success" : "warning");
      getAIInterpretation(spectralData, val.toString(), lampStatus).then(setAiInsight);
    }
    setIsMeasuring(false);
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
              {simulationMode ? 'MODO LABORATORIO VIRTUAL' : 'CONTROL HARDWARE ACTIVO'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4 md:mt-0">
          <button onClick={toggleSimulation} className={`px-5 py-2.5 rounded-full text-xs font-bold border transition-all ${simulationMode ? 'bg-orange-500/20 border-orange-500/50 text-orange-400' : 'bg-slate-800/50 border-white/5 text-slate-500'}`}>
            <Settings2 size={14} className="inline mr-2" />
            {simulationMode ? 'SIMULACIÓN' : 'HARDWARE REAL'}
          </button>
          
          {!isConnected ? (
            <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-full font-black text-sm flex items-center gap-3 shadow-lg shadow-blue-500/20 transition-all">
              <Usb size={18} /> VINCULAR EQUIPO
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-slate-900/50 p-1.5 rounded-full border border-white/5">
              <button onClick={toggleLamp} className={`px-6 py-2 rounded-full font-bold text-xs transition-all ${lampStatus === 'ok' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' : 'bg-slate-800 text-slate-500'}`}>
                {lampStatus === 'ok' ? 'LÁMPARA ON' : 'LÁMPARA OFF'}
              </button>
              <div className="px-5 py-2 text-emerald-400 font-bold text-xs flex items-center gap-2">
                <Database size={14} /> {simulationMode ? 'SIM-ID-0' : 'USB-FTDI-0403'}
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <aside className="lg:col-span-4 space-y-6">
          {/* PANEL DE CALIBRACIÓN REINSTALADO */}
          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <FlaskConical size={14} className="text-blue-400" /> Protocolo de Calibración
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <button 
                disabled={!isConnected || isMeasuring} 
                onClick={() => runCalibration('dark')} 
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${calib.dark ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900/60 border-white/5 text-slate-400 hover:border-blue-500/50'}`}
              >
                <div className="flex items-center gap-3">
                  <Moon size={18} />
                  <div className="text-left">
                    <span className="text-[11px] font-black block uppercase">Escaneo Dark</span>
                    <p className="text-[8px] opacity-60">Ruido de fondo (sin luz)</p>
                  </div>
                </div>
                {calib.dark && <CheckCircle2 size={16} />}
              </button>

              <button 
                disabled={!isConnected || isMeasuring} 
                onClick={() => runCalibration('reference')} 
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${calib.reference ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900/60 border-white/5 text-slate-400 hover:border-blue-500/50'}`}
              >
                <div className="flex items-center gap-3">
                  <Sun size={18} />
                  <div className="text-left">
                    <span className="text-[11px] font-black block uppercase">Escaneo White</span>
                    <p className="text-[8px] opacity-60">Referencia 100% (con luz)</p>
                  </div>
                </div>
                {calib.reference && <CheckCircle2 size={16} />}
              </button>
            </div>
            {!simulationMode && calib.step !== 'ready' && isConnected && (
              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center gap-2">
                <Info size={14} className="text-blue-400" />
                <p className="text-[9px] font-bold text-blue-300 uppercase">Se requiere completar ambos pasos</p>
              </div>
            )}
          </div>

          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <Zap size={14} className="text-blue-400" /> Diagnóstico de Señal
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between text-[10px] font-bold">
                <span className="text-slate-500">INTENSIDAD ÓPTICA</span>
                <span className={isConnected ? 'text-emerald-400' : 'text-slate-600'}>{isConnected ? '94%' : '0%'}</span>
              </div>
              <div className="h-2 bg-slate-900 rounded-full overflow-hidden border border-white/5">
                <div 
                  className={`h-full transition-all duration-500 ${simulationMode ? 'bg-orange-500' : 'bg-emerald-500'}`} 
                  style={{ width: isConnected ? '94%' : '0%' }}
                ></div>
              </div>
              <p className="text-[9px] text-slate-600 italic">
                {simulationMode ? 'Usando generador de ruido blanco matemático.' : 'Leyendo fotones reales desde arreglo InGaAs.'}
              </p>
            </div>
          </div>

          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5 bg-blue-500/5">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <History size={14} className="text-blue-400" /> Sesión Actual
              </h3>
              <button onClick={() => setScanHistory([])} className="text-slate-600 hover:text-red-400 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-900/80 p-4 rounded-2xl border border-white/5">
                <p className="text-[9px] font-bold text-slate-500 uppercase">Media</p>
                <p className="text-2xl font-black text-white">{stats.avg}%</p>
              </div>
              <div className="bg-slate-900/80 p-4 rounded-2xl border border-white/5">
                <p className="text-[9px] font-bold text-slate-500 uppercase">Estabilidad</p>
                <p className={`text-2xl font-black ${parseFloat(stats.cv) > 5 ? 'text-orange-400' : 'text-emerald-400'}`}>
                  {stats.cv}%
                </p>
              </div>
            </div>

            <div className="space-y-2 max-h-[150px] overflow-y-auto pr-2 custom-scrollbar">
              {scanHistory.map((h, i) => (
                <div key={i} className={`flex justify-between items-center p-3 rounded-xl border ${h.isReal ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-orange-500/5 border-orange-500/20'} text-[11px]`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${h.isReal ? 'bg-emerald-500' : 'bg-orange-500'}`}></span>
                    <span className="text-slate-500 font-mono">#{scanHistory.length - i}</span>
                  </div>
                  <span className="font-bold text-white">{h.val.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="lg:col-span-8 space-y-8">
          <div className="glass-panel p-10 rounded-[3rem] border-white/5 relative shadow-2xl overflow-hidden">
            <div className="flex flex-col md:flex-row justify-between items-start mb-10 gap-6">
              <div>
                <h2 className="text-3xl font-black italic tracking-tighter text-white flex items-center gap-3">
                  <Activity className="text-blue-500" /> ANÁLISIS
                </h2>
                <div className="flex gap-2 mt-2">
                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${!simulationMode ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}`}>
                    {simulationMode ? 'DATOS SIMULADOS' : 'DATOS SENSOR FÍSICO'}
                  </span>
                </div>
              </div>
              <div className="bg-slate-900/50 p-6 rounded-[2rem] border border-white/5 min-w-[200px] text-center shadow-inner relative">
                <p className="text-[9px] font-black text-slate-500 uppercase mb-1">PROTEÍNA CALCULADA</p>
                <div className={`text-6xl font-black transition-all ${parseFloat(stats.cv) > 10 ? 'text-orange-500' : 'text-emerald-400'}`}>
                  {prediction || '--.--'}<span className="text-xl ml-1 opacity-40">%</span>
                </div>
              </div>
            </div>

            <div className="h-[350px] w-full bg-slate-950/30 rounded-[2rem] p-4 border border-white/5 mb-8">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectralData}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={simulationMode ? "#f97316" : "#3b82f6"} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={simulationMode ? "#f97316" : "#3b82f6"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.1} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={11} tickFormatter={(v) => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '16px' }} />
                  <Area type="monotone" dataKey="absorbance" stroke={simulationMode ? "#f97316" : "#3b82f6"} fillOpacity={1} fill="url(#colorAbs)" strokeWidth={4} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <button
              disabled={!isConnected || isMeasuring || (calib.step !== 'ready' && !simulationMode)}
              onClick={runScan}
              className={`w-full py-8 rounded-[2rem] transition-all flex items-center justify-center gap-5 shadow-2xl relative group ${
                (!isConnected || isMeasuring || (calib.step !== 'ready' && !simulationMode))
                ? 'bg-slate-800 text-slate-600 opacity-40' 
                : 'bg-white text-black hover:bg-blue-600 hover:text-white active:scale-[0.98]'
              }`}
            >
              {isMeasuring ? <RefreshCw className="animate-spin" size={28} /> : <Play size={28} fill="currentColor" />}
              <span className="text-2xl font-black italic tracking-tighter uppercase">Disparo Sensor NIR</span>
            </button>
          </div>

          {aiInsight && (
            <div className="glass-panel p-8 rounded-[3rem] border-indigo-500/20 bg-indigo-500/5">
              <div className="flex items-center gap-4 mb-4">
                <BrainCircuit className="text-indigo-400" size={20} />
                <h4 className="text-xs font-black text-white uppercase tracking-widest italic">Análisis del Historial</h4>
              </div>
              <p className="text-slate-300 leading-relaxed text-sm italic bg-slate-950/40 p-6 rounded-3xl border border-white/5">
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
