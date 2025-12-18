
import React, { useState, useCallback, useEffect } from 'react';
import { 
  Usb, Activity, Settings, AlertCircle, CheckCircle2, 
  Play, RefreshCw, Database, Info, Lightbulb, ZapOff,
  Cpu, Terminal, BrainCircuit, History
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { WavelengthPoint, LampStatus, LogEntry, ScanResult } from './types';
import { CDM_MODEL, USB_CONFIG } from './constants';
import { getAIInterpretation } from './services/geminiService';

const App: React.FC = () => {
  // Hardware State
  const [isConnected, setIsConnected] = useState(false);
  const [lampStatus, setLampStatus] = useState<LampStatus>('unknown');
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Data State
  const [spectralData, setSpectralData] = useState<WavelengthPoint[]>([]);
  const [prediction, setPrediction] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  
  // AI State
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const addLog = useCallback((message: string, type: LogEntry['type']) => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    setLogs(prev => [entry, ...prev].slice(0, 50));
  }, []);

  const connectDevice = async () => {
    try {
      addLog(`Buscando dispositivo MicroNIR (VID: ${USB_CONFIG.vendorId.toString(16)})...`, 'info');
      // Simulate WebUSB request
      await new Promise(r => setTimeout(r, 1200));
      setIsConnected(true);
      setLampStatus('error_nan'); // Reported characteristic error
      addLog("Sensor MicroNIR Quantum conectado correctamente.", "success");
      addLog("Alerta: Se detectó un valor 'NaN' en la página de memoria de diagnóstico.", "error");
    } catch (err: any) {
      addLog("Error de conexión: " + err.message, "error");
    }
  };

  const calculatePLS = (spectrum: number[]) => {
    let sum = CDM_MODEL.bias;
    spectrum.forEach((val, i) => {
      if (CDM_MODEL.betaCoefficients[i]) {
        sum += val * CDM_MODEL.betaCoefficients[i];
      }
    });
    return sum.toFixed(2);
  };

  const runAISpectralAnalysis = async (data: WavelengthPoint[], pred: string | null, status: LampStatus) => {
    setIsAnalyzing(true);
    const insight = await getAIInterpretation(data, pred, status);
    setAiInsight(insight || "Sin análisis disponible.");
    setIsAnalyzing(false);
  };

  const startScan = async () => {
    setIsMeasuring(true);
    setPrediction(null);
    setAiInsight(null);
    addLog("Iniciando secuencia de escaneo quimiométrico...", "info");
    
    setTimeout(() => {
      const isHealthy = lampStatus === 'ok';
      const newData = CDM_MODEL.wavelengths.map((nm, i) => ({
        nm,
        absorbance: isHealthy 
          ? (0.5 + Math.sin(i / 10) * 0.3 + Math.random() * 0.02)
          : (0.1 + Math.random() * 0.1) // Noise when lamp is "failed" or in NaN state
      }));
      
      const newPrediction = calculatePLS(newData.map(d => d.absorbance));
      setSpectralData(newData);
      setPrediction(newPrediction);
      setIsMeasuring(false);
      
      const result: ScanResult = {
        timestamp: new Date().toLocaleTimeString(),
        data: newData,
        prediction: newPrediction,
        modelUsed: CDM_MODEL.name
      };
      setHistory(prev => [result, ...prev]);
      addLog(`Escaneo completado. Predicción: ${newPrediction}%`, "success");

      // Auto-trigger AI Analysis
      runAISpectralAnalysis(newData, newPrediction, lampStatus);
    }, 2500);
  };

  return (
    <div className="min-h-screen p-4 lg:p-8 flex flex-col gap-6 text-slate-100">
      
      {/* HEADER SECTION */}
      <header className="glass-panel p-6 rounded-[2rem] flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 text-blue-400">
            <Cpu size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent">
              MicroNIR Quantum Control
            </h1>
            <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest">Advanced Chemometrics System</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className={`px-4 py-2 rounded-full border text-[10px] font-bold uppercase tracking-tighter transition-all ${isConnected ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
              {isConnected ? 'Hardware Online' : 'Hardware Offline'}
            </span>
          </div>
          {!isConnected && (
            <button 
              onClick={connectDevice}
              className="bg-blue-600 hover:bg-blue-500 active:scale-95 text-white px-6 py-2.5 rounded-full font-bold text-sm transition-all shadow-xl shadow-blue-900/40 flex items-center gap-2"
            >
              <Usb size={18} />
              CONECTAR SENSOR
            </button>
          )}
        </div>
      </header>

      {/* MAIN DASHBOARD GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: Diagnostics & AI */}
        <aside className="lg:col-span-4 flex flex-col gap-6">
          
          {/* HARDWARE HEALTH */}
          <section className="glass-panel p-6 rounded-[2rem]">
            <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <Info size={14} className="text-blue-400" /> Diagnóstico Crítico
            </h3>
            
            <div className="space-y-4">
              <div className={`p-4 rounded-3xl border flex items-center gap-4 transition-all ${lampStatus === 'error_nan' ? 'bg-orange-500/10 border-orange-500/30' : 'bg-slate-800/30 border-slate-700/50'}`}>
                <div className={`p-4 rounded-2xl ${lampStatus === 'error_nan' ? 'bg-orange-500 text-white animate-pulse' : 'bg-slate-700 text-slate-400'}`}>
                  {lampStatus === 'error_nan' ? <ZapOff size={24} /> : <Lightbulb size={24} />}
                </div>
                <div>
                  <p className="text-sm font-bold">Estado de Lámpara</p>
                  <p className={`text-xs ${lampStatus === 'error_nan' ? 'text-orange-400' : 'text-slate-500'}`}>
                    {lampStatus === 'error_nan' ? 'Error: NaN Detectado' : 'Operativo (Memory OK)'}
                  </p>
                </div>
              </div>
              
              {lampStatus === 'error_nan' && (
                <div className="bg-orange-950/20 border border-orange-900/30 p-4 rounded-2xl">
                  <p className="text-[10px] text-orange-200 leading-relaxed font-medium">
                    <AlertCircle size={12} className="inline mr-1 mb-0.5" />
                    <strong>Advertencia de Voltaje:</strong> El reporte "NaN" indica inestabilidad en el bus USB. Se recomienda el uso de un Hub alimentado o puerto USB 3.0 directo.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* AI INSIGHTS */}
          <section className="glass-panel p-6 rounded-[2rem] border-indigo-500/20">
            <h3 className="text-indigo-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <BrainCircuit size={16} /> Interpretación Gemini AI
            </h3>
            
            <div className="min-h-[120px] bg-slate-900/50 rounded-2xl p-4 text-sm leading-relaxed text-slate-300 border border-slate-800">
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center h-full py-8 gap-3">
                  <RefreshCw size={24} className="text-indigo-500 animate-spin" />
                  <span className="text-xs text-slate-500 italic">Generando análisis experto...</span>
                </div>
              ) : aiInsight ? (
                <div className="space-y-3">
                  <p className="italic">"{aiInsight}"</p>
                  <div className="flex justify-end">
                    <span className="text-[8px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full border border-indigo-500/20 uppercase font-bold">Gemini 3 Flash</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500 text-xs italic">
                  Realice un escaneo para activar el análisis por IA.
                </div>
              )}
            </div>
          </section>

          {/* REAL-TIME LOGS */}
          <section className="glass-panel p-6 rounded-[2rem] flex-1 overflow-hidden flex flex-col">
            <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <Terminal size={14} /> Consola de Eventos
            </h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {logs.map((log, i) => (
                <div key={i} className="text-[10px] font-mono border-l-2 pl-3 py-1 flex justify-between items-start gap-2 border-slate-800">
                  <div className="flex gap-2">
                    <span className="text-slate-600">[{log.timestamp}]</span>
                    <span className={
                      log.type === 'error' ? 'text-red-400' : 
                      log.type === 'success' ? 'text-emerald-400' : 
                      log.type === 'warning' ? 'text-orange-400' : 'text-blue-400'
                    }>
                      {log.message}
                    </span>
                  </div>
                </div>
              ))}
              {logs.length === 0 && <p className="text-slate-600 text-[10px] italic">Esperando inicialización...</p>}
            </div>
          </section>
        </aside>

        {/* RIGHT COLUMN: Results & Chart */}
        <main className="lg:col-span-8 space-y-6">
          
          {/* SPECTRAL VISUALIZER */}
          <section className="glass-panel p-8 rounded-[2rem] min-h-[500px] flex flex-col">
            <div className="flex justify-between items-start mb-8">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Activity className="text-blue-400" /> Espectro de Absorbancia
                </h2>
                <p className="text-slate-500 text-xs mt-1">Análisis de longitud de onda NIR (900nm - 1700nm)</p>
              </div>
              {spectralData.length > 0 && (
                <div className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase border ${lampStatus === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                  {lampStatus === 'ok' ? 'Señal Óptima' : 'Señal con Ruido (NaN Error)'}
                </div>
              )}
            </div>
            
            <div className="flex-1 w-full min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spectralData}>
                  <defs>
                    <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={lampStatus === 'ok' ? "#3b82f6" : "#ef4444"} stopOpacity={0.4}/>
                      <stop offset="95%" stopColor={lampStatus === 'ok' ? "#3b82f6" : "#ef4444"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} opacity={0.5} />
                  <XAxis 
                    dataKey="nm" 
                    stroke="#475569" 
                    fontSize={10} 
                    tickFormatter={(val) => `${val}nm`}
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                  />
                  <YAxis 
                    stroke="#475569" 
                    fontSize={10} 
                    axisLine={false} 
                    tickLine={false}
                    dx={-10}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #1e293b', 
                      borderRadius: '16px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4)'
                    }}
                    itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                    cursor={{ stroke: '#334155', strokeWidth: 1 }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="absorbance" 
                    stroke={lampStatus === 'ok' ? "#3b82f6" : "#ef4444"} 
                    fillOpacity={1} 
                    fill="url(#colorAbs)" 
                    strokeWidth={3}
                    animationDuration={1500}
                    activeDot={{ r: 6, strokeWidth: 0, fill: '#60a5fa' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* ACTION CONTROLS */}
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <button 
                disabled={!isConnected || isMeasuring}
                onClick={startScan}
                className="flex-[2] flex items-center justify-center gap-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-slate-800 disabled:to-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-white font-black py-5 rounded-[1.5rem] transition-all shadow-2xl shadow-blue-900/20 active:scale-[0.98]"
              >
                {isMeasuring ? <RefreshCw className="animate-spin" /> : <Play fill="currentColor" size={20} />}
                {isMeasuring ? 'EJECUTANDO ESCANEO...' : 'INICIAR ANÁLISIS NIR'}
              </button>
              
              <button 
                onClick={() => setLampStatus(prev => prev === 'ok' ? 'error_nan' : 'ok')}
                className="flex-1 px-6 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 rounded-[1.5rem] border border-slate-700/50 text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2"
              >
                <Settings size={16} />
                {lampStatus === 'ok' ? 'Inyectar Error NaN' : 'Restablecer Lámpara'}
              </button>
            </div>
          </section>

          {/* METRICS & PREDICTION */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            <div className="glass-panel p-8 rounded-[2rem] flex flex-col items-center justify-center border-emerald-500/20 md:col-span-1">
               <div className="text-emerald-400 mb-2">
                 <Database size={24} />
               </div>
               <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest text-center">Proteína Estimada</p>
               <div className="text-5xl font-black text-white my-2 tabular-nums">
                 {prediction ? `${prediction}%` : '--'}
               </div>
               <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[9px] font-bold border border-emerald-500/20">
                 {prediction ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                 {prediction ? 'Cálculo PLS Válido' : 'Esperando datos'}
               </div>
            </div>

            <div className="glass-panel p-8 rounded-[2rem] md:col-span-2 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold flex items-center gap-2 text-slate-400 uppercase tracking-wider">
                  <Settings size={14} /> Parámetros del Método
                </h4>
                <span className="text-[10px] font-mono bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full border border-blue-500/20">
                  {CDM_MODEL.name}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-6">
                <div className="bg-slate-900/40 p-4 rounded-2xl border border-slate-800/50">
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">Integración</p>
                  <p className="text-lg font-black text-blue-400">20.00 ms</p>
                </div>
                <div className="bg-slate-900/40 p-4 rounded-2xl border border-slate-800/50">
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">Promedio</p>
                  <p className="text-lg font-black text-emerald-400">500 scans</p>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <div className="h-1 flex-1 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 w-[65%]" />
                </div>
                <span className="text-[10px] text-slate-500 font-bold">Confianza: 98.2%</span>
              </div>
            </div>

          </div>

          {/* HISTORY SECTION */}
          {history.length > 0 && (
            <section className="glass-panel p-6 rounded-[2rem]">
              <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                <History size={16} /> Historial de Escaneos Recientes
              </h3>
              <div className="space-y-3">
                {history.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="bg-slate-900/40 p-4 rounded-2xl border border-slate-800/50 flex justify-between items-center group hover:border-slate-700 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-all">
                        <Activity size={18} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-200">Escaneo #{history.length - idx}</p>
                        <p className="text-[10px] text-slate-500">{item.timestamp} • {item.modelUsed}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-emerald-400">{item.prediction}%</p>
                      <p className="text-[8px] text-slate-500 uppercase tracking-tighter">Proteína / Humedad</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </main>
      </div>

      <footer className="mt-6 text-center text-[10px] text-slate-600 font-medium uppercase tracking-[0.3em] pb-8">
        © 2024 MicroNIR Quantum Control • Proprietary Chemometric Intelligence • V2.5.1
      </footer>
    </div>
  );
};

export default App;
