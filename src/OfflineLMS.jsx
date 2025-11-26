import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import FormatMessage from './components/FormatMessage';
import { 
  Send, X, BookOpen, ChevronLeft, Bot, WifiOff, 
  CheckCircle, Brain, Moon, Sun, Monitor, Server,
  Copy, Check
} from 'lucide-react';
import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import COURSES from './data/courses.json'; 

// --- 0. THEME CONTEXT ---
const ThemeContext = createContext();

const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      // If user has saved a preference, use it. Otherwise, follow system setting.
      if (saved) return saved === 'dark';
      try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      } catch {
        return false;
      }
    }
    return false;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme: () => setIsDark(!isDark) }}>
      {children}
    </ThemeContext.Provider>
  );
};

// --- 1. HOOKS ---
const useWebLLM = () => {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ text: '', percent: 0 });
  const engineRef = useRef(null);
  const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

  const initEngine = useCallback(async () => {
    if (status === 'ready' || status === 'loading') return;
    try {
      setStatus('loading');
      const appConfig = { ...prebuiltAppConfig, useIndexedDBCache: true };
      engineRef.current = await CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (report) => {
          setProgress({ text: report.text, percent: Math.round(report.progress * 100) });
        },
        appConfig,
      });
      setStatus('ready');
    } catch (err) {
      console.error(err);
      setStatus('error');
      setProgress(p => ({ ...p, text: err?.message || 'Failed to initialize' }));
    }
  }, [status]);

  const generateResponse = async (history, context, onUpdate) => {
    if (!engineRef.current) { onUpdate('Model not loaded.'); return; }
    const systemPrompt = `You are a helpful, encouraging AI Tutor. Answer based STRICTLY on the CONTEXT below. CONTEXT:\n${context}`;
    const messages = [{ role: 'system', content: systemPrompt }, ...history];

    try {
      setStatus('generating');
      const chunks = await engineRef.current.chat.completions.create({ messages, temperature: 0.3, stream: true });
      let fullResponse = '';
      for await (const chunk of chunks) {
        const content = chunk.choices?.[0]?.delta?.content || '';
        if (content) fullResponse += content;
        onUpdate(fullResponse);
      }
      setStatus('ready');
    } catch (err) {
      console.error(err);
      onUpdate('Error: ' + err?.message);
      setStatus('error');
    }
  };

  return { status, progress, initEngine, generateResponse };
};

// --- 2. COMPONENTS ---

// Using shared FormatMessage component from ./components/FormatMessage

// --- 3. MAIN APP LAYOUT ---
const MainApp = () => {
  const { isDark, toggleTheme } = useContext(ThemeContext);
  
  // State
  const [view, setView] = useState('home');
  const [activeCourse, setActiveCourse] = useState(null);
  const [activeLesson, setActiveLesson] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [inferenceMode, setInferenceMode] = useState('local'); 
  const [vllmStatus, setVllmStatus] = useState('idle');

  // Logic
  const { status, progress, initEngine, generateResponse } = useWebLLM();
  const chatBottomRef = useRef(null);
  const VLLM_PRESET = { url: 'https://vllm.pixelcipher.online/v1', model: 'openai/gpt-oss-20b' };

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const openLesson = (course, lesson) => {
    setActiveCourse(course);
    setActiveLesson(lesson);
    setView('lesson');
    setChatMessages([{ role: 'assistant', content: `Hi! I'm your AI tutor. Ask me anything about "${lesson.title}"!` }]);
  };

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;
    
    // Auto-init logic
    if (inferenceMode === 'local' && status === 'idle') { await initEngine(); return; }
    if (inferenceMode === 'vllm' && vllmStatus === 'idle') { await initVLLM(); return; }

    const newMsg = { role: 'user', content: userInput };
    const updatedHistory = [...chatMessages, newMsg];
    setChatMessages(updatedHistory);
    setUserInput('');
    setChatMessages(prev => [...prev, { role: 'assistant', content: 'Thinking...' }]);

    const updateLastMsg = (text) => {
      setChatMessages(prev => {
        const newH = [...prev];
        newH[newH.length - 1] = { role: 'assistant', content: text };
        return newH;
      });
    };

    if (inferenceMode === 'local') {
      await generateResponse(updatedHistory, activeLesson.content, updateLastMsg);
    } else {
      await generateVLLM(updatedHistory, activeLesson.content, updateLastMsg);
    }
  };

  const initVLLM = async () => {
    setVllmStatus('checking');
    try {
      await fetch(VLLM_PRESET.url.replace(/\/+$/, '') + '/models');
      setVllmStatus('ready');
    } catch {
      setVllmStatus('error');
      alert('vLLM server unreachable at ' + VLLM_PRESET.url);
    }
  };

  const generateVLLM = async (history, context, onUpdate) => {
    const systemPrompt = `You are a helpful AI Tutor. STRICTLY answer based on CONTEXT:\n${context}`;
    const messages = [{ role: 'system', content: systemPrompt }, ...history];
    setVllmStatus('generating');
    
    try {
      const res = await fetch(`${VLLM_PRESET.url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: VLLM_PRESET.model, messages, stream: true, temperature: 0.3 })
      });
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              full += JSON.parse(data).choices[0].delta.content || '';
              onUpdate(full);
            } catch (e) {}
          }
        }
      }
      setVllmStatus('ready');
    } catch (err) {
      setVllmStatus('error');
      onUpdate("Error: " + err.message);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden transition-colors duration-300">
      
      {/* LEFT COLUMN */}
      <div className={`flex-1 flex flex-col h-full transition-all duration-500 ease-in-out ${isChatOpen ? 'mr-0 md:mr-[400px]' : ''}`}>
        
        {/* HEADER */}
        <header className="flex-none bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 z-10 flex justify-between items-center shadow-sm">
          <div className="flex items-center gap-4">
            {view === 'lesson' && (
              <button onClick={() => setView('home')} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-600 dark:text-slate-400">
                <ChevronLeft size={20} />
              </button>
            )}
            <div>
               <h1 className="font-bold text-xl tracking-tight bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
                {view === 'home' ? 'Offline Academy' : activeLesson?.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mode Switcher */}
            <div className="hidden sm:flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
               <button onClick={() => setInferenceMode('local')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${inferenceMode === 'local' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500'}`}><Monitor size={14} /> Local</button>
               <button onClick={() => setInferenceMode('vllm')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${inferenceMode === 'vllm' ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 shadow-sm' : 'text-slate-500'}`}><Server size={14} /> vLLM</button>
            </div>
            
            {/* Theme Toggle */}
            <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors">
              {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>

        {/* CONTENT */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
          <div className="max-w-4xl mx-auto w-full p-4 sm:p-8">
            {view === 'home' && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-8 text-white shadow-lg relative overflow-hidden">
                   <div className="absolute top-0 right-0 p-8 opacity-10"><WifiOff size={120} /></div>
                   <div className="relative z-10">
                    <h2 className="text-2xl font-bold mb-2">Ready for Offline Learning</h2>
                    <p className="text-indigo-100 max-w-md">Your AI Tutor is ready. Switch to 'Local' mode to run a 1B parameter Llama model entirely within your browser.</p>
                   </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-1">Library</h3>
                  <div className="grid gap-4">
                    {COURSES.map(course => (
                      <div key={course.id} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden hover:border-indigo-300 dark:hover:border-indigo-700 transition-all group">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                          <div className="flex items-center gap-3">
                             <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg"><BookOpen size={20} /></div>
                             <h3 className="font-bold text-lg text-slate-900 dark:text-white">{course.title}</h3>
                          </div>
                          <CheckCircle size={18} className="text-emerald-500" />
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          {course.lessons.map((lesson, idx) => (
                            <button key={lesson.id} onClick={() => openLesson(course, lesson)} className="w-full p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center gap-4 transition-colors group-hover:pl-5">
                              <span className="font-mono text-sm text-slate-400">0{idx + 1}</span>
                              <div className="flex-1"><div className="font-medium text-slate-700 dark:text-slate-200">{lesson.title}</div></div>
                              <ChevronLeft size={16} className="rotate-180 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {view === 'lesson' && activeLesson && (
              <div className="animate-in slide-in-from-right-4 duration-300 pb-32">
                <article className="prose prose-slate dark:prose-invert prose-lg max-w-none bg-white dark:bg-slate-900 p-8 sm:p-12 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
                  <FormatMessage content={activeLesson.content} />
                </article>
              </div>
            )}
          </div>
        </main>

        {view === 'lesson' && !isChatOpen && (
          <div className="absolute bottom-8 right-8 z-20">
            <button onClick={() => { setIsChatOpen(true); (inferenceMode === 'local' ? initEngine() : initVLLM()); }} className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-lg shadow-indigo-600/30 flex items-center gap-3 transition-transform hover:scale-105 active:scale-95 animate-bounce-subtle">
              <Bot size={24} /><span className="font-bold pr-1">Ask AI Tutor</span>
            </button>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN (CHAT) */}
      <div className={`fixed inset-y-0 right-0 w-full md:w-[400px] bg-white dark:bg-slate-900 shadow-2xl z-30 transform transition-transform duration-300 flex flex-col border-l border-slate-200 dark:border-slate-800 ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex-none p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full shadow-glow ${(inferenceMode === 'local' ? status : vllmStatus) === 'ready' ? 'bg-emerald-500 shadow-emerald-500/50 animate-pulse' : (status === 'generating' || vllmStatus === 'generating') ? 'bg-blue-500 animate-ping' : 'bg-amber-500'}`} />
            <div className="flex flex-col">
              <span className="font-bold text-sm text-slate-800 dark:text-white">AI Assistant</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{inferenceMode === 'local' ? 'WebGPU • Llama 3.2' : 'API • vLLM'}</span>
            </div>
          </div>
          <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50/50 dark:bg-slate-950 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
          {chatMessages.length === 0 && (
             <div className="text-center mt-10 opacity-50">
                <Bot size={48} className="mx-auto mb-2 text-slate-400"/>
                <p className="text-sm text-slate-500">Ready to help you learn.</p>
             </div>
          )}
          {chatMessages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 fade-in duration-300`}>
              <div className={`max-w-[90%] p-4 rounded-2xl text-sm shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-bl-sm'}`}>
                <FormatMessage content={msg.content} />
              </div>
            </div>
          ))}
          <div ref={chatBottomRef} />
        </div>

        {status === 'loading' && (
          <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 z-40 flex flex-col items-center justify-center p-8 text-center backdrop-blur-sm">
            <Brain size={64} className="text-indigo-500 animate-pulse mb-6" />
            <h3 className="font-bold text-lg mb-2 text-slate-900 dark:text-white">Downloading Model</h3>
            <p className="text-sm text-slate-500 mb-6 max-w-xs">This happens once. The model is being cached to your browser.</p>
            <div className="w-full max-w-[200px] h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${progress.percent}%` }} /></div>
            <p className="text-xs font-mono text-slate-400 mt-3">{progress.text}</p>
          </div>
        )}

        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div className="relative flex items-end gap-2 bg-slate-100 dark:bg-slate-800 rounded-xl p-2 border border-transparent focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500/30 transition-all">
            <textarea rows={1} value={userInput} onChange={(e) => { setUserInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'; }} onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Ask a question..." className="w-full bg-transparent border-none focus:ring-0 resize-none text-sm py-2 px-2 max-h-[100px] text-slate-900 dark:text-white placeholder-slate-400" disabled={ status === 'loading' || vllmStatus === 'checking' } />
            <button onClick={handleSendMessage} disabled={!userInput.trim() || status === 'loading'} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors shadow-sm mb-0.5"><Send size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function OfflineLMS() {
  return (
    <ThemeProvider>
      <MainApp />
    </ThemeProvider>
  );
}