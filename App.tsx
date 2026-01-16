
import { useState, useEffect, useRef } from 'react';
import { 
  Usb, Activity, RefreshCw, Zap, AlertCircle, CheckCircle2, 
  BarChart3, Settings2, ShieldCheck, Thermometer, Power, Bluetooth, XCircle, Terminal, Trash2, ShieldAlert
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
    let interval: any;

    if (status === 'ready') {
      const updateTemp = async () => {
        if (!isBusy) {
          try {
            const currentTemp = await activeDevice.getTemperature();
            if (currentTemp !== null) {
              setTemp(currentTemp);
            }
          } catch (e) {
            console.error("Error polling temperature", e);
          }
        }
      };

      updateTemp();
      interval = setInterval(updateTemp, 10000);
    } else {
      setTemp(null);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status, activeDevice, isBusy]);

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
    setStatusMsg("Conectando...");
    
    try {
      const res = await activeDevice.connect();
      if (res === "OK") {
        const t = await activeDevice.getTemperature();
        setTemp(t);
        setStatus('ready');
        setStatusMsg(`Sensor Online (${connectionType.toUpperCase()})`);
        addLogEntry("Conexión establecida correctamente.");
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

  const hardReset = async () => {
    if (activeDevice.resetHardware) {
        addLogEntry("Ejecutando Hard Reset...");
        await activeDevice.resetHardware();
        setStatusMsg("Hardware Reseteado. Intenta conectar.");
    }
  };

  const disconnect = async () => {
    await activeDevice.disconnect();
    setStatus('disconnected');
    setStatusMsg("Desconectado");
    setTemp(null);
    setLamp(false);
  };

  const toggleLamp = async () => {
    if (status !== 'ready' || isBusy) return;
    setIsBusy(true);
    const newState = !lamp;
    const ok = await activeDevice.setLamp(newState);
    if (ok) {
      setLamp(newState);
      addLogEntry(`Lámpara ${newState ? 'ENCENDIDA' : 'APAGADA'}`);
      const t = await activeDevice.getTemperature();
      if (t !== null) setTemp(t);
    }
    setIsBusy(false);
  };

  const calibrate = async (type: 'dark' | 'white') => {
    if (isBusy) return;
    setIsBusy(true);
    addLogEntry(`Iniciando calibración ${type.toUpperCase()}...`);
    const data = await activeDevice.scan();
    if (data) {
      if (type === 'dark') setDarkRef(data);
      else setWhiteRef(data);
      setStatusMsg(`Calibración ${type} OK`);
      addLogEntry(`Calibración ${type} exitosa.`);
    } else {
      setStatusMsg(`Error al leer ${type}`);
      addLogEntry(`Fallo calibración ${type} (Scan null)`);
    }
    setIsBusy(false);
  };

  const measure = async () => {
    if (isBusy) return;
    setIsBusy(true);
    addLogEntry("Iniciando análisis de muestra...");
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
      addLogEntry(`Análisis completado. Predicción: ${score.toFixed(2)}%`);
      getAIInterpretation(plotData, score.toFixed(2), lamp ? 'ok' : 'off').then(setAiAnalysis);
    } else {
       if(!raw) {
         setStatusMsg("Error en escaneo");
         addLogEntry("Error: El equipo no devolvió datos espectrales.");
       } else {
         setStatusMsg("Falta Calibración");
         addLogEntry("Error: Debes realizar Dark y White antes de analizar.");
       }
    }
    setIsBusy(false);
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
          <p className="text-xs text-slate-500 font-mono mt-1 uppercase ml-1">Protocol Safe v15.2 • VIAVI Core • {connectionType.toUpperCase()}</p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="text-right mr-2 hidden md:block">
            <p className={`text-xs font-bold ${status==='ready' ? 'text-emerald-400' : status==='error' ? 'text-red-400' : 'text-amber-400'}`}>
              {statusMsg}
            </p>
          </div>
          
          {status === 'disconnected' && (
            <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
              <button onClick={() => setConnectionType('usb')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${connectionType === 'usb' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}><Usb size={12} /></button>
              <button onClick={() => setConnectionType('ble')} className={`px-3 py-1 rounded text-xs font-bold transition-all ${connectionType === 'ble' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><Bluetooth size={12} /></button>
            </div>
          )}
          
          {status === 'disconnected' || status === 'error' ? (
             <div className="flex gap-2">
                <button onClick={connect} disabled={isBusy} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2">
                    {isBusy ? <RefreshCw className="animate-spin" size={20}/> : <Power size={20} />} 
                    {status === 'error' ? 'REINTENTAR' : 'CONECTAR'}
                </button>
                {status === 'error' && (
                    <button onClick={hardReset} className="bg-slate-800 text-slate-400 px-3 py-3 rounded-xl hover:bg-slate-700" title="Hard Reset Sensor">
                        <Trash2 size={20} />
                    </button>
                )}
            </div>
          ) : (
            <div className="flex gap-3">
               <button onClick={disconnect} className="bg-slate-800 text-slate-400 px-3 py-3 rounded-xl hover:bg-red-900/30 transition-all"><Power size={18} /></button>
              <button 
                onClick={toggleLamp} 
                disabled={isBusy} 
                className={`px-5 py-3 rounded-xl font-bold border flex items-center gap-2 transition-all duration-500 ${
                  lamp 
                    ? 'bg-yellow-400 text-slate-900 border-yellow-200 shadow-[0_0_20px_rgba(250,204,21,0.7)]' 
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                <Zap size={18} fill={lamp ? "currentColor" : "none"} className={lamp ? "animate-pulse" : ""} /> {lamp ? 'LÁMPARA ON' : 'ENCENDER LÁMPARA'}
              </button>
              <div className="bg-slate-800 px-5 py-3 rounded-xl flex items-center gap-2 border border-slate-700 min-w-[100px] justify-center">
                <Thermometer size={18} className={temp !== null ? "text-emerald-400" : "text-slate-600"}/>
                <span className="font-mono font-bold text-lg">{temp !== null ? temp.toFixed(1) : '--'}°C</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6">Secuencia de Calibración</h3>
            <div className="space-y-3">
              <button disabled={status !== 'ready' || !lamp || isBusy} onClick={() => calibrate('dark')} className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all ${darkRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                <span>{(!lamp && status === 'ready') ? 'REQ. LÁMPARA ENCENDIDA' : '1. REF. OSCURA (TAPAR)'}</span>
                {darkRef && <CheckCircle2 size={18} />}
              </button>
              <button disabled={status !== 'ready' || !lamp || isBusy} onClick={() => calibrate('white')} className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all ${whiteRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                <span>{(!lamp && status === 'ready') ? 'REQ. LÁMPARA ENCENDIDA' : '2. REF. BLANCA (MUESTRA)'}</span>
                {whiteRef && <CheckCircle2 size={18} />}
              </button>
            </div>
          </div>
          <button disabled={!darkRef || !whiteRef || !lamp || isBusy} onClick={measure} className={`w-full py-8 rounded-3xl font-black text-xl uppercase flex items-center justify-center gap-3 transition-all ${(darkRef && whiteRef && lamp && !isBusy) ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-800 text-slate-600'}`}>
            {isBusy ? <RefreshCw className="animate-spin" size={28} /> : <Activity size={28} />} Analizar Muestra
          </button>
           <div className={`bg-slate-900 p-8 rounded-3xl border text-center transition-all ${prediction !== "--" ? 'border-emerald-500/30 bg-slate-900/80' : 'border-slate-800'}`}>
               <span className="text-xs text-slate-500 font-bold uppercase block mb-2 tracking-tighter">Resultado Análisis de Proteína</span>
               <div className="flex items-baseline justify-center gap-1"><span className="text-7xl font-black text-white">{prediction}</span><span className="text-2xl text-slate-600 font-bold">%</span></div>
            </div>
        </div>

        <div className="lg:col-span-8 bg-slate-900/50 p-6 rounded-3xl border border-slate-800 flex flex-col min-h-[500px]">
          <div className="flex justify-between items-center mb-6 px-2">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest"><BarChart3 size={14} className="inline mr-2" /> Espectro NIR (900-1700nm)</h3>
            {aiAnalysis && <div className="bg-blue-500/10 px-4 py-2 rounded-xl border border-blue-500/20 text-[11px] text-blue-200 animate-in fade-in slide-in-from-top-1">{aiAnalysis}</div>}
          </div>
          <div className="flex-1 w-full bg-slate-950/30 rounded-2xl border border-slate-800/50 p-4">
             <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectrum} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickFormatter={v => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={10} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                  <Area type="monotone" dataKey="absorbance" stroke="#3b82f6" fillOpacity={0.4} fill="url(#colorAbs)" />
                </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 bg-slate-950/95 border-t border-slate-800 transition-all ${showLogs ? 'h-80' : 'h-10'}`}>
        <div className="flex items-center justify-between px-4 h-10 bg-slate-900 cursor-pointer" onClick={() => setShowLogs(!showLogs)}>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400"><Terminal size={14} /> <b>TERMINAL HARDWARE</b></div>
            <button onClick={(e) => { e.stopPropagation(); setLogs([]); }} className="text-slate-500 hover:text-red-400"><Trash2 size={14} /></button>
        </div>
        {showLogs && (
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-1">
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
