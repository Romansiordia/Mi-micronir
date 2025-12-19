
import React, { useState, useEffect } from 'react';
import { 
  Usb, Activity, RefreshCw, Zap, AlertCircle, CheckCircle2, 
  BarChart3, Settings2, ShieldCheck, Thermometer
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { device } from './services/usbService';
import { CDM_MODEL } from './constants';
import { getAIInterpretation } from './services/geminiService';
import { WavelengthPoint } from './types';

export default function App() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'ready' | 'error'>('disconnected');
  const [statusMsg, setStatusMsg] = useState("Esperando dispositivo USB...");
  const [temp, setTemp] = useState<number | null>(null);
  const [lamp, setLamp] = useState(false);
  
  // Datos Espectrales
  const [darkRef, setDarkRef] = useState<Uint16Array | null>(null);
  const [whiteRef, setWhiteRef] = useState<Uint16Array | null>(null);
  const [spectrum, setSpectrum] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<string>("--");
  const [aiAnalysis, setAiAnalysis] = useState<string>("");

  const log = (msg: string) => setStatusMsg(msg);

  const connect = async () => {
    setStatus('connecting');
    log("Solicitando permiso USB...");
    
    const res = await device.connect();
    if (res === "OK") {
      log("Puerto abierto. Verificando sensor...");
      // Verificar vida del sensor leyendo temperatura
      const t = await device.getTemperature();
      if (t !== null) {
        setTemp(t);
        setStatus('ready');
        log(`Conectado. Temp: ${t.toFixed(1)}°C`);
      } else {
        setStatus('error');
        log("Error: Sensor no responde (Revise DTR/Power)");
      }
    } else {
      setStatus('error');
      log(`Fallo conexión: ${res}`);
    }
  };

  const toggleLamp = async () => {
    if (status !== 'ready') return;
    const newState = !lamp;
    log(newState ? "Encendiendo Lámpara..." : "Apagando...");
    
    const ok = await device.setLamp(newState);
    if (ok) {
      setLamp(newState);
      log(newState ? "Lámpara ON (Estable)" : "Lámpara OFF");
    } else {
      log("Error enviando comando Lámpara");
    }
  };

  const calibrate = async (type: 'dark' | 'white') => {
    log(`Adquiriendo referencia ${type.toUpperCase()}...`);
    const data = await device.scan();
    if (data) {
      if (type === 'dark') setDarkRef(data);
      else setWhiteRef(data);
      log(`Referencia ${type} guardada (${data.length} px)`);
    } else {
      log("Error de lectura: Paquete vacío");
    }
  };

  const measure = async () => {
    if (!darkRef || !whiteRef) {
      log("Error: Se requieren referencias Dark/White");
      return;
    }
    
    log("Escaneando muestra...");
    const raw = await device.scan();
    
    if (raw) {
      // Procesamiento Chemométrico: Absorbancia = -log10((Sample - Dark) / (White - Dark))
      const plotData: WavelengthPoint[] = [];
      const absData: number[] = [];
      
      for(let i=0; i<raw.length; i++) {
        // Evitar división por cero
        const denominator = Math.max((whiteRef[i] - darkRef[i]), 1);
        const numerator = (raw[i] - darkRef[i]);
        let r = numerator / denominator;
        
        // Limites físicos de reflectancia
        if (r <= 0) r = 0.0001;
        if (r > 1.2) r = 1.2;

        const abs = -Math.log10(r);
        absData.push(abs);
        
        // Mapear a longitudes de onda (Aprox 908nm inicio + 6.2nm/pixel)
        const wl = 908 + (i * 6.25);
        plotData.push({ nm: Math.round(wl), absorbance: abs });
      }

      setSpectrum(plotData);

      // Calculo PLS Simple (Producto Punto con coeficientes Beta)
      let score = CDM_MODEL.bias;
      // Usamos los primeros N coeficientes disponibles
      const limit = Math.min(absData.length, CDM_MODEL.betaCoefficients.length);
      for(let i=0; i<limit; i++) {
        score += absData[i] * CDM_MODEL.betaCoefficients[i];
      }
      
      const result = score.toFixed(2);
      setPrediction(result);
      log(`Medición Exitosa. Proteína: ${result}%`);

      // Consulta AI
      getAIInterpretation(plotData, result, lamp ? 'ok' : 'off').then(setAiAnalysis);
    } else {
      log("Error crítico: Lectura fallida");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-6 font-sans">
      {/* Header */}
      <header className="flex justify-between items-center mb-8 bg-slate-900/50 p-6 rounded-2xl border border-white/5">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
            MicroNIR <span className="text-blue-500 bg-blue-500/10 px-2 rounded text-lg">PRO LINK</span>
          </h1>
          <p className="text-xs text-slate-500 font-mono mt-1 uppercase">Driver v3.0 (Strict Hardware)</p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="text-right">
            <p className="text-xs font-bold text-slate-400 uppercase">Estado</p>
            <p className={`text-sm font-bold ${status==='ready' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {statusMsg}
            </p>
          </div>
          {status === 'disconnected' || status === 'error' ? (
            <button onClick={connect} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all">
              <Usb size={20} /> Conectar USB
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={toggleLamp} className={`px-4 py-2 rounded-lg font-bold border ${lamp ? 'bg-orange-500 text-white border-orange-500' : 'bg-slate-800 border-slate-700'}`}>
                {lamp ? 'LÁMPARA ON' : 'LÁMPARA OFF'}
              </button>
              <div className="bg-slate-800 px-4 py-2 rounded-lg flex items-center gap-2 border border-slate-700">
                <Thermometer size={16} className="text-blue-400"/>
                <span className="font-mono font-bold">{temp ? temp.toFixed(1) : '--'}°C</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controles */}
        <div className="space-y-4">
          <div className="bg-slate-900/50 p-6 rounded-2xl border border-white/5">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4 flex gap-2 items-center">
              <Settings2 size={14} /> Calibración
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <button 
                disabled={status !== 'ready' || !lamp}
                onClick={() => calibrate('dark')}
                className={`p-4 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${darkRef ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-slate-800 border-white/5 hover:border-blue-500/50'}`}
              >
                <div className="w-8 h-8 rounded-full bg-black border border-slate-700 mb-1"></div>
                <span className="text-xs font-bold uppercase">Ref. Oscura</span>
              </button>
              <button 
                 disabled={status !== 'ready' || !lamp}
                onClick={() => calibrate('white')}
                className={`p-4 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${whiteRef ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-slate-800 border-white/5 hover:border-blue-500/50'}`}
              >
                <div className="w-8 h-8 rounded-full bg-white mb-1"></div>
                <span className="text-xs font-bold uppercase">Ref. Blanca</span>
              </button>
            </div>
          </div>

          <button 
            disabled={!darkRef || !whiteRef || !lamp}
            onClick={measure}
            className={`w-full py-6 rounded-2xl font-black text-lg uppercase tracking-wide shadow-xl transition-all flex items-center justify-center gap-3
              ${(darkRef && whiteRef && lamp) 
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20' 
                : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-white/5'}`}
          >
            <Activity size={24} /> ANALIZAR MUESTRA
          </button>

           {prediction !== "--" && (
            <div className="bg-slate-900 p-6 rounded-2xl border border-white/10 text-center relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-emerald-500"></div>
               <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">Resultado (Proteína)</span>
               <div className="text-6xl font-black text-white mt-2 tracking-tighter">
                 {prediction}<span className="text-2xl text-slate-600 ml-1">%</span>
               </div>
            </div>
           )}
        </div>

        {/* Gráfico */}
        <div className="lg:col-span-2 bg-slate-900/50 p-6 rounded-2xl border border-white/5 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex gap-2 items-center">
              <BarChart3 size={14} /> Espectro NIR
            </h3>
            {aiAnalysis && (
              <div className="bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20 flex items-center gap-2">
                 <Zap size={12} className="text-blue-400" />
                 <span className="text-[10px] text-blue-300 font-medium italic truncate max-w-[300px]">{aiAnalysis}</span>
              </div>
            )}
          </div>
          
          <div className="flex-1 min-h-[300px] w-full bg-slate-950/50 rounded-xl border border-white/5 p-2">
             <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectrum}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickFormatter={v => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={10} domain={[0, 'auto']} />
                  <Tooltip 
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                    itemStyle={{ color: '#3b82f6' }}
                  />
                  <Area type="monotone" dataKey="absorbance" stroke="#3b82f6" fill="url(#colorAbs)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
              {spectrum.length === 0 && (
                <div className="h-full flex items-center justify-center text-slate-700 text-sm font-medium italic">
                  No hay datos espectrales. Realice una medición.
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
