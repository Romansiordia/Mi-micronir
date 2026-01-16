
import { useState, useEffect, useRef } from 'react';
import { 
  Usb, Activity, RefreshCw, Zap, AlertCircle, CheckCircle2, 
  Terminal, Power, ShieldAlert, MousePointerClick, Search, Bug
} from 'lucide-react';
import { device as usbDevice } from './services/usbService';

export default function App() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'ready' | 'error'>('disconnected');
  const [statusMsg, setStatusMsg] = useState("Listo para diagnóstico");
  const [isBusy, setIsBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLogEntry = (msg: string) => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 499)]);
  };

  useEffect(() => {
    usbDevice.setLogger(addLogEntry);
  }, []);

  const connectDiagnostic = async () => {
    setIsBusy(true);
    setStatus('connecting');
    setLogs([]);
    addLogEntry("Iniciando sondeo de hardware...");
    
    try {
      const res = await usbDevice.connect();
      if (res === "OK") {
        setStatus('ready');
        setStatusMsg("EQUIPO IDENTIFICADO");
      } else {
        setStatus('error');
        setStatusMsg(res);
      }
    } catch (e: any) {
      setStatus('error');
      setStatusMsg("Fallo de conexión");
    }
    setIsBusy(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 font-sans flex flex-col">
      <header className="flex justify-between items-center mb-6 bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-3">
            <Bug className="text-amber-500" />
            MicroNIR <span className="text-amber-400">DIAGNOSTIC</span>
          </h1>
          <p className="text-[10px] text-slate-500 font-mono mt-1">BUSCANDO PROTOCOLO DE HARDWARE</p>
        </div>
        
        <div className="flex gap-4 items-center">
          {status !== 'ready' ? (
            <button onClick={connectDiagnostic} disabled={isBusy} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all">
                {isBusy ? <RefreshCw className="animate-spin" size={20}/> : <Search size={20} />} 
                SONDEAR EQUIPO
            </button>
          ) : (
            <button onClick={() => usbDevice.disconnect().then(() => setStatus('disconnected'))} className="bg-slate-800 text-red-400 px-6 py-3 rounded-xl font-bold border border-red-900/20">
                DESCONECTAR
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        <div className="lg:col-span-4 space-y-6">
            <div className={`p-8 rounded-3xl border text-center transition-all ${status === 'ready' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-800 bg-slate-900/50'}`}>
                <span className="text-xs text-slate-500 font-bold uppercase block mb-4">Estado del Enlace</span>
                <div className="text-3xl font-black mb-2 tracking-tighter">
                    {status === 'ready' ? 'ONLINE' : status === 'connecting' ? 'BUSCANDO...' : 'OFFLINE'}
                </div>
                <p className="text-xs font-mono text-slate-400">{statusMsg}</p>
            </div>

            <div className="bg-slate-900/80 p-6 rounded-3xl border border-slate-800">
                <h3 className="text-xs font-black text-slate-500 uppercase mb-4 tracking-widest">Instrucciones de Prueba</h3>
                <ul className="text-xs space-y-3 text-slate-400 list-disc pl-4">
                    <li>Conecta el MicroNIR al puerto USB.</li>
                    <li>Dale a <b>SONDEAR EQUIPO</b>.</li>
                    <li>Observa la terminal para ver si hay respuesta <b>RX</b>.</li>
                    <li>Si ves datos en RX, el equipo está vivo.</li>
                </ul>
            </div>
        </div>

        <div className="lg:col-span-8 bg-slate-900 p-2 rounded-3xl border border-slate-800 flex flex-col h-[600px]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Terminal size={12} /> MONITOR DE BUS USB (REAL-TIME)
                </span>
                <button onClick={() => setLogs([])} className="text-[10px] text-slate-500 hover:text-white uppercase font-bold">Limpiar</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1">
                {logs.length === 0 && <div className="text-slate-700 italic">Esperando tráfico...</div>}
                {logs.map((log, i) => (
                    <div key={i} className={`p-1 rounded ${
                        log.includes('RX') ? 'bg-emerald-500/5 text-emerald-400' : 
                        log.includes('TX') ? 'bg-blue-500/5 text-blue-300' : 
                        log.includes('!!!') ? 'bg-amber-500 text-slate-900 font-black' :
                        log.includes('ERR') ? 'text-red-400 font-bold' : 'text-slate-500'
                    }`}>
                        {log}
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
      </div>
    </div>
  );
}
