
import React, { useState, useEffect, useRef } from 'react';
import { 
  Usb, Activity, RefreshCw, Zap, AlertCircle, CheckCircle2, 
  BarChart3, Settings2, ShieldCheck, Thermometer, Power, Bluetooth, XCircle, Terminal, Trash2, ShieldAlert, Timer
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
  
  // Lógica de Dwell
  const [isStabilizing, setIsStabilizing] = useState(false);
  const [stabilizeProgress, setStabilizeProgress] = useState(0);
  const [lastLampAction, setLastLampAction] = useState<number>(0);
  
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const [darkRef, setDarkRef] = useState<Uint16Array | null>(null);
  const [whiteRef, setWhiteRef] = useState<Uint16Array | null>(null);
  const [spectrum, setSpectrum] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<string>("--");
  const [aiAnalysis, setAiAnalysis] = useState<string>("");

  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const activeDevice: IDeviceDriver = connectionType === 'usb' ? usbDevice : bleDevice;

  const addLogEntry = (msg: string) => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 199)]);
  };

  useEffect(() => {
    const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    if (!isSecure) {
      setCompatibilityError("WebUSB/BLE requieren HTTPS. La aplicación no funcionará correctamente en HTTP.");
    } else if (connectionType === 'usb' && !navigator.usb) {
      setCompatibilityError("Tu navegador no soporta WebUSB. Usa Chrome o Edge.");
    } else if (connectionType === 'ble' && !navigator.bluetooth) {
      setCompatibilityError("Tu navegador no soporta Web Bluetooth.");
    } else {
      setCompatibilityError(null);
    }
  }, [connectionType]);

  useEffect(() => {
    activeDevice.setLogger(addLogEntry);
  }, [connectionType]);

  const connect = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setStatus('connecting');
    setStatusMsg("Despertando hardware...");
    
    try {
      const res = await activeDevice.connect();
      if (res === "OK") {
        const t = await activeDevice.getTemperature();
        setTemp(t);
        setStatus('ready');
        setStatusMsg(`MicroNIR Online (${connectionType.toUpperCase()})`);
      } else {
        setStatus('error');
        setStatusMsg(res);
      }
    } catch (e: any) {
      setStatus('error');
      setStatusMsg(e.message || "Fallo crítico");
    }
    setIsBusy(false);
  };

  const runDwell = async (ms: number) => {
    setIsStabilizing(true);
    setStabilizeProgress(0);
    const steps = 10;
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
      setLastLampAction(Date.now());
      if (newState) {
        addLogEntry("Lámpara encendida. Estabilizando radiación térmica...");
        await runDwell(3000); // 3s Dwell ON
      } else {
        addLogEntry("Lámpara apagada. Esperando enfriamiento de filamento...");
        await runDwell(1500); // 1.5s Dwell OFF
      }
    }
    setIsBusy(false);
  };

  const calibrate = async (type: 'dark' | 'white') => {
    if (isBusy || isStabilizing) return;
    
    // Protección VIAVI: Si la lámpara se acaba de apagar, esperar Dwell OFF para Dark Ref
    if (type === 'dark' && lamp) {
        addLogEntry("Error: Lámpara encendida durante Ref. Oscura. Apagando...");
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
      setStatusMsg(`Calibración ${type} OK`);
      addLogEntry(`Calibración ${type} exitosa.`);
    } else {
      setStatusMsg(`Fallo en captura ${type}`);
    }
    setIsBusy(false);
  };

  const measure = async () => {
    if (isBusy || isStabilizing) return;
    setIsBusy(true);
    setStatusMsg("Escaneando muestra...");
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
      setStatusMsg("Análisis completado");
    } else {
      setStatusMsg("Error en escaneo");
      addLogEntry("Error: Verifique calibración y lámpara.");
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
      {compatibilityError && (
        <div className="mb-6 bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-center gap-3 text-red-400 animate-pulse">
            <ShieldAlert size={20} />
            <p className="text-sm font-bold">{compatibilityError}</p>
        </div>
      )}

      <header className="flex flex-col md:flex-row justify-between items-center mb-8 bg-slate-900/80 backdrop-blur p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div className="mb-4 md:mb-0">
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
            <ShieldCheck className="text-blue-500" />
            MicroNIR <span className="text-blue-400 bg-blue-500/10 px-2 rounded text-lg border border-blue-500/20">QUANTUM</span>
          </h1>
          <p className="text-xs text-slate-500 font-mono mt-1 uppercase ml-1">Protocol: VIAVI OnSite-W Sync • {connectionType.toUpperCase()}</p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="text-right mr-2 hidden md:block">
            <p className={`text-xs font-bold ${status==='ready' ? 'text-emerald-400' : status==='error' ? 'text-red-400' : 'text-amber-400'}`}>
              {isStabilizing ? "ESTABILIZANDO LÁMPARA..." : statusMsg}
            </p>
          </div>
          
          {status === 'disconnected' ? (
            <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
              <button onClick={() => setConnectionType('usb')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${connectionType === 'usb' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><Usb size={12} /></button>
              <button onClick={() => setConnectionType('ble')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${connectionType === 'ble' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><Bluetooth size={12} /></button>
            </div>
          ) : null}
          
          {status === 'disconnected' || status === 'error' ? (
             <div className="flex gap-2">
                <button onClick={connect} disabled={isBusy} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2">
                    {isBusy ? <RefreshCw className="animate-spin" size={20}/> : <Power size={20} />} 
                    {status === 'error' ? 'REINTENTAR' : 'CONECTAR'}
                </button>
            </div>
          ) : (
            <div className="flex gap-3">
               <button onClick={disconnect} className="bg-slate-800 text-slate-400 px-3 py-3 rounded-xl hover:bg-red-900/30 transition-all"><Power size={18} /></button>
              <button onClick={toggleLamp} disabled={isBusy || isStabilizing} className={`px-5 py-3 rounded-xl font-bold border flex items-center gap-2 transition-all ${lamp ? 'bg-orange-500 text-white border-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.4)]' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                {isStabilizing ? <Timer className="animate-pulse" size={18} /> : <Zap size={18} fill={lamp ? "currentColor" : "none"} />} 
                {lamp ? 'LÁMPARA ON' : 'LÁMPARA OFF'}
              </button>
              <div className="bg-slate-800 px-5 py-3 rounded-xl flex items-center gap-2 border border-slate-700"><Thermometer size={18} className="text-emerald-400"/><span className="font-mono font-bold text-lg">{temp ? temp.toFixed(1) : '--'}°C</span></div>
            </div>
          )}
        </div>
      </header>

      {isStabilizing && (
        <div className="mb-6 bg-blue-500/10 border border-blue-500/30 p-4 rounded-2xl overflow-hidden relative">
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2 text-blue-400 text-sm font-bold uppercase tracking-wider">
                    <Timer size={16} className="animate-spin" /> Estabilizando radiación de cuerpo negro
                </div>
                <span className="text-xs font-mono text-blue-500">{Math.round(stabilizeProgress)}%</span>
            </div>
            <div className="h-1 bg-slate-800 rounded-full w-full">
                <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${stabilizeProgress}%` }} />
            </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6">Secuencia de Calibración</h3>
            <div className="space-y-3">
              <button disabled={status !== 'ready' || isBusy || isStabilizing} onClick={() => calibrate('dark')} className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all ${darkRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}><span>REF. OSCURA (DARK)</span>{darkRef && <CheckCircle2 size={18} />}</button>
              <button disabled={status !== 'ready' || !lamp || isBusy || isStabilizing} onClick={() => calibrate('white')} className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all ${whiteRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}><span>REF. BLANCA (WHITE)</span>{whiteRef && <CheckCircle2 size={18} />}</button>
            </div>
          </div>
          <button disabled={!darkRef || !whiteRef || !lamp || isBusy || isStabilizing} onClick={measure} className={`w-full py-8 rounded-3xl font-black text-xl uppercase flex items-center justify-center gap-3 transition-all ${(darkRef && whiteRef && lamp && !isBusy && !isStabilizing) ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/20 cursor-pointer' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}>
            {isBusy ? <RefreshCw className="animate-spin" size={28} /> : <Activity size={28} />} Analizar Muestra
          </button>
           <div className={`bg-slate-900 p-8 rounded-3xl border text-center transition-all ${prediction !== "--" ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-800'}`}>
               <span className="text-xs text-slate-500 font-bold uppercase block mb-2">Contenido de Proteína</span>
               <div className="flex items-baseline justify-center gap-1"><span className="text-7xl font-black text-white">{prediction}</span><span className="text-2xl text-slate-600 font-bold">%</span></div>
            </div>
        </div>

        <div className="lg:col-span-8 bg-slate-900/50 p-6 rounded-3xl border border-slate-800 flex flex-col min-h-[500px]">
          <div className="flex justify-between items-center mb-6 px-2">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest"><BarChart3 size={14} className="inline mr-2" /> Espectro NIR (128 canales)</h3>
            {aiAnalysis && <div className="bg-blue-500/10 px-4 py-2 rounded-xl border border-blue-500/20 text-[11px] text-blue-200">{aiAnalysis}</div>}
          </div>
          <div className="flex-1 w-full bg-slate-950/30 rounded-2xl border border-slate-800/50 p-4">
             <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectrum} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickFormatter={v => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={10} domain={[0, 'auto']} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="absorbance" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorAbs)" animationDuration={1000} />
                </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 bg-slate-950/95 border-t border-slate-800 transition-all z-50 ${showLogs ? 'h-80' : 'h-10'}`}>
        <div className="flex items-center justify-between px-4 h-10 bg-slate-900 cursor-pointer" onClick={() => setShowLogs(!showLogs)}>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400"><Terminal size={14} /> <b>DIAGNÓSTICO TERMINAL</b></div>
            <button onClick={(e) => { e.stopPropagation(); setLogs([]); }} className="text-slate-500 hover:text-white transition-colors"><Trash2 size={14} /></button>
        </div>
        {showLogs && (
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1 bg-slate-950">
                {logs.map((log, i) => (
                    <div key={i} className={`break-all ${log.includes('RX') ? 'text-emerald-400' : log.includes('TX') ? 'text-blue-400' : log.includes('Error') ? 'text-red-400' : 'text-slate-400'}`}>{log}</div>
                ))}
                <div ref={logsEndRef} />
            </div>
        )}
      </div>
    </div>
  );
}
