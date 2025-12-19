
import React, { useState, useCallback } from 'react';
import { 
  Usb, Activity, CheckCircle2, 
  Play, RefreshCw, Cpu, Terminal, BrainCircuit,
  Moon, Sun, FlaskConical, Thermometer, ShieldCheck, Zap
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { WavelengthPoint, LampStatus, LogEntry, CalibrationData, DeviceInfo } from './types';
import { CDM_MODEL } from './constants';
import { getAIInterpretation } from './services/geminiService';
import { microNir } from './services/usbService';

const App: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [lampStatus, setLampStatus] = useState<LampStatus>('off');
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [calib, setCalib] = useState<CalibrationData>({ dark: null, reference: null, step: 'none' });
  const [spectralData, setSpectralData] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

  const addLog = useCallback((message: string, type: LogEntry['type']) => {
    setLogs(prev => [{ timestamp: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 30));
  }, []);

  const handleConnect = async () => {
    addLog("Iniciando handshake MicroNIR...", "info");
    const success = await microNir.connect();
    if (success) {
      setIsConnected(true);
      addLog("Sensor conectado.", "success");
      await updateHardwareStatus();
    } else {
      addLog("Error de conexión USB.", "error");
    }
  };

  const updateHardwareStatus = async () => {
    const temp = await microNir.getTemperature();
    if (temp !== null) {
      setDeviceInfo({
        serialNumber: "SN-9102-OSW",
        model: "On-Site-W",
        temperature: temp,
        firmware: "v2.5.1",
        pixelCount: 128
      });
      addLog(`Temperatura: ${temp.toFixed(1)}°C`, "info");
    }
  };

  const turnOnLamp = async () => {
    addLog("Encendiendo lámpara (calentando...)", "info");
    setIsMeasuring(true);
    const ok = await microNir.setLamp(true);
    if (ok) {
      setLampStatus('ok');
      addLog("Lámpara encendida y lista.", "success");
    } else {
      addLog("Error al encender lámpara.", "error");
    }
    setIsMeasuring(false);
  };

  const turnOffLamp = async () => {
    addLog("Apagando lámpara...", "info");
    setIsMeasuring(true);
    const ok = await microNir.setLamp(false);
    if (ok) {
      setLampStatus('off');
      addLog("Lámpara apagada.", "success");
    } else {
      addLog("Error al apagar lámpara.", "error");
    }
    setIsMeasuring(false);
  };

  const runCalibration = async (type: 'dark' | 'reference') => {
    setIsMeasuring(true);
    addLog(`Capturando ${type.toUpperCase()}...`, "info");
    try {
      const raw = await microNir.readSpectrum();
      if (raw && raw.length > 20) {
        setCalib(prev => ({
          ...prev,
          [type]: Array.from(raw),
          step: (type === 'dark' && !!prev.reference) || (type === 'reference' && !!prev.dark) ? 'ready' : type
        }));
        addLog(`Referencia ${type.toUpperCase()} capturada.`, "success");
      } else {
        addLog("Captura de referencia fallida.", "error");
      }
    } finally {
      setIsMeasuring(false);
    }
  };

  const runScan = async () => {
    setIsMeasuring(true);
    try {
      const raw = await microNir.readSpectrum();
      if (raw && raw.length > 20) {
        const sample = Array.from(raw);
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
        addLog(`Análisis completado: ${val}%`, "success");
        getAIInterpretation(currentData, val.toString(), lampStatus).then(setAiInsight);
      } else {
        addLog("Error al leer el espectro.", "error");
      }
    } finally {
      setIsMeasuring(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-4 lg:p-10">
      <nav className="glass-panel p-6 rounded-3xl mb-8 flex justify-between items-center border border-white/5 shadow-xl">
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-xl ${isConnected ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-500'}`}>
            <Cpu size={24} className={isConnected ? 'animate-pulse' : ''} />
          </div>
          <div>
            <h1 className="font-black text-xl tracking-tighter uppercase italic text-white flex items-center gap-2">
              MicroNIR <span className="text-blue-500 px-2 py-0.5 bg-blue-500/10 rounded text-sm not-italic tracking-normal">QUANTUM</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Protocolo de Control OnSiteW</p>
          </div>
        </div>
        <div className="flex gap-4">
          {!isConnected ? (
            <button onClick={handleConnect} className="bg-blue-600 px-6 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20">
              <Usb size={18} /> VINCULAR SENSOR
            </button>
          ) : (
            <div className="flex items-center gap-2">
               {lampStatus === 'off' ? (
                 <button 
                  disabled={isMeasuring}
                  onClick={turnOnLamp} 
                  className={`px-6 py-2.5 rounded-full font-bold text-xs bg-orange-600 text-white hover:bg-orange-500 transition-all ${isMeasuring ? 'opacity-50 cursor-wait' : ''}`}
                 >
                   ENCENDER LÁMPARA
                 </button>
               ) : (
                 <button 
                  disabled={isMeasuring}
                  onClick={turnOffLamp} 
                  className={`px-6 py-2.5 rounded-full font-bold text-xs bg-slate-800 text-slate-400 border border-white/10 hover:text-white transition-all ${isMeasuring ? 'opacity-50 cursor-wait' : ''}`}
                 >
                   APAGAR LÁMPARA
                 </button>
               )}
              <button onClick={updateHardwareStatus} className="p-2.5 rounded-full bg-slate-800 text-slate-400 border border-white/5 hover:text-white transition-colors">
                <RefreshCw size={18} />
              </button>
            </div>
          )}
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <aside className="lg:col-span-4 space-y-6">
          <div className="glass-panel p-6 rounded-3xl border-white/5 shadow-lg">
            <h3 className="text-[10px] font-black text-slate-500 uppercase mb-5 flex items-center gap-2 tracking-widest">
              <ShieldCheck size={14} className="text-emerald-500" /> Diagnóstico
            </h3>
            {deviceInfo ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/5">
                  <span className="text-[9px] text-slate-500 block uppercase mb-1">Temperatura</span>
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <Thermometer size={14} /> {deviceInfo.temperature.toFixed(1)}°C
                  </div>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-2xl border border-white/5">
                  <span className="text-[9px] text-slate-500 block uppercase mb-1">Estado</span>
                  <div className="flex items-center gap-2 text-blue-400 font-bold">
                    <CheckCircle2 size={14} /> OK
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-xs text-slate-600 italic">Esperando conexión...</div>
            )}
          </div>

          <div className="glass-panel p-6 rounded-3xl border-white/5 shadow-lg">
            <h3 className="text-[10px] font-black text-slate-500 uppercase mb-6 flex items-center gap-2 tracking-widest">
              <FlaskConical size={14} /> Calibración
            </h3>
            <div className="space-y-3">
              <button disabled={!isConnected || isMeasuring} onClick={() => runCalibration('dark')} className={`w-full flex justify-between items-center p-4 rounded-2xl border transition-all ${calib.dark ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-white/5'}`}>
                <div className="flex items-center gap-3 font-bold uppercase text-[11px]"><Moon size={18} />Referencia Oscura</div>
                {calib.dark && <CheckCircle2 size={16} />}
              </button>
              <button disabled={!isConnected || isMeasuring} onClick={() => runCalibration('reference')} className={`w-full flex justify-between items-center p-4 rounded-2xl border transition-all ${calib.reference ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-white/5'}`}>
                <div className="flex items-center gap-3 font-bold uppercase text-[11px]"><Sun size={18} />Referencia Blanca</div>
                {calib.reference && <CheckCircle2 size={16} />}
              </button>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-3xl border-white/5 overflow-hidden">
            <h3 className="text-[10px] font-black text-slate-500 uppercase mb-4 flex items-center gap-2 tracking-widest">
              <Terminal size={14} /> Logs
            </h3>
            <div className="h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar font-mono text-[9px]">
              {logs.map((l, i) => (
                <div key={i} className={`p-2 rounded-lg border leading-tight ${l.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-slate-900/50 border-white/5 text-slate-400'}`}>
                  <span className="opacity-30 mr-2">{l.timestamp}</span>{l.message}
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="lg:col-span-8 space-y-6">
          <div className="glass-panel p-8 rounded-[2.5rem] border-white/5 relative shadow-2xl">
            <div className="flex justify-between items-start mb-10">
              <div>
                <h2 className="text-2xl font-black italic text-white flex items-center gap-3 mb-1">
                  <Activity className="text-blue-500" /> Espectro de Absorbancia
                </h2>
                <p className="text-xs text-slate-500 uppercase font-bold tracking-widest">Modelo: {CDM_MODEL.name}</p>
              </div>
              <div className="bg-slate-950 p-5 rounded-3xl border border-white/5 text-center min-w-[180px]">
                <span className="text-[10px] font-black text-blue-500 block mb-1 tracking-tighter uppercase">Proteína</span>
                <span className="text-5xl font-black text-white">{prediction || '--.--'}<small className="text-sm ml-1 opacity-40">%</small></span>
              </div>
            </div>

            <div className="h-[380px] w-full mb-10">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectralData}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.1} />
                  <XAxis dataKey="nm" stroke="#475569" fontSize={10} tickFormatter={v => `${v}nm`} />
                  <YAxis stroke="#475569" fontSize={10} />
                  <Tooltip 
                    contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '16px' }}
                  />
                  <Area type="monotone" dataKey="absorbance" stroke="#3b82f6" fillOpacity={1} fill="url(#colorAbs)" strokeWidth={4} animationDuration={1000} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {aiInsight && (
              <div className="mb-8 p-6 bg-blue-500/5 border border-blue-500/10 rounded-3xl flex gap-5 items-center">
                <div className="p-3 bg-blue-500/20 rounded-2xl text-blue-400 shrink-0">
                  <BrainCircuit size={24} />
                </div>
                <p className="text-xs text-slate-400 leading-relaxed italic font-medium">"{aiInsight}"</p>
              </div>
            )}

            <button 
              disabled={!isConnected || isMeasuring || calib.step !== 'ready'} 
              onClick={runScan}
              className={`w-full py-7 rounded-3xl font-black text-xl uppercase transition-all flex items-center justify-center gap-4 shadow-xl ${isConnected && calib.step === 'ready' ? 'bg-white text-black hover:bg-blue-500 hover:text-white' : 'bg-slate-900 text-slate-700 cursor-not-allowed'}`}
            >
              {isMeasuring ? <RefreshCw className="animate-spin" /> : <Play fill="currentColor" />}
              {isMeasuring ? 'Procesando...' : 'Escanear Muestra'}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
