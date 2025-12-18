
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { 
  Usb, Activity, AlertCircle, CheckCircle2, 
  Play, RefreshCw, Lightbulb, ZapOff,
  Cpu, Terminal, BrainCircuit, ShieldCheck,
  Moon, Sun, Gauge, Send, FlaskConical,
  Settings2, ChevronRight, Binary, Info
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
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
  const [rawCommand, setRawCommand] = useState("020103");
  const [calib, setCalib] = useState<CalibrationData>({ dark: null, reference: null, step: 'none' });
  const [spectralData, setSpectralData] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);

  const addLog = useCallback((message: string, type: LogEntry['type']) => {
    setLogs(prev => [{ timestamp: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 30));
  }, []);

  const handleConnect = async () => {
    microNir.setSimulation(false);
    const success = await microNir.connect();
    if (success) {
      setIsConnected(true);
      setSimulationMode(false);
      addLog("Hardware MicroNIR detectado y vinculado.", "success");
    } else {
      addLog("Fallo de detección USB. ¿Driver WinUSB instalado?", "error");
    }
  };

  const toggleSimulation = () => {
    const newState = !simulationMode;
    setSimulationMode(newState);
    microNir.setSimulation(newState);
    setIsConnected(newState);
    addLog(newState ? "Modo SIMULACIÓN activado." : "Modo Simulación desactivado.", newState ? "warning" : "info");
  };

  const toggleLamp = async () => {
    const nextOn = lampStatus !== 'ok';
    const ok = await microNir.setLamp(nextOn);
    if (ok) {
      setLampStatus(nextOn ? 'ok' : 'off');
      addLog(`Comando Lámpara: ${nextOn ? 'ON' : 'OFF'} enviado.`, "info");
    } else {
      addLog("El dispositivo no confirmó el estado de la lámpara.", "error");
    }
  };

  const runCalibration = async (type: 'dark' | 'reference') => {
    setIsMeasuring(true);
    addLog(`Iniciando captura de ${type.toUpperCase()}...`, "info");
    const raw = await microNir.readSpectrum();
    if (raw) {
      setCalib(prev => {
        const next = { ...prev, [type]: Array.from(raw) };
        next.step = (type === 'dark' && prev.reference) || (type === 'reference' && prev.dark) ? 'ready' : type;
        return next;
      });
      addLog(`${type.toUpperCase()} guardado en memoria volatil.`, "success");
    }
    setIsMeasuring(false);
  };

  const runScan = async () => {
    if (calib.step !== 'ready' && !simulationMode) {
      addLog("Calibración incompleta.", "error");
      return;
    }
    setIsMeasuring(true);
    addLog("Escaneando muestra...", "info");
    
    const raw = await microNir.readSpectrum();
    if (raw) {
      const sample = Array.from(raw);
      const absData = sample.map((s, i) => {
        const d = calib.dark?.[i] || 100;
        const r = calib.reference?.[i] || 60000;
        const refl = Math.max((s - d) / (r - d), 0.0001);
        return -Math.log10(refl);
      });

      const formatted = CDM_MODEL.wavelengths.map((nm, i) => ({
        nm,
        absorbance: absData[i] || 0
      }));

      // Predicción PLS simplificada
      let sum = CDM_MODEL.bias;
      absData.forEach((val, i) => {
        if (CDM_MODEL.betaCoefficients[i]) sum += val * CDM_MODEL.betaCoefficients[i];
      });

      setSpectralData(formatted);
      setPrediction(sum.toFixed(2));
      addLog(`Predicción final: ${sum.toFixed(2)}%`, "success");
      
      getAIInterpretation(formatted, sum.toFixed(2), lampStatus).then(setAiInsight);
    }
    setIsMeasuring(false);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-4 lg:p-8 font-sans selection:bg-blue-500/30">
      
      {/* HEADER DINÁMICO */}
      <nav className="glass-panel p-6 rounded-[2.5rem] mb-8 flex flex-col md:flex-row justify-between items-center border-white/5 shadow-2xl">
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className={`absolute inset-0 blur-xl opacity-50 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-blue-500'}`}></div>
            <div className="relative bg-slate-900 p-4 rounded-2xl border border-white/10">
              <Cpu size={28} className={isConnected ? 'text-emerald-400' : 'text-blue-400'} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black italic tracking-tighter text-white">QUANTUM NIR</h1>
              <span className="bg-blue-500/10 text-blue-400 text-[9px] font-black px-2 py-1 rounded-md border border-blue-500/20 uppercase">v3.0 Core</span>
            </div>
            <p className="text-slate-500 text-[10px] font-bold tracking-[0.3em] uppercase">Advanced Spectrometric Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-4 md:mt-0">
          <button 
            onClick={toggleSimulation}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold transition-all border ${simulationMode ? 'bg-orange-500/10 border-orange-500/50 text-orange-400' : 'bg-slate-800/50 border-white/5 text-slate-500'}`}
          >
            <Settings2 size={14} /> SIMULADOR
          </button>
          
          {!isConnected ? (
            <button 
              onClick={handleConnect}
              className="group bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-full font-black text-sm flex items-center gap-3 transition-all shadow-[0_0_30px_-10px_rgba(37,99,235,0.6)]"
            >
              <Usb size={18} className="group-hover:rotate-12 transition-transform" /> ENLAZAR SENSOR
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-slate-900/50 p-1.5 rounded-full border border-white/5">
              <button 
                onClick={toggleLamp}
                className={`flex items-center gap-2 px-6 py-2 rounded-full font-bold text-xs transition-all ${lampStatus === 'ok' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-500'}`}
              >
                {lampStatus === 'ok' ? <Lightbulb size={14} /> : <ZapOff size={14} />}
                LAMP {lampStatus === 'ok' ? 'ON' : 'OFF'}
              </button>
              <div className="px-5 py-2 flex items-center gap-2 text-emerald-400 font-bold text-xs">
                <ShieldCheck size={14} /> {simulationMode ? 'MODO VIRTUAL' : 'SISTEMA ONLINE'}
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* PANEL LATERAL: CONTROL DE HARDWARE */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <FlaskConical size={14} className="text-blue-400" /> Protocolo de Calibración
            </h3>
            
            <div className="space-y-3">
              {[
                { id: 'dark', label: 'Dark Current', icon: <Moon />, desc: 'Lámpara apagada / Fondo' },
                { id: 'reference', label: 'Ref. White', icon: <Sun />, desc: 'Standard 99% Reflectancia' }
              ].map((item) => (
                <button
                  key={item.id}
                  disabled={!isConnected || isMeasuring}
                  onClick={() => runCalibration(item.id as any)}
                  className={`w-full p-4 rounded-3xl border text-left transition-all flex items-center justify-between group ${calib[item.id as keyof CalibrationData] ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900/40 border-white/5 hover:border-blue-500/30'}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${calib[item.id as keyof CalibrationData] ? 'text-emerald-400' : 'text-slate-500 group-hover:text-blue-400'}`}>
                      {item.icon}
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase">{item.label}</p>
                      <p className="text-[9px] text-slate-500 font-medium">{item.desc}</p>
                    </div>
                  </div>
                  {calib[item.id as keyof CalibrationData] && <CheckCircle2 size={18} className="text-emerald-400" />}
                </button>
              ))}
            </div>
            
            <div className="mt-8 p-5 bg-blue-500/5 rounded-[2rem] border border-blue-500/10">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-bold text-blue-400 uppercase">Estado Calibración</span>
                <span className="text-[10px] font-black text-white">{calib.step === 'ready' ? 'LISTO' : 'PENDIENTE'}</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-500" 
                  style={{ width: calib.step === 'ready' ? '100%' : calib.step === 'none' ? '5%' : '50%' }}
                ></div>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-[2.5rem] border-white/5 flex flex-col h-[350px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <Terminal size={14} /> Terminal Log
              </h3>
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-2 pr-2 custom-scrollbar">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-3 animate-in fade-in slide-in-from-left-2">
                  <span className="text-slate-600 shrink-0">{log.timestamp.split(' ')[0]}</span>
                  <span className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : log.type === 'warning' ? 'text-orange-400' : 'text-blue-400'}>
                    {log.message}
                  </span>
                </div>
              ))}
              {logs.length === 0 && <p className="text-slate-700 italic">Esperando secuencia de inicio...</p>}
            </div>
          </div>
        </aside>

        {/* PANEL PRINCIPAL: ESPECTROSCOPIA E IA */}
        <main className="lg:col-span-8 space-y-8">
          
          <div className="glass-panel p-10 rounded-[3rem] border-white/5 relative overflow-hidden">
            <div className="flex justify-between items-start mb-10 relative z-10">
              <div>
                <h2 className="text-3xl font-black italic tracking-tighter flex items-center gap-3">
                  <Activity className="text-blue-500" size={32} /> Análisis de Muestra
                </h2>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Modelo: {CDM_MODEL.name}</p>
              </div>
              <div className="flex flex-col items-end">
                <div className="text-[10px] font-black text-slate-500 uppercase mb-1 tracking-widest">Proteína / Humedad</div>
                <div className="text-5xl font-black text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.3)]">
                  {prediction ? `${prediction}%` : '--.--'}
                </div>
              </div>
            </div>

            <div className="h-[380px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectralData}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.2} />
                  <XAxis 
                    dataKey="nm" 
                    stroke="#475569" 
                    fontSize={11} 
                    tickFormatter={(v) => `${v}nm`} 
                    label={{ value: 'Longitud de Onda (nm)', position: 'insideBottom', offset: -5, fontSize: 10, fill: '#475569' }}
                  />
                  <YAxis 
                    stroke="#475569" 
                    fontSize={11} 
                    label={{ value: 'Absorbancia (AU)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#475569' }}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', fontSize: '12px' }}
                    itemStyle={{ color: '#60a5fa' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="absorbance" 
                    stroke="#3b82f6" 
                    fillOpacity={1} 
                    fill="url(#colorAbs)" 
                    strokeWidth={4} 
                    animationDuration={1000}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <button
              disabled={!isConnected || isMeasuring || (calib.step !== 'ready' && !simulationMode)}
              onClick={runScan}
              className="w-full mt-8 group relative overflow-hidden bg-white text-black font-black py-6 rounded-[2rem] transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-30 disabled:grayscale"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="relative flex items-center justify-center gap-4 group-hover:text-white transition-colors">
                {isMeasuring ? <RefreshCw className="animate-spin" /> : <Play size={24} fill="currentColor" />}
                <span className="text-xl italic tracking-tighter">
                  {isMeasuring ? 'ADQUIRIENDO FOTONES...' : 'EJECUTAR ESCANEO CUÁNTICO'}
                </span>
              </div>
            </button>
          </div>

          {aiInsight && (
            <div className="glass-panel p-8 rounded-[2.5rem] border-indigo-500/20 bg-indigo-500/5 animate-in zoom-in-95 duration-500 relative overflow-hidden">
               <div className="absolute -right-10 -bottom-10 opacity-[0.03] rotate-12">
                  <BrainCircuit size={200} />
               </div>
               <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-indigo-500/20 rounded-2xl text-indigo-400 border border-indigo-500/30">
                    <BrainCircuit size={24} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white uppercase tracking-widest italic">Análisis Experto Gemini 2.0</h4>
                    <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">Interpretación de Espectro NIR</p>
                  </div>
               </div>
               <div className="relative z-10">
                <p className="text-slate-300 leading-relaxed text-sm italic font-medium bg-slate-950/40 p-6 rounded-3xl border border-white/5">
                  "{aiInsight}"
                </p>
               </div>
            </div>
          )}
        </main>
      </div>

      <footer className="mt-12 text-center text-slate-600">
        <p className="text-[10px] font-black uppercase tracking-[0.5em]">Quantum Spectrometry Unit &copy; 2025 - V.3.0 PRO</p>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>
    </div>
  );
};

export default App;
