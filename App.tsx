
import React, { useState, useEffect, useRef } from 'react';
import { 
  Usb, Activity, RefreshCw, Zap, AlertCircle, CheckCircle2, 
  BarChart3, Settings2, ShieldCheck, Thermometer, Power, Bluetooth, XCircle, Terminal, Trash2, ShieldAlert, Timer, LifeBuoy
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
  const [connectionType, setConnectionType] = useState<'usb' | 'ble'>('ble'); // BLE por defecto según logs
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'ready' | 'error'>('disconnected');
  const [statusMsg, setStatusMsg] = useState("Listo para conectar");
  const [temp, setTemp] = useState<number | null>(null);
  const [lamp, setLamp] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  
  const [isStabilizing, setIsStabilizing] = useState(false);
  const [stabilizeProgress, setStabilizeProgress] = useState(0);
  
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
    setStatusMsg("Conectando...");
    
    try {
      const res = await activeDevice.connect();
      if (res === "OK") {
        const t = await activeDevice.getTemperature();
        setTemp(t);
        setStatus('ready');
        setStatusMsg("Sensor Conectado");
      } else {
        setStatus('error');
        setStatusMsg(res);
      }
    } catch (e: any) {
      setStatus('error');
      setStatusMsg("Error de puerto");
    }
    setIsBusy(false);
  };

  const hardReset = async () => {
    if (!activeDevice.resetHardware) return;
    setIsBusy(true);
    addLogEntry("Reiniciando Hardware...");
    await activeDevice.resetHardware();
    setStatus('disconnected');
    setIsBusy(false);
  };

  const runDwell = async (ms: number) => {
    setIsStabilizing(true);
    setStabilizeProgress(0);
    const steps = 20;
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
        addLogEntry("Lámpara encendida. Estabilizando...");
        await runDwell(3000); 
      } else {
        addLogEntry("Lámpara apagada. Enfriando...");
        await runDwell(1500); 
      }
    }
    setIsBusy(false);
  };

  const calibrate = async (type: 'dark' | 'white') => {
    if (isBusy || isStabilizing) return;
    if (type === 'dark' && lamp) {
        await activeDevice.setLamp(false);
        setLamp(false);
        await runDwell(2000);
    }
    setIsBusy(true);
    setStatusMsg(`Capturando ${type}...`);
    const data = await activeDevice.scan();
    if (data) {
      if (type === 'dark') setDarkRef(data);
      else setWhiteRef(data);
      setStatusMsg(`Ref. ${type} OK`);
    } else {
      setStatusMsg("Fallo en captura");
    }
    setIsBusy(false);
  };

  const measure = async () => {
    if (isBusy || isStabilizing) return;
    setIsBusy(true);
    setStatusMsg("Analizando...");
    const raw = await activeDevice.scan();
    if (raw && darkRef && whiteRef) {
      const plotData: WavelengthPoint[] = [];
      const absData: number[] = [];
      for(let i=0; i<raw.length; i++) {
        const refl = Math.max(0.0001, (raw[i] - darkRef[i]) / Math.max(whiteRef[i] - darkRef[i], 1));
        const abs = -Math.log10(refl);
        absData.push(abs);
        plotData.push({ nm: Math.round(908 + i * 6.25), absorbance: abs });
      }
      setSpectrum(plotData);
      let score = CDM_MODEL.bias;
      for(let i=0; i<Math.min(absData.length, CDM_MODEL.betaCoefficients.length); i++) {
        score += absData[i] * CDM_MODEL.betaCoefficients[i];
      }
      setPrediction(score.toFixed(2));
      getAIInterpretation(plotData, score.toFixed(2), lamp ? 'ok' : 'off').then(setAiAnalysis);
      setStatusMsg("Listo");
    }
    setIsBusy(false);
  };

  const disconnect = async () => {
    await activeDevice.disconnect();
    setStatus('disconnected');
    setStatusMsg("Desconectado");
    setTemp(null);
    setLamp(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans pb-32">
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 bg-slate-900/80 backdrop-blur p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div className="mb-4 md:mb-0">
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
            <ShieldCheck className="text-blue-500" />
            MicroNIR <span className="text-blue-400 bg-blue-500/10 px-2 rounded text-lg border border-blue-500/20 font-mono">QUANTUM</span>
          </h1>
          <p className="text-[10px] text-slate-500 font-mono mt-1 uppercase tracking-widest">{connectionType} MODE • PROTOCOL SYNC V2.5</p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-4 items-center">
          {status !== 'disconnected' && (
            <button onClick={hardReset} className="bg-red-900/20 text-red-500 p-3 rounded-xl border border-red-500/20 hover:bg-red-900/40 transition-all"><LifeBuoy size={18} /></button>
          )}

          {status === 'disconnected' ? (
            <div className="flex gap-4">
                <div className="flex bg-slate-800 rounded-xl p-1 border border-slate-700">
                    <button onClick={() => setConnectionType('usb')} className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${connectionType === 'usb' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}><Usb size={14} /> USB</button>
                    <button onClick={() => setConnectionType('ble')} className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${connectionType === 'ble' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}><Bluetooth size={14} /> BLE</button>
                </div>
                <button onClick={connect} disabled={isBusy} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all active:scale-95">
                    {isBusy ? <RefreshCw className="animate-spin" size={20}/> : <Power size={20} />} CONECTAR
                </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button onClick={toggleLamp} disabled={isBusy || isStabilizing} className={`px-5 py-3 rounded-xl font-bold border flex items-center gap-2 transition-all ${lamp ? 'bg-orange-500 text-white border-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.4)]' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                {isStabilizing ? <Timer className="animate-pulse" size={18} /> : <Zap size={18} fill={lamp ? "currentColor" : "none"} />} 
                {lamp ? 'LÁMPARA ON' : 'LÁMPARA OFF'}
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
        <div className="mb-6 bg-blue-500/10 border border-blue-500/30 p-4 rounded-2xl relative overflow-hidden animate-pulse">
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2 text-blue-400 text-sm font-black uppercase tracking-wider">
                    <Timer size={16} /> Estabilizando hardware...
                </div>
                <span className="text-xs font-mono font-bold text-blue-500">{Math.round(stabilizeProgress)}%</span>
            </div>
            <div className="h-1 bg-slate-800 rounded-full w-full">
                <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${stabilizeProgress}%` }} />
            </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6">Calibración Requerida</h3>
            <div className="space-y-4">
              <button disabled={status !== 'ready' || isBusy || isStabilizing} onClick={() => calibrate('dark')} className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all font-bold ${darkRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                  <span>REF. OSCURA</span>
                  {darkRef ? <CheckCircle2 size={18} /> : <AlertCircle size={18} className="opacity-40" />}
              </button>
              <button disabled={status !== 'ready' || !lamp || isBusy || isStabilizing} onClick={() => calibrate('white')} className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all font-bold ${whiteRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                  <span>REF. BLANCA</span>
                  {whiteRef ? <CheckCircle2 size={18} /> : <AlertCircle size={18} className="opacity-40" />}
              </button>
            </div>
          </div>

          <button 
            disabled={!darkRef || !whiteRef || !lamp || isBusy || isStabilizing} 
            onClick={measure} 
            className={`w-full py-10 rounded-3xl font-black text-2xl uppercase flex flex-col items-center justify-center gap-2 transition-all ${(darkRef && whiteRef && lamp && !isBusy && !isStabilizing) ? 'bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white shadow-2xl shadow-blue-900/30' : 'bg-slate-900 border border-slate-800 text-slate-700'}`}
          >
            {isBusy ? <RefreshCw className="animate-spin" size={32} /> : <Activity size={32} />} 
            <span>Analizar</span>
          </button>

           <div className={`bg-slate-900 p-8 rounded-3xl border relative overflow-hidden transition-all ${prediction !== "--" ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-800'}`}>
               <span className="text-xs text-slate-500 font-bold uppercase block mb-2 tracking-widest text-center">Contenido Estimado</span>
               <div className="flex items-baseline justify-center gap-1">
                 <span className="text-8xl font-black text-white tracking-tighter">{prediction}</span>
                 <span className="text-3xl text-slate-600 font-black">%</span>
               </div>
            </div>
        </div>

        <div className="lg:col-span-8 bg-slate-900/50 p-6 rounded-3xl border border-slate-800 flex flex-col min-h-[550px] shadow-2xl">
          <div className="flex justify-between items-center mb-8 px-2">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <BarChart3 size={16} className="text-blue-500" /> Espectro Absorbancia
            </h3>
            {aiAnalysis && (
                <div className="bg-blue-600/10 px-5 py-3 rounded-2xl border border-blue-500/20 text-[11px] text-blue-200 leading-relaxed max-w-md shadow-inner">
                    <b className="text-blue-400 block mb-1 uppercase tracking-tighter">Veredicto Gemini IA</b>
                    {aiAnalysis}
                </div>
            )}
          </div>
          
          <div className="flex-1 w-full bg-slate-950/50 rounded-2xl border border-slate-800/50 p-6 shadow-inner relative">
             <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectrum} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.6}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="5 5" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={11} tickFormatter={v => `${v}nm`} axisLine={false} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={11} domain={[0, 'auto']} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '12px' }} 
                    itemStyle={{ color: '#3b82f6', fontWeight: 'bold' }}
                  />
                  <Area type="monotone" dataKey="absorbance" stroke="#3b82f6" strokeWidth={4} fillOpacity={1} fill="url(#colorAbs)" animationDuration={1000} />
                </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 bg-slate-950/95 border-t border-slate-800 transition-all z-50 shadow-2xl ${showLogs ? 'h-80' : 'h-12'}`}>
        <div className="flex items-center justify-between px-6 h-12 bg-slate-900 cursor-pointer" onClick={() => setShowLogs(!showLogs)}>
            <div className="flex items-center gap-3 text-xs font-mono font-bold text-slate-400">
                <Terminal size={14} className={isBusy ? "animate-pulse text-blue-500" : ""} /> 
                <span className="tracking-widest uppercase">Monitor de Bus de Datos</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setLogs([]); }} className="text-slate-500 hover:text-white transition-colors p-1"><Trash2 size={14} /></button>
        </div>
        {showLogs && (
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 bg-slate-950/50 backdrop-blur-xl h-[calc(100%-3rem)]">
                {logs.map((log, i) => (
                    <div key={i} className={`flex gap-3 py-1 border-b border-slate-900/30 ${log.includes('Error') || log.includes('Timeout') ? 'text-red-400' : log.includes('TX') ? 'text-blue-400' : 'text-slate-500'}`}>
                        <span className="opacity-30">{i.toString().padStart(3, '0')}</span>
                        <span className="break-all">{log}</span>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
}
