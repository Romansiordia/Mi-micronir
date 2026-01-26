
import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, RefreshCw, Zap, Terminal, Bluetooth, Usb, 
  ShieldCheck, Droplet, Layers, CheckCircle2, Sliders, Info, Cpu
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { bleDevice } from './services/bleService';
import { device as usbDevice } from './services/usbService';
import { getAIInterpretation } from './services/geminiService';
import { CDM_MODEL } from './constants';
import { WavelengthPoint, PredictionResult, CalibrationData } from './types';

// Motor de simulación química realista
const generateSpectrum = (type: 'dark' | 'white' | 'sample'): Uint16Array => {
  const data = new Uint16Array(128);
  for (let i = 0; i < 128; i++) {
    const nm = 900 + (i * 6.25);
    if (type === 'dark') data[i] = Math.random() * 100;
    else if (type === 'white') data[i] = 45000 + Math.random() * 2000;
    else {
      // Pico de agua en 1450nm, grasa en 1200nm
      const base = 40000 * Math.sin((i / 128) * Math.PI);
      const water = 12000 * Math.exp(-Math.pow((nm - 1450) / 40, 2));
      const fat = 6000 * Math.exp(-Math.pow((nm - 1200) / 30, 2));
      data[i] = Math.max(100, (base - water - fat) * (0.9 + Math.random() * 0.1));
    }
  }
  return data;
};

export default function App() {
  const [isSim, setIsSim] = useState(true);
  const [connMode, setConnMode] = useState<'USB' | 'BLE'>('USB');
  const [status, setStatus] = useState<'off' | 'on' | 'busy'>('off');
  const [logs, setLogs] = useState<string[]>([]);
  const [calib, setCalib] = useState<CalibrationData>({ dark: null, reference: null, step: 'none' });
  const [chartData, setChartData] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [aiReport, setAiReport] = useState<string>("");

  const log = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 40)]);
  };

  useEffect(() => {
    usbDevice.setLogger(log);
    bleDevice.setLogger(log);
  }, []);

  const handleConnect = async () => {
    setStatus('busy');
    log(`Iniciando conexión (${isSim ? 'SIMULADOR' : connMode})...`);
    if (isSim) {
      await new Promise(r => setTimeout(r, 800));
      setStatus('on');
      log("SIMULACIÓN ACTIVA.");
    } else {
      const dev = connMode === 'USB' ? usbDevice : bleDevice;
      const res = await dev.connect();
      if (res === "OK" || typeof res === 'object') {
        setStatus('on');
        log("EQUIPO REAL CONECTADO.");
      } else {
        setStatus('off');
        log(`FALLO: ${res}`);
      }
    }
  };

  const runCalibration = async (type: 'dark' | 'white') => {
    setStatus('busy');
    log(`Capturando ${type.toUpperCase()}...`);
    await new Promise(r => setTimeout(r, 1000));
    
    let raw;
    if (isSim) {
      raw = generateSpectrum(type === 'dark' ? 'dark' : 'white');
    } else {
      const dev = connMode === 'USB' ? usbDevice : bleDevice;
      raw = await dev.scan(type === 'dark');
    }

    if (raw) {
      setCalib(prev => ({ 
        ...prev, 
        [type === 'dark' ? 'dark' : 'reference']: Array.from(raw),
        step: type === 'dark' ? 'dark' : 'reference' 
      }));
      log(`${type.toUpperCase()} completado.`);
    }
    setStatus('on');
  };

  const handleScan = async () => {
    if (!calib.dark || !calib.reference) return alert("Calibración incompleta");
    setStatus('busy');
    log("Escaneando muestra...");
    
    let raw;
    if (isSim) {
      await new Promise(r => setTimeout(r, 1200));
      raw = generateSpectrum('sample');
    } else {
      const dev = connMode === 'USB' ? usbDevice : bleDevice;
      raw = await dev.scan(false);
    }

    if (raw) {
      const processed = CDM_MODEL.wavelengths.map((nm, i) => {
        const D = calib.dark![i];
        const W = calib.reference![i];
        const S = raw[i];
        let reflectance = (S - D) / (W - D);
        if (reflectance <= 0) reflectance = 0.0001;
        return { nm: Math.round(nm), absorbance: -Math.log10(reflectance) };
      });

      setChartData(processed);
      
      // Modelo predictivo básico basado en picos
      const h = processed.find(p => p.nm >= 1440 && p.nm <= 1460)?.absorbance || 0;
      const p = processed.find(p => p.nm >= 1190 && p.nm <= 1210)?.absorbance || 0;
      const pred = {
        moisture: (h * 15.2) + 1.5,
        protein: (p * 12.8) + 4.2,
        fat: Math.max(2.1, 35 - (h * 10 + p * 8))
      };
      setPrediction(pred);
      
      log("Análisis completado. Consultando IA...");
      const ai = await getAIInterpretation(processed, pred, 'ok');
      setAiReport(ai || "Análisis de IA no disponible.");
    }
    setStatus('on');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 flex flex-col gap-6 font-sans">
      {/* CABECERA */}
      <header className="flex justify-between items-center bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-900/40">
            <Activity size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight uppercase">QualiControl <span className="text-blue-500">v1.0</span></h1>
            <p className="text-xs font-bold text-slate-500 tracking-widest uppercase">Sistema de Espectroscopia Base</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center bg-slate-800 px-4 py-2 rounded-xl border border-slate-700">
            <input type="checkbox" id="sim" checked={isSim} onChange={e => setIsSim(e.target.checked)} className="w-4 h-4 accent-blue-500 cursor-pointer" />
            <label htmlFor="sim" className="ml-2 text-[10px] font-black uppercase text-slate-400">Simulación</label>
          </div>
          
          {status === 'off' ? (
            <button onClick={handleConnect} disabled={status === 'busy'} className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-900/20">
              <Cpu size={18} /> CONECTAR
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => runCalibration('dark')} disabled={status === 'busy'} className={`px-4 py-3 rounded-xl font-bold text-xs uppercase border ${calib.dark ? 'bg-emerald-900/30 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700'}`}>DARK</button>
              <button onClick={() => runCalibration('white')} disabled={status === 'busy' || !calib.dark} className={`px-4 py-3 rounded-xl font-bold text-xs uppercase border ${calib.reference ? 'bg-emerald-900/30 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700'}`}>WHITE</button>
              <button onClick={handleScan} disabled={status === 'busy' || !calib.reference} className="bg-indigo-600 hover:bg-indigo-500 px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-900/20">
                <Zap size={18} /> ESCANEAR
              </button>
            </div>
          )}
        </div>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        
        {/* LADO IZQUIERDO: Gráfico y Resultados */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Tarjetas de Resultados */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ResultCard title="Humedad" value={prediction ? `${prediction.moisture.toFixed(2)}%` : '--.--%'} icon={<Droplet className="text-blue-400"/>} color="blue" />
            <ResultCard title="Proteína" value={prediction ? `${prediction.protein.toFixed(2)}%` : '--.--%'} icon={<Activity className="text-purple-400"/>} color="purple" />
            <ResultCard title="Grasa" value={prediction ? `${prediction.fat.toFixed(2)}%` : '--.--%'} icon={<Layers className="text-amber-400"/>} color="amber" />
          </div>

          {/* Gráfico */}
          <div className="flex-1 bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-inner relative min-h-[400px]">
            <h3 className="absolute top-6 left-8 text-xs font-black text-slate-500 uppercase tracking-widest">Espectro de Absorbancia (nm)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickMargin={10} domain={[900, 1700]} />
                <YAxis stroke="#475569" fontSize={10} tickMargin={10} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px' }} />
                <ReferenceLine x={1200} stroke="#f59e0b" strokeDasharray="3 3" label={{ position: 'top', value: 'Grasa', fill: '#f59e0b', fontSize: 10 }} />
                <ReferenceLine x={1450} stroke="#3b82f6" strokeDasharray="3 3" label={{ position: 'top', value: 'Agua', fill: '#3b82f6', fontSize: 10 }} />
                <Line type="monotone" dataKey="absorbance" stroke="#3b82f6" strokeWidth={3} dot={false} animationDuration={400} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* LADO DERECHO: IA y Logs */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-indigo-900/20 border border-indigo-500/30 p-8 rounded-[2.5rem] shadow-2xl">
            <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <ShieldCheck size={16} /> Diagnóstico Gemini IA
            </h4>
            <p className="text-sm text-slate-300 italic leading-relaxed">
              {aiReport || "Inicie un escaneo para recibir el análisis detallado de la muestra."}
            </p>
          </div>

          <div className="flex-1 bg-black/40 rounded-[2.5rem] border border-slate-800 flex flex-col overflow-hidden">
            <div className="p-4 bg-slate-900/50 border-b border-slate-800 flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase">
              <Terminal size={12} /> Terminal de Sistema
            </div>
            <div className="flex-1 overflow-y-auto p-6 font-mono text-[10px] space-y-2 text-slate-400">
              {logs.map((msg, i) => (
                <div key={i} className={msg.includes('ERROR') ? 'text-red-400' : msg.includes('OK') ? 'text-emerald-400' : ''}>{msg}</div>
              ))}
              {logs.length === 0 && <div className="opacity-20 italic">Listo para conexión...</div>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ResultCard({ title, value, icon, color }: any) {
  const themes: any = {
    blue: "bg-blue-500/5 border-blue-500/20",
    purple: "bg-purple-500/5 border-purple-500/20",
    amber: "bg-amber-500/5 border-amber-500/20"
  };
  return (
    <div className={`p-6 rounded-3xl border ${themes[color]} flex items-center justify-between`}>
      <div>
        <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">{title}</span>
        <div className="text-3xl font-black mt-1">{value}</div>
      </div>
      <div className="p-3 bg-slate-950/50 rounded-2xl">{icon}</div>
    </div>
  );
}
