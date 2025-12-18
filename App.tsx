
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { 
  Usb, Activity, CheckCircle2, 
  Play, RefreshCw, Cpu, Terminal, BrainCircuit,
  Moon, Sun, FlaskConical, Settings2, Database, AlertTriangle
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

  const addLog = useCallback((message: string, type: LogEntry['type']) => {
    setLogs(prev => [{ timestamp: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 30));
  }, []);

  const handleConnect = async () => {
    addLog("USB: Iniciando protocolo de enlace (Handshake)...", "info");
    const success = await microNir.connect();
    if (success) {
      setIsConnected(true);
      setSimulationMode(false);
      addLog("CONEXIÓN: Chip FTDI configurado. Esperando comandos.", "success");
    } else {
      addLog("ERROR: El sistema operativo bloqueó el acceso o el equipo no responde.", "error");
    }
  };

  const toggleLamp = async () => {
    const nextOn = lampStatus !== 'ok';
    const ok = await microNir.setLamp(nextOn);
    if (ok) {
      setLampStatus(nextOn ? 'ok' : 'off');
      addLog(`LAMP: Cambio de estado a ${nextOn ? 'ENCENDIDO' : 'APAGADO'}`, "success");
    } else {
      addLog("LAMP: El hardware no confirmó el comando de luz.", "warning");
    }
  };

  const runCalibration = async (type: 'dark' | 'reference') => {
    setIsMeasuring(true);
    addLog(`CALIB: Capturando referencia ${type.toUpperCase()}...`, "info");
    try {
      const raw = await microNir.readSpectrum();
      if (raw && raw.length > 10) {
        setCalib(prev => ({
          ...prev,
          [type]: Array.from(raw),
          step: (type === 'dark' && !!prev.reference) || (type === 'reference' && !!prev.dark) ? 'ready' : type
        }));
        addLog(`OK: ${type.toUpperCase()} guardado (${raw.length} puntos).`, "success");
      } else {
        addLog(`ERROR: El sensor envió un paquete vacío. Revisa la conexión.`, "error");
      }
    } finally {
      setIsMeasuring(false);
    }
  };

  const runScan = async () => {
    setIsMeasuring(true);
    try {
      const raw = await microNir.readSpectrum();
      if (raw && raw.length > 10) {
        const sample = Array.from(raw);
        // Procesamiento Quimiométrico
        const absData = sample.map((s, i) => {
          const d = calib.dark?.[i] || 0;
          const r = calib.reference?.[i] || 65535;
          const refl = Math.min(Math.max((s - d) / Math.max(r - d, 1), 0.0001), 1.0);
          return -Math.log10(refl);
        });

        let sum = CDM_MODEL.bias;
        absData.forEach((val, i) => {
          if (CDM_MODEL.betaCoefficients[i]) sum += val * CDM_MODEL.betaCoefficients[i];
        });

        const val = parseFloat(sum.toFixed(2));
        setPrediction(val.toString());
        const currentData = CDM_MODEL.wavelengths.map((nm, i) => ({ nm, absorbance: absData[i] }));
        setSpectralData(currentData);
        addLog(`SCAN: Predicción final ${val}%`, "success");
        
        getAIInterpretation(currentData, val.toString(), lampStatus).then(setAiInsight);
      }
    } finally {
      setIsMeasuring(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-4 lg:p-10">
      <nav className="glass-panel p-6 rounded-3xl mb-8 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-xl ${isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
            <Cpu size={24} className={isConnected && !simulationMode ? 'animate-pulse' : ''} />
          </div>
          <div>
            <h1 className="font-black text-xl tracking-tighter uppercase italic text-white">Quantum NIR Control</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Driver WebUSB v3.1</p>
          </div>
        </div>
        <div className="flex gap-4">
          {!isConnected ? (
            <button onClick={handleConnect} className="bg-blue-600 px-6 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-blue-500 transition-all">
              <Usb size={18} /> VINCULAR EQUIPO
            </button>
          ) : (
            <button onClick={toggleLamp} className={`px-6 py-2.5 rounded-full font-bold text-sm border transition-all ${lampStatus === 'ok' ? 'bg-orange-500/20 border-orange-500/50 text-orange-400' : 'bg-slate-800 border-white/5 text-slate-500'}`}>
              {lampStatus === 'ok' ? 'LÁMPARA ON' : 'LÁMPARA OFF'}
            </button>
          )}
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <aside className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-6 rounded-3xl border-white/5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase mb-6 flex items-center gap-2 tracking-widest">
              <FlaskConical size={14} /> Procedimiento Inicial
            </h3>
            <div className="space-y-3">
              <button disabled={!isConnected || isMeasuring} onClick={() => runCalibration('dark')} className={`w-full flex justify-between items-center p-4 rounded-2xl border transition-all ${calib.dark ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-white/5 hover:border-blue-500/50'}`}>
                <div className="flex items-center gap-3"><Moon size={18} /><span className="text-xs font-bold uppercase">Lectura Dark</span></div>
                {calib.dark && <CheckCircle2 size={16} />}
              </button>
              <button disabled={!isConnected || isMeasuring} onClick={() => runCalibration('reference')} className={`w-full flex justify-between items-center p-4 rounded-2xl border transition-all ${calib.reference ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-white/5 hover:border-blue-500/50'}`}>
                <div className="flex items-center gap-3"><Sun size={18} /><span className="text-xs font-bold uppercase">Lectura White</span></div>
                {calib.reference && <CheckCircle2 size={16} />}
              </button>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-3xl border-white/5">
            <h3 className="text-[10px] font-black text-slate-500 uppercase mb-4 flex items-center gap-2 tracking-widest">
              <Terminal size={14} /> Logs de Hardware
            </h3>
            <div className="h-64 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {logs.map((l, i) => (
                <div key={i} className={`text-[10px] p-2 rounded-lg border ${l.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-slate-900/50 border-white/5 text-slate-400'}`}>
                  <span className="opacity-40 mr-2">[{l.timestamp}]</span>{l.message}
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="lg:col-span-8 space-y-6">
          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5 relative shadow-2xl">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black italic text-white flex items-center gap-3">
                <Activity className="text-blue-500" /> Espectro Infrarrojo
              </h2>
              <div className="bg-slate-950 p-4 rounded-2xl border border-white/5 text-center min-w-[150px]">
                <span className="text-[10px] font-bold text-slate-500 block mb-1">PROTEÍNA</span>
                <span className="text-4xl font-black text-emerald-400">{prediction || '--.--'}<small className="text-xs ml-1 opacity-50">%</small></span>
              </div>
            </div>

            <div className="h-[350px] w-full mb-8">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectralData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.1} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickFormatter={v => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={10} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '12px' }} />
                  <Area type="monotone" dataKey="absorbance" stroke="#3b82f6" fillOpacity={0.1} fill="#3b82f6" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {aiInsight && (
              <div className="mb-6 p-5 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex gap-4">
                <BrainCircuit className="text-blue-400 shrink-0" size={20} />
                <p className="text-xs text-slate-300 leading-relaxed italic">"{aiInsight}"</p>
              </div>
            )}

            <button 
              disabled={!isConnected || isMeasuring || calib.step !== 'ready'} 
              onClick={runScan}
              className={`w-full py-6 rounded-2xl font-black text-xl uppercase transition-all flex items-center justify-center gap-4 ${isConnected && calib.step === 'ready' ? 'bg-white text-black hover:bg-emerald-500 hover:text-white' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
            >
              {isMeasuring ? <RefreshCw className="animate-spin" /> : <Play fill="currentColor" />}
              Realizar Escaneo Analítico
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
