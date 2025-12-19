
import React, { useState, useEffect } from 'react';
import { 
  Usb, Activity, RefreshCw, Zap, AlertCircle, CheckCircle2, 
  BarChart3, Settings2, ShieldCheck, Thermometer, Power, Bluetooth
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { device as usbDevice } from './services/usbService';
import { bleDevice } from './services/bleService';
import { CDM_MODEL } from './constants';
import { getAIInterpretation } from './services/geminiService';
import { WavelengthPoint } from './types';

// Interfaz unificada para usar cualquiera de los dos drivers
interface IDeviceDriver {
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  setLamp(on: boolean): Promise<boolean>;
  getTemperature(): Promise<number | null>;
  scan(): Promise<Uint16Array | null>;
  isConnected: boolean;
}

export default function App() {
  const [connectionType, setConnectionType] = useState<'usb' | 'ble'>('usb');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'ready' | 'error'>('disconnected');
  const [statusMsg, setStatusMsg] = useState("Listo para conectar");
  const [temp, setTemp] = useState<number | null>(null);
  const [lamp, setLamp] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  
  const [darkRef, setDarkRef] = useState<Uint16Array | null>(null);
  const [whiteRef, setWhiteRef] = useState<Uint16Array | null>(null);
  const [spectrum, setSpectrum] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<string>("--");
  const [aiAnalysis, setAiAnalysis] = useState<string>("");

  // Selector del driver activo
  const activeDevice: IDeviceDriver = connectionType === 'usb' ? usbDevice : bleDevice;

  const log = (msg: string) => setStatusMsg(msg);

  const connect = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setStatus('connecting');
    log(connectionType === 'usb' ? "Iniciando USB..." : "Buscando BLE...");
    
    try {
      const res = await activeDevice.connect();
      if (res === "OK") {
        log("Conectado. Obteniendo telemetría...");
        
        // Esperar un poco más en BLE
        if (connectionType === 'ble') await new Promise(r => setTimeout(r, 500));

        const t = await activeDevice.getTemperature();
        
        if (t !== null) {
          setTemp(t);
          setStatus('ready');
          log(`En línea (${connectionType.toUpperCase()}). Temp: ${t.toFixed(1)}°C`);
        } else {
          setStatus('error');
          log("Conectado, pero sensor no responde datos.");
          await activeDevice.disconnect();
        }
      } else {
        setStatus('error');
        log(`Error Conexión: ${res}`);
      }
    } catch (e) {
      setStatus('error');
      log("Excepción al conectar.");
    }
    setIsBusy(false);
  };

  const toggleLamp = async () => {
    if (status !== 'ready' || isBusy) return;
    setIsBusy(true);
    const newState = !lamp;
    log(newState ? "Calentando lámpara..." : "Apagando lámpara...");
    
    const ok = await activeDevice.setLamp(newState);
    if (ok) {
      setLamp(newState);
      log(newState ? "Lámpara ESTABLE" : "Lámpara OFF");
    } else {
      log("Error: Fallo al cambiar estado de lámpara");
    }
    setIsBusy(false);
  };

  const calibrate = async (type: 'dark' | 'white') => {
    if (isBusy) return;
    setIsBusy(true);
    log(`Capturando referencia ${type.toUpperCase()}...`);
    
    const data = await activeDevice.scan();
    if (data) {
      if (type === 'dark') setDarkRef(data);
      else setWhiteRef(data);
      log(`Referencia ${type} guardada OK.`);
    } else {
      log("Error de lectura (Timeout o datos corruptos)");
    }
    setIsBusy(false);
  };

  const measure = async () => {
    if (!darkRef || !whiteRef || isBusy) {
      log("Falta calibración o el dispositivo está ocupado");
      return;
    }
    
    setIsBusy(true);
    log("Midiendo muestra...");
    const raw = await activeDevice.scan();
    
    if (raw) {
      const plotData: WavelengthPoint[] = [];
      const absData: number[] = [];
      
      for(let i=0; i<raw.length; i++) {
        const d = darkRef[i];
        const w = whiteRef[i];
        const s = raw[i];
        
        const denominator = Math.max((w - d), 1.0);
        let reflectance = (s - d) / denominator;
        reflectance = Math.max(0.0001, Math.min(reflectance, 1.5));

        const abs = -Math.log10(reflectance);
        absData.push(abs);
        
        const wl = 908 + (i * 6.25);
        plotData.push({ nm: Math.round(wl), absorbance: abs });
      }

      setSpectrum(plotData);

      let score = CDM_MODEL.bias;
      const limit = Math.min(absData.length, CDM_MODEL.betaCoefficients.length);
      for(let i=0; i<limit; i++) {
        score += absData[i] * CDM_MODEL.betaCoefficients[i];
      }
      
      const result = score.toFixed(2);
      setPrediction(result);
      log("Análisis completado.");

      getAIInterpretation(plotData, result, lamp ? 'ok' : 'off').then(setAiAnalysis);
    } else {
      log("Error en escaneo de muestra.");
    }
    setIsBusy(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans">
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 bg-slate-900/80 backdrop-blur p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div className="mb-4 md:mb-0">
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
            <ShieldCheck className="text-blue-500" />
            MicroNIR <span className="text-blue-400 bg-blue-500/10 px-2 rounded text-lg border border-blue-500/20">QUANTUM</span>
          </h1>
          <p className="text-xs text-slate-500 font-mono mt-1 uppercase ml-1">v4.1.0 Dual Link • {connectionType === 'usb' ? 'FTDI Mode' : 'BLE Mode'}</p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="text-right mr-2 hidden md:block">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sistema</p>
            <p className={`text-xs font-bold ${status==='ready' ? 'text-emerald-400' : status==='error' ? 'text-red-400' : 'text-amber-400'}`}>
              {statusMsg}
            </p>
          </div>
          
          {/* Selector de Modo */}
          {status === 'disconnected' && (
            <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
              <button 
                onClick={() => setConnectionType('usb')}
                className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all ${connectionType === 'usb' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                <Usb size={12} /> USB
              </button>
              <button 
                onClick={() => setConnectionType('ble')}
                className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all ${connectionType === 'ble' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                <Bluetooth size={12} /> BLE
              </button>
            </div>
          )}
          
          {status === 'disconnected' || status === 'error' ? (
            <button onClick={connect} disabled={isBusy} className={`bg-gradient-to-r ${connectionType === 'usb' ? 'from-blue-600 to-blue-500' : 'from-indigo-600 to-indigo-500'} hover:opacity-90 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg`}>
              {isBusy ? <RefreshCw className="animate-spin" size={20}/> : (connectionType === 'usb' ? <Usb size={20} /> : <Bluetooth size={20} />)} 
              {status === 'error' ? 'REINTENTAR' : 'CONECTAR'}
            </button>
          ) : (
            <div className="flex gap-3">
              <button 
                onClick={toggleLamp} 
                disabled={isBusy}
                className={`px-5 py-3 rounded-xl font-bold border flex items-center gap-2 transition-all ${lamp ? 'bg-orange-500 text-white border-orange-400 shadow-lg shadow-orange-900/20' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
              >
                <Zap size={18} fill={lamp ? "currentColor" : "none"} />
                {lamp ? 'LÁMPARA ON' : 'LÁMPARA OFF'}
              </button>
              
              <div className="bg-slate-800 px-5 py-3 rounded-xl flex items-center gap-2 border border-slate-700 shadow-inner">
                <Thermometer size={18} className="text-emerald-400"/>
                <span className="font-mono font-bold text-lg">{temp ? temp.toFixed(1) : '--'}°C</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Panel de Control */}
        <div className="lg:col-span-4 space-y-6">
          {/* Calibración */}
          <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Settings2 size={100} />
            </div>
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6 flex gap-2 items-center relative z-10">
              <Settings2 size={14} /> Secuencia de Calibración
            </h3>
            
            <div className="space-y-3 relative z-10">
              <button 
                disabled={status !== 'ready' || !lamp || isBusy}
                onClick={() => calibrate('dark')}
                className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all ${darkRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 border-white/5 hover:border-blue-500/30 text-slate-400'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-slate-950 border border-slate-700"></div>
                  <span className="font-bold text-sm">REFERENCIA OSCURA</span>
                </div>
                {darkRef ? <CheckCircle2 size={18} /> : <span className="text-[10px] opacity-50">REQUERIDO</span>}
              </button>

              <button 
                disabled={status !== 'ready' || !lamp || isBusy}
                onClick={() => calibrate('white')}
                className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all ${whiteRef ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800 border-white/5 hover:border-blue-500/30 text-slate-400'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-white border border-slate-200"></div>
                  <span className="font-bold text-sm">REFERENCIA BLANCA</span>
                </div>
                {whiteRef ? <CheckCircle2 size={18} /> : <span className="text-[10px] opacity-50">REQUERIDO</span>}
              </button>
            </div>
          </div>

          {/* Botón Principal */}
          <button 
            disabled={!darkRef || !whiteRef || !lamp || isBusy}
            onClick={measure}
            className={`w-full py-8 rounded-3xl font-black text-xl uppercase tracking-wider shadow-2xl transition-all flex items-center justify-center gap-3 relative overflow-hidden
              ${(darkRef && whiteRef && lamp && !isBusy) 
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-900/30 transform hover:scale-[1.02]' 
                : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700 grayscale opacity-70'}`}
          >
            {isBusy ? <RefreshCw className="animate-spin" size={28} /> : <Activity size={28} />}
            {isBusy ? 'Procesando...' : 'Analizar Muestra'}
          </button>

           {/* Resultado */}
           <div className={`bg-slate-900 p-8 rounded-3xl border text-center transition-all duration-500 ${prediction !== "--" ? 'border-emerald-500/30 bg-emerald-900/10' : 'border-slate-800'}`}>
               <span className="text-xs text-slate-500 font-bold uppercase tracking-widest block mb-2">Contenido de Proteína</span>
               <div className="flex items-baseline justify-center gap-1">
                 <span className={`text-7xl font-black tracking-tighter ${prediction !== "--" ? 'text-white' : 'text-slate-700'}`}>{prediction}</span>
                 <span className="text-2xl text-slate-600 font-bold">%</span>
               </div>
               {prediction !== "--" && <div className="mt-4 text-[10px] text-emerald-500 font-bold uppercase tracking-widest bg-emerald-500/10 inline-block px-3 py-1 rounded-full">Análisis Completado</div>}
            </div>
        </div>

        {/* Gráfico */}
        <div className="lg:col-span-8 bg-slate-900/50 p-6 rounded-3xl border border-slate-800 flex flex-col min-h-[500px]">
          <div className="flex justify-between items-center mb-6 px-2">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex gap-2 items-center">
              <BarChart3 size={14} /> Espectro de Absorbancia (NIR)
            </h3>
            {aiAnalysis && (
              <div className="bg-blue-500/10 px-4 py-2 rounded-xl border border-blue-500/20 flex items-center gap-3 max-w-md">
                 <div className="bg-blue-500 rounded-full p-1"><Zap size={10} className="text-white" /></div>
                 <span className="text-[11px] text-blue-200 font-medium leading-tight">{aiAnalysis}</span>
              </div>
            )}
          </div>
          
          <div className="flex-1 w-full bg-slate-950/30 rounded-2xl border border-slate-800/50 p-4 relative">
             <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectrum} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={connectionType==='usb' ? "#3b82f6" : "#6366f1"} stopOpacity={0.4}/>
                      <stop offset="95%" stopColor={connectionType==='usb' ? "#3b82f6" : "#6366f1"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `${v} nm`} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} domain={[0, 'auto']} />
                  <Tooltip 
                    contentStyle={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid #334155', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)' }}
                    itemStyle={{ color: '#60a5fa' }}
                    labelStyle={{ color: '#94a3b8', fontSize: '10px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}
                  />
                  <Area type="monotone" dataKey="absorbance" stroke={connectionType==='usb' ? "#3b82f6" : "#6366f1"} strokeWidth={3} fill="url(#colorAbs)" animationDuration={1500} />
                </AreaChart>
              </ResponsiveContainer>
              
              {spectrum.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700 pointer-events-none">
                  <Activity size={48} className="mb-4 opacity-20" />
                  <p className="text-sm font-bold uppercase tracking-widest opacity-40">Esperando adquisición de datos</p>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
