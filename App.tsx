
import React, { useState, useEffect, useRef } from 'react';
import { 
  Usb, Activity, RefreshCw, Zap, AlertCircle, CheckCircle2, 
  BarChart3, Settings2, ShieldCheck, Thermometer, Power, Bluetooth, XCircle, Terminal, Trash2, Timer, LifeBuoy, Info
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { device as usbDevice } from './services/usbService';
import { bleDevice } from './services/bleService';
import { CDM_MODEL } from './constants';
import { getAIInterpretation } from './services/geminiService';
import { WavelengthPoint } from './types';

interface IDeviceDriver {
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  setLamp(on: boolean): Promise<boolean>;
  getTemperature(): Promise<number | null>;
  scan(): Promise<Uint16Array | null>;
  setLogger(fn: (msg: string) => void): void;
  resetHardware?(): Promise<boolean>;
  isConnected: boolean;
}

export default function App() {
  const [connectionType, setConnectionType] = useState<'usb' | 'ble'>('usb');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'ready' | 'error'>('disconnected');
  const [statusMsg, setStatusMsg] = useState("Listo para conectar");
  const [temp, setTemp] = useState<number | null>(null);
  const [lamp, setLamp] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  
  const [isStabilizing, setIsStabilizing] = useState(false);
  const [stabilizeProgress, setStabilizeProgress] = useState(0);
  const [stabilizeMsg, setStabilizeMsg] = useState("");
  
  const [darkRef, setDarkRef] = useState<Uint16Array | null>(null);
  const [whiteRef, setWhiteRef] = useState<Uint16Array | null>(null);
  const [spectrum, setSpectrum] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<string>("--");
  const [aiAnalysis, setAiAnalysis] = useState<string>("");

  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const activeDevice: IDeviceDriver = connectionType === 'usb' ? usbDevice : bleDevice;

  const addLogEntry = (msg: string) => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 199)]);
  };

  useEffect(() => {
    activeDevice.setLogger(addLogEntry);
  }, [connectionType]);

  const connect = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setStatus('connecting');
    setStatusMsg("Inicializando MicroNIR...");
    
    try {
      const res = await activeDevice.connect();
      if (res === "OK") {
        const t = await activeDevice.getTemperature();
        setTemp(t);
        setStatus('ready');
        setStatusMsg("Hardware listo");
        addLogEntry("Conexión establecida correctamente.");
      } else {
        setStatus('error');
        setStatusMsg(res);
      }
    } catch (e) {
      setStatus('error');
      setStatusMsg("Error de puerto");
    }
    setIsBusy(false);
  };

  const handleHardReset = async () => {
    if (!activeDevice.resetHardware || isBusy) return;
    setIsBusy(true);
    addLogEntry("Solicitando Reinicio de Hardware...");
    await activeDevice.resetHardware();
    setStatus('disconnected');
    setLamp(false);
    setIsBusy(false);
    setStatusMsg("Sensor Reiniciado");
  };

  const runDwell = async (ms: number, msg: string) => {
    setIsStabilizing(true);
    setStabilizeMsg(msg);
    setStabilizeProgress(0);
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, ms / steps));
      setStabilizeProgress((i / steps) * 100);
    }
    setIsStabilizing(false);
  };

  const toggleLamp = async () => {
    if (status !== 'ready' || isBusy || isStabilizing) return;
    setIsBusy(true);
    const newState = !lamp;
    const ok = await activeDevice.setLamp(newState);
    if (ok) {
      setLamp(newState);
      if (newState) {
        await runDwell(4000, "CALENTANDO LÁMPARA..."); 
      } else {
        await runDwell(2000, "ENFRIANDO FILAMENTO..."); 
      }
    }
    setIsBusy(false);
  };

  const calibrate = async (type: 'dark' | 'white') => {
    if (isBusy || isStabilizing) return;
    
    // TRATAMIENTO ESPECIAL DARK: El calor residual causa errores de lectura
    if (type === 'dark') {
        if (lamp) {
            addLogEntry("Dark Ref requiere Lámpara OFF. Apagando...");
            await activeDevice.setLamp(false);
            setLamp(false);
            await runDwell(2000, "CORTANDO ENERGÍA...");
        }
        await runDwell(6000, "ESTABILIZANDO OSCURIDAD (SENSOR COOLING)...");
    }

    setIsBusy(true);
    setStatusMsg(`Capturando ${type.toUpperCase()}...`);
    addLogEntry(`Iniciando captura de referencia ${type}...`);
    
    const data = await activeDevice.scan();
    if (data) {
      if (type === 'dark') setDarkRef(data);
      else setWhiteRef(data);
      addLogEntry(`Calibración ${type} exitosa.`);
      setStatusMsg(`Ref. ${type} OK`);
    } else {
      addLogEntry(`FALLO: El equipo no devolvió datos para ${type}. Intenta Hard Reset.`);
      setStatusMsg("Error de Captura");
    }
    setIsBusy(false);
  };

  const measure = async () => {
    if (isBusy || isStabilizing) return;
    if (!darkRef || !whiteRef) {
        setStatusMsg("Falta Calibración");
        return;
    }
    
    setIsBusy(true);
    setStatusMsg("Capturando muestra...");
    const raw = await activeDevice.scan();
    
    if (raw) {
      const plotData: WavelengthPoint[] = [];
      const absData: number[] = [];
      
      for(let i=0; i<raw.length; i++) {
        // BLINDAJE ANTI-OVERFLOW: Prevenir divisiones por cero o logaritmos de números negativos
        const diffWhiteDark = whiteRef[i] - darkRef[i];
        const denominator = diffWhiteDark <= 0 ? 1 : diffWhiteDark;
        
        const diffRawDark = raw[i] - darkRef[i];
        const numerator = diffRawDark <= 0 ? 0.0001 : diffRawDark;
        
        // Reflectancia Clamped (0.01% a 150%)
        const refl = Math.max(0.0001, Math.min(numerator / denominator, 1.5));
        
        // Absorbancia Clamped para evitar errores de graficación (AU máximo 4.0)
        let abs = -Math.log10(refl);
        abs = Math.max(0, Math.min(abs, 4.0)); 

        absData.push(abs);
        plotData.push({ nm: Math.round(908 + i * 6.25), absorbance: abs });
      }
      
      setSpectrum(plotData);
      
      // Cálculo Quimiométrico PLS
      let score = CDM_MODEL.bias;
      const coeffs = CDM_MODEL.betaCoefficients;
      for(let i=0; i < Math.min(absData.length, coeffs.length); i++) {
        score += absData[i] * coeffs[i];
      }
      
      const predValue = score.toFixed(2);
      setPrediction(predValue);
      addLogEntry(`Predicción completada: ${predValue}%`);
      
      getAIInterpretation(plotData, predValue, lamp ? 'ok' : 'off').then(setAiAnalysis);
      setStatusMsg("Listo");
    } else {
      addLogEntry("Error: Captura de muestra fallida.");
    }
    setIsBusy(false);
  };

  const disconnect = async () => {
    await activeDevice.disconnect();
    setStatus('disconnected');
    setStatusMsg("Desconectado");
    setTemp(null);
    setLamp(false);
    addLogEntry("Sesión cerrada.");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans pb-32">
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 bg-slate-900/80 backdrop-blur p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div className="mb-4 md:mb-0">
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
            <ShieldCheck className="text-blue-500" />
            MicroNIR <span className="text-blue-400 bg-blue-500/10 px-2 rounded text-lg border border-blue-500/20 font-mono">PRO</span>
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono uppercase border border-slate-700">DRIVER V2.5.1</span>
            <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">{connectionType} LINK ACTIVE</span>
          </div>
        </div>
        
        <div className="flex flex-wrap justify-center gap-4 items-center">
          {status !== 'disconnected' && (
            <button 
              onClick={handleHardReset} 
              disabled={isBusy}
              title="Hardware Reset (Cmd 0x0F)"
              className="bg-red-950/30 text-red-500 p-3 rounded-xl border border-red-500/20 hover:bg-red-900/40 transition-all flex items-center gap-2"
            >
              <LifeBuoy size={18} />
              <span className="text-xs font-bold hidden sm:inline">RESET HW</span>
            </button>
          )}

          {status === 'disconnected' ? (
            <button onClick={connect} disabled={isBusy} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all active:scale-95">
                {isBusy ? <RefreshCw className="animate-spin" size={20}/> : <Power size={20} />} CONECTAR SENSOR
            </button>
          ) : (
            <div className="flex gap-3">
              <button onClick={toggleLamp} disabled={isBusy || isStabilizing} className={`px-5 py-3 rounded-xl font-bold border flex items-center gap-2 transition-all ${lamp ? 'bg-orange-500 text-white border-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.4)]' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                {isStabilizing ? <Timer className="animate-pulse" size={18} /> : <Zap size={18} fill={lamp ? "currentColor" : "none"} />} 
                {lamp ? 'LAMP ON' : 'LAMP OFF'}
              </button>
              <div className="bg-slate-800 px-5 py-3 rounded-xl flex items-center gap-2 border border-slate-700 shadow-inner">
                <Thermometer size={18} className="text-emerald-400"/>
                <span className="font-mono font-bold text-lg">{temp ? temp.toFixed(1) : '--'}°C</span>
              </div>
              <button onClick={disconnect} className="bg-slate-900 text-slate-500 px-3 py-3 rounded-xl hover:text-red-400 transition-all border border-slate-800"><XCircle size={18} /></button>
            </div>
          )}
        </div>
      </header>

      {isStabilizing && (
        <div className="mb-6 bg-blue-500/10 border border-blue-500/30 p-5 rounded-2xl relative overflow-hidden animate-in fade-in slide-in-from-top-4">
            <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2 text-blue-400 text-sm font-black uppercase tracking-wider">
                    <RefreshCw size={16} className="animate-spin" /> {stabilizeMsg}
                </div>
                <span className="text-xs font-mono font-bold text-blue-500">{Math.round(stabilizeProgress)}%</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full w-full">
                <div className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-300 shadow-[0_0_8px_rgba(59,130,246,0.6)]" style={{ width: `${stabilizeProgress}%` }} />
            </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 relative group overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Settings2 size={60} />
            </div>
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                <Settings2 size={14} /> Protocolo de Calibración
            </h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <button disabled={status !== 'ready' || isBusy || isStabilizing} onClick={() => calibrate('dark')} className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all font-bold ${darkRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-900/10' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700/50'}`}>
                    <span>1. REFERENCIA OSCURA</span>
                    {darkRef ? <CheckCircle2 size={18} /> : <AlertCircle size={18} className="opacity-40" />}
                </button>
                <p className="text-[10px] text-slate-500 px-1 font-medium flex items-center gap-1"><Info size={10}/> Bloquea el sensor completamente.</p>
              </div>
              
              <div className="space-y-1">
                <button disabled={status !== 'ready' || !lamp || isBusy || isStabilizing} onClick={() => calibrate('white')} className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all font-bold ${whiteRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-900/10' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700/50'}`}>
                    <span>2. REFERENCIA BLANCA</span>
                    {whiteRef ? <CheckCircle2 size={18} /> : <AlertCircle size={18} className="opacity-40" />}
                </button>
                <p className="text-[10px] text-slate-500 px-1 font-medium flex items-center gap-1"><Info size={10}/> Usa el patrón de Spectralon (Blanco).</p>
              </div>
            </div>
          </div>

          <button 
            disabled={!darkRef || !whiteRef || !lamp || isBusy || isStabilizing} 
            onClick={measure} 
            className={`w-full py-10 rounded-3xl font-black text-2xl uppercase flex flex-col items-center justify-center gap-2 transition-all ${(darkRef && whiteRef && lamp && !isBusy && !isStabilizing) ? 'bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white shadow-2xl shadow-blue-900/40 cursor-pointer hover:scale-[1.02] active:scale-[0.98]' : 'bg-slate-900 border border-slate-800 text-slate-700 cursor-not-allowed'}`}
          >
            {isBusy ? <RefreshCw className="animate-spin" size={32} /> : <Activity size={32} />} 
            <span>Analizar Muestra</span>
          </button>

           <div className={`bg-slate-900 p-8 rounded-3xl border relative overflow-hidden transition-all shadow-inner ${prediction !== "--" ? 'border-blue-500/30 bg-blue-500/5' : 'border-slate-800'}`}>
               {prediction !== "--" && (
                 <div className="absolute top-0 right-0 bg-blue-500/20 text-blue-400 text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-tighter border-l border-b border-blue-500/30">Chemometric V2.4</div>
               )}
               <span className="text-xs text-slate-500 font-bold uppercase block mb-2 tracking-widest text-center">Proteína Estimada</span>
               <div className="flex items-baseline justify-center gap-1">
                 <span className="text-8xl font-black text-white drop-shadow-lg tracking-tighter">{prediction}</span>
                 <span className="text-3xl text-slate-600 font-black">%</span>
               </div>
            </div>
        </div>

        <div className="lg:col-span-8 bg-slate-900/50 p-6 rounded-3xl border border-slate-800 flex flex-col min-h-[550px] shadow-2xl">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 px-2">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <BarChart3 size={16} className="text-blue-500" /> Espectro Absorbancia (128 Canales)
            </h3>
            {aiAnalysis && (
                <div className="bg-blue-600/10 px-5 py-3 rounded-2xl border border-blue-500/20 text-[11px] text-blue-200 leading-relaxed max-w-md shadow-inner animate-in slide-in-from-right-4">
                    <b className="text-blue-400 block mb-1 uppercase tracking-tighter flex items-center gap-1"><ShieldCheck size={12}/> Veredicto Gemini IA</b>
                    {aiAnalysis}
                </div>
            )}
          </div>
          
          <div className="flex-1 w-full bg-slate-950/50 rounded-2xl border border-slate-800/50 p-6 shadow-inner relative overflow-hidden">
             <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectrum} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.6}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="5 5" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={11} tickFormatter={v => `${v}nm`} axisLine={false} tickLine={false} minTickGap={30} />
                  <YAxis stroke="#475569" fontSize={11} domain={[0, 4.0]} axisLine={false} tickLine={false} label={{ value: 'Absorbancia (AU)', angle: -90, position: 'insideLeft', offset: 10, style: { fill: '#475569', fontSize: '10px', fontWeight: 'bold' }}} />
                  <Tooltip 
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)' }} 
                    itemStyle={{ color: '#3b82f6', fontWeight: 'bold' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="absorbance" 
                    stroke="#3b82f6" 
                    strokeWidth={4} 
                    fillOpacity={1} 
                    fill="url(#colorAbs)" 
                    animationDuration={1500}
                    activeDot={{ r: 6, fill: '#60a5fa', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 bg-slate-950/95 border-t border-slate-800 transition-all z-50 shadow-[0_-10px_20px_rgba(0,0,0,0.4)] ${showLogs ? 'h-80' : 'h-12'}`}>
        <div className="flex items-center justify-between px-6 h-12 bg-slate-900 cursor-pointer" onClick={() => setShowLogs(!showLogs)}>
            <div className="flex items-center gap-3 text-xs font-mono font-bold text-slate-400">
                <Terminal size={14} className={isBusy ? "animate-pulse text-blue-500" : ""} /> 
                <span className="tracking-widest uppercase">Consola de Diagnóstico USB</span>
            </div>
            <div className="flex items-center gap-4">
                {statusMsg && <span className="text-[10px] bg-slate-800 text-blue-400 px-2 py-0.5 rounded border border-slate-700 font-mono uppercase">{statusMsg}</span>}
                <button onClick={(e) => { e.stopPropagation(); setLogs([]); }} className="text-slate-500 hover:text-white transition-colors p-1"><Trash2 size={14} /></button>
            </div>
        </div>
        {showLogs && (
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 bg-slate-950/50 backdrop-blur-xl custom-scrollbar h-[calc(100%-3rem)]">
                {logs.length === 0 && <div className="text-slate-800 italic p-4 text-center">Inicia una operación para ver eventos de bus...</div>}
                {logs.map((log, i) => (
                    <div key={i} className={`flex gap-3 border-b border-slate-900/50 py-1 ${log.includes('FALLO') || log.includes('Error') ? 'text-red-400 bg-red-500/5' : log.includes('exitosa') ? 'text-emerald-400' : 'text-slate-500'}`}>
                        <span className="opacity-30 flex-shrink-0">{(logs.length - i).toString().padStart(3, '0')}</span>
                        <span className="break-all">{log}</span>
                    </div>
                ))}
            </div>
        )}
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(15, 23, 42, 0.1); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(30, 41, 59, 0.5); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(59, 130, 246, 0.3); }
      `}</style>
    </div>
  );
}
