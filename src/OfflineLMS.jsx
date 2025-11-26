import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import FormatMessage from './components/FormatMessage';
import { AuthProvider } from './auth/AuthProvider';
import AuthContext from './auth/AuthProvider';
import { apiFetch } from './api/server';
import { 
  Send, X, BookOpen, ChevronLeft, Bot, WifiOff, 
  CheckCircle, Moon, Sun, GripVertical, Menu, Server, Monitor
} from 'lucide-react';
import Login from './pages/Login';
import Register from './pages/Register';
import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import COURSES from './data/courses.json'; 

// --- 0. THEME CONTEXT ---
const ThemeContext = createContext();

const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
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

const useResizable = (initialWidth = 40) => {
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('chatWidth');
    return saved ? parseFloat(saved) : initialWidth;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizingRef = useRef(false);

  const startResizing = useCallback(() => {
    setIsResizing(true);
    resizingRef.current = true;
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    resizingRef.current = false;
    localStorage.setItem('chatWidth', width.toString());
  }, [width]);

  const resize = useCallback((e) => {
    if (resizingRef.current) {
      const newWidth = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
      if (newWidth >= 20 && newWidth <= 80) {
        setWidth(newWidth);
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  return { width, isResizing, startResizing };
};

// --- 2. MAIN APP LAYOUT ---
const MainApp = () => {
  const { isDark, toggleTheme } = useContext(ThemeContext);
  const auth = useContext(AuthContext);

  useEffect(() => { if (typeof window !== 'undefined') window.__auth_ctx__ = auth; }, [auth]);
  
  // State
  const [view, setView] = useState('home');
  const [activeCourse, setActiveCourse] = useState(null);
  const [activeLesson, setActiveLesson] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [inferenceMode, setInferenceMode] = useState('local'); 
  const [vllmStatus, setVllmStatus] = useState('idle');

  // Logic
  const { status, progress, initEngine, generateResponse } = useWebLLM();
  const { width: chatWidth, isResizing, startResizing } = useResizable(40);
  const chatBottomRef = useRef(null);
  const VLLM_PRESET = { url: 'https://vllm.pixelcipher.online/v1', model: 'openai/gpt-oss-20b' };

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const openLesson = async (course, lesson) => {
    setActiveCourse(course);
    setActiveLesson(lesson);
    setView('lesson');
    setIsMobileMenuOpen(false);
    setChatMessages([{ role: 'assistant', content: `Hi! I'm your AI tutor. Ask me anything about "${lesson.title}"!` }]);

    try {
      const token = auth?.token;
      if (token) {
        const courses = await apiFetch('/courses', { method: 'GET', token });
        const info = courses.find(c => c.id === course.id);
        if (info) setActiveCourse(prev => ({ ...prev, completed: info.completed ?? false, avg_rating: info.avg_rating, rating_count: info.rating_count }));
      }
    } catch (e) {}
  };

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;
    
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
    <div className="flex h-screen bg-gradient-to-br from-zinc-100 via-neutral-100 to-stone-100 dark:from-zinc-950 dark:via-neutral-950 dark:to-zinc-900 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-zinc-300/30 dark:bg-zinc-700/30 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-20 right-1/4 w-80 h-80 bg-zinc-400/20 dark:bg-zinc-600/20 rounded-full blur-3xl animate-pulse" style={{animationDelay: '1s'}}></div>
        <div className="absolute top-10 left-1/2 w-72 h-72 bg-zinc-300/25 dark:bg-zinc-700/25 rounded-full blur-3xl animate-pulse" style={{animationDelay: '2s'}}></div>
      </div>

      {/* FIXED NAVBAR */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-3xl bg-gradient-to-br from-white/60 via-white/30 to-zinc-100/50 dark:from-zinc-900/60 dark:via-zinc-950/30 dark:to-zinc-800/50 border-b border-zinc-200/20 dark:border-zinc-800/20 shadow-2xl shadow-black/5">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-4">
            {view === 'lesson' && (
              <button onClick={() => setView('home')} className="p-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-xl transition-all text-zinc-600 dark:text-zinc-400 backdrop-blur-sm">
                <ChevronLeft size={20} />
              </button>
            )}
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 md:hidden hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-xl transition-all text-zinc-600 dark:text-zinc-400">
              <Menu size={20} />
            </button>
            <h1 className="text-base md:text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <BookOpen size={20} className="md:w-6 md:h-6 text-zinc-700 dark:text-zinc-300" />
              <span className="hidden sm:inline">{view === 'home' ? 'Offline Academy' : view === 'login' ? 'Sign In' : view === 'register' ? 'Create Account' : activeLesson?.title}</span>
            </h1>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {/* Mode Switcher */}
            {view === 'lesson' && (
              <div className="flex items-center gap-1 md:gap-2 p-1 rounded-xl backdrop-blur-xl bg-zinc-100/60 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-800/50 shadow-lg">
                <button onClick={() => setInferenceMode('local')} className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-4 py-1.5 md:py-2 rounded-lg text-xs font-semibold transition-all ${inferenceMode === 'local' ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-lg' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'}`}>
                  <Monitor size={14} />
                  <span className="hidden sm:inline">Local</span>
                </button>
                <button onClick={() => setInferenceMode('vllm')} className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-4 py-1.5 md:py-2 rounded-lg text-xs font-semibold transition-all ${inferenceMode === 'vllm' ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-lg' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'}`}>
                  <Server size={14} />
                  <span className="hidden sm:inline">vLLM</span>
                </button>
              </div>
            )}
            
            {/* Auth */}
            <AuthContext.Consumer>
              {({ user, logout }) => (
                user ? (
                  <div className="flex items-center gap-2">
                    <div className="hidden sm:block text-xs md:text-sm text-zinc-600 dark:text-zinc-300">
                      {user.username} • <span className="font-semibold">{user.points} pts</span>
                    </div>
                    <button onClick={logout} className="px-2 md:px-3 py-1 rounded-md text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">Sign out</button>
                  </div>
                ) : (
                  view !== 'login' && view !== 'register' && (
                    <div className="hidden sm:flex gap-2">
                      <button onClick={() => setView('login')} className="px-3 py-1 rounded-md text-xs text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Sign in</button>
                      <button onClick={() => setView('register')} className="px-3 py-1 rounded-md text-xs bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors">Create account</button>
                    </div>
                  )
                )
              )}
            </AuthContext.Consumer>

            {/* Theme Toggle */}
            <button onClick={toggleTheme} className="p-2 md:p-2.5 rounded-xl backdrop-blur-xl bg-zinc-100/60 dark:bg-zinc-900/60 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 border border-zinc-200/50 dark:border-zinc-800/50 text-zinc-700 dark:text-zinc-300 transition-all shadow-lg">
              {isDark ? <Sun size={16} className="md:w-[18px] md:h-[18px]" /> : <Moon size={16} className="md:w-[18px] md:h-[18px]" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-zinc-200/20 dark:border-zinc-800/20 backdrop-blur-3xl bg-white/80 dark:bg-zinc-900/80 p-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {COURSES.map(course => (
              <div key={course.id} className="space-y-1">
                <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100 px-2 py-1">{course.title}</div>
                {course.lessons.map((lesson, idx) => (
                  <button key={idx} onClick={() => openLesson(course, lesson)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 text-sm text-zinc-700 dark:text-zinc-300 transition-all">
                    {lesson.title}
                  </button>
                ))}
              </div>
            ))}
            
            <AuthContext.Consumer>
              {({ user }) => !user && (
                <div className="pt-2 border-t border-zinc-200/50 dark:border-zinc-800/50 flex gap-2">
                  <button onClick={() => { setView('login'); setIsMobileMenuOpen(false); }} className="flex-1 px-3 py-2 rounded-lg text-sm text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800">Sign in</button>
                  <button onClick={() => { setView('register'); setIsMobileMenuOpen(false); }} className="flex-1 px-3 py-2 rounded-lg text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">Create account</button>
                </div>
              )}
            </AuthContext.Consumer>
          </div>
        )}
      </nav>

      {/* MAIN CONTENT AREA */}
      <div className="flex w-full h-full pt-16 md:pt-20">
        {/* LEFT COLUMN */}
        <div className={`transition-all duration-300 relative z-10 flex flex-col ${isChatOpen ? 'hidden md:flex' : 'flex'}`} style={{ width: isChatOpen ? `${100 - chatWidth}%` : '100%' }}>
          <div className="flex-1 overflow-y-auto">
            {view === 'home' && (
              <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8 md:space-y-12">
                <div className="text-center space-y-3 md:space-y-4 py-8 md:py-12">
                  <div className="w-16 md:w-20 h-16 md:h-20 backdrop-blur-xl bg-zinc-900/90 dark:bg-zinc-100/90 rounded-2xl md:rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-zinc-900/30 border border-zinc-800/50 dark:border-zinc-200/50">
                    <WifiOff size={24} className="md:w-8 md:h-8 text-white dark:text-zinc-900" />
                  </div>
                  <h2 className="text-2xl md:text-4xl font-bold text-zinc-900 dark:text-zinc-50">Ready for Offline Learning</h2>
                  <p className="text-sm md:text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto px-4">Your AI Tutor is ready. Switch to 'Local' mode to run a 1B parameter Llama model entirely within your browser.</p>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xl md:text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2 px-2 md:px-0">
                    <BookOpen size={20} className="md:w-6 md:h-6 text-zinc-700 dark:text-zinc-300" />
                    Library
                  </h3>
                  
                  {COURSES.map(course => (
                    <div key={course.id} className="backdrop-blur-2xl bg-white/60 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200/40 dark:border-zinc-800/40 overflow-hidden shadow-2xl shadow-zinc-900/10 hover:shadow-3xl hover:shadow-zinc-900/20 transition-all duration-300">
                      <div className="backdrop-blur-xl bg-zinc-100/50 dark:bg-zinc-800/50 px-4 md:px-6 py-3 md:py-4 border-b border-zinc-200/40 dark:border-zinc-800/40 flex justify-between items-center">
                        <h4 className="font-bold text-base md:text-lg text-zinc-900 dark:text-zinc-50">{course.title}</h4>
                        {course.completed && <CheckCircle size={18} className="text-emerald-500" />}
                      </div>
                      <div className="divide-y divide-zinc-200/30 dark:divide-zinc-800/30">
                        {course.lessons.map((lesson, idx) => (
                          <button key={idx} onClick={() => openLesson(course, lesson)} className="w-full p-3 md:p-5 text-left hover:bg-zinc-100/40 dark:hover:bg-zinc-800/40 flex items-center gap-3 md:gap-4 transition-all group backdrop-blur-sm">
                            <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg md:rounded-xl backdrop-blur-xl bg-zinc-900/90 dark:bg-zinc-100/90 border border-zinc-800/50 dark:border-zinc-200/50 flex items-center justify-center text-white dark:text-zinc-900 font-bold shadow-xl shadow-zinc-900/30 group-hover:shadow-2xl group-hover:shadow-zinc-900/40 group-hover:scale-110 transition-all text-sm md:text-base">
                              0{idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm md:text-base text-zinc-900 dark:text-zinc-50 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors truncate">{lesson.title}</div>
                            </div>
                            <ChevronLeft size={18} className="md:w-5 md:h-5 text-zinc-400 rotate-180 group-hover:translate-x-1 transition-transform flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {view === 'lesson' && activeLesson && (
              <div className="max-w-4xl mx-auto p-4 md:p-8 pb-32">
                <div className="backdrop-blur-2xl bg-white/60 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200/40 dark:border-zinc-800/40 p-4 md:p-8 shadow-2xl shadow-zinc-900/10">
                  <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-200/40 dark:border-zinc-800/40">
                    <div>
                      <h2 className="font-bold text-xl md:text-2xl text-zinc-900 dark:text-zinc-50">{activeLesson.title}</h2>
                      <div className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400 mt-1">Course: {activeCourse?.title}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <AuthContext.Consumer>
                        {({ token, fetchProfile }) => (
                          <>
                            <button
                              onClick={async () => {
                                if (!token) { setView('login'); return; }
                                try {
                                  const result = await apiFetch('/complete_course', { method: 'POST', body: JSON.stringify({ course_id: activeCourse.id }), token });
                                  await fetchProfile();
                                  setActiveCourse(prev => ({ ...prev, completed: true }));
                                  setChatMessages(prev => [...prev, { role: 'assistant', content: `Congrats — you completed ${activeCourse.title}! +${result.points_awarded} points.` }]);
                                } catch (err) {
                                  alert(err?.error || 'Failed to mark completed');
                                }
                              }}
                              className={`px-2 md:px-3 py-1 rounded-md text-xs md:text-sm transition-colors ${activeCourse?.completed ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300' : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200'}`}
                            >
                              {activeCourse?.completed ? 'Completed' : 'Mark complete'}
                            </button>

                            <select onChange={async (e) => {
                              const r = Number(e.target.value);
                              if (!token) { setView('login'); return; }
                              try {
                                await apiFetch('/rate_course', { method: 'POST', body: JSON.stringify({ course_id: activeCourse.id, rating: r }), token });
                                setChatMessages(prev => [...prev, { role: 'assistant', content: `Thanks — you rated ${activeCourse.title} ${r} stars.` }]);
                              } catch (err) { alert(err?.error || 'Failed to submit rating'); }
                            }} defaultValue="" className="px-2 py-1 rounded-md text-xs md:text-sm bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100">
                              <option value="" disabled>Rate</option>
                              <option value="5">★★★★★ (5)</option>
                              <option value="4">★★★★ (4)</option>
                              <option value="3">★★★ (3)</option>
                              <option value="2">★★ (2)</option>
                              <option value="1">★ (1)</option>
                            </select>
                          </>
                        )}
                      </AuthContext.Consumer>
                    </div>
                  </div>
                  
                  <article className="prose prose-slate dark:prose-invert prose-sm md:prose-base max-w-none">
                    <FormatMessage content={activeLesson.content} />
                  </article>
                </div>
              </div>
            )}

            {view === 'login' && (
              <div className="max-w-lg mx-auto p-4 md:p-8">
                <div className="backdrop-blur-2xl bg-white/60 dark:bg-zinc-900/60 p-6 md:p-8 rounded-2xl border border-zinc-200/40 dark:border-zinc-800/40 shadow-2xl">
                  <Login onDone={() => setView('home')} />
                </div>
              </div>
            )}

            {view === 'register' && (
              <div className="max-w-lg mx-auto p-4 md:p-8">
                <div className="backdrop-blur-2xl bg-white/60 dark:bg-zinc-900/60 p-6 md:p-8 rounded-2xl border border-zinc-200/40 dark:border-zinc-800/40 shadow-2xl">
                  <Register onDone={() => setView('home')} />
                </div>
              </div>
            )}
          </div>

          {view === 'lesson' && !isChatOpen && (
            <div className="fixed bottom-4 md:bottom-8 right-4 md:right-8 z-40">
              <button onClick={() => { setIsChatOpen(true); (inferenceMode === 'local' ? initEngine() : initVLLM()); }} className="backdrop-blur-xl bg-zinc-900/90 hover:bg-zinc-800/90 dark:bg-zinc-100/90 dark:hover:bg-zinc-200/90 border border-zinc-800/50 dark:border-zinc-200/50 text-white dark:text-zinc-900 pl-4 pr-5 md:pl-6 md:pr-8 py-3 md:py-4 rounded-full shadow-2xl shadow-zinc-900/40 flex items-center gap-2 md:gap-3 transition-all hover:scale-105 active:scale-95 group">
                <Bot size={20} className="md:w-6 md:h-6 group-hover:rotate-12 transition-transform" />
                <span className="font-semibold text-sm md:text-lg">Ask AI Tutor</span>
              </button>
            </div>
          )}
        </div>

        {/* RESIZE HANDLE */}
        {isChatOpen && (
          <div onMouseDown={startResizing} className={`hidden md:block w-1 hover:w-2 ${isResizing ? 'bg-zinc-400 dark:bg-zinc-600' : 'bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-700'} cursor-col-resize transition-all z-30 relative group`}>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVertical size={20} className="text-zinc-500 dark:text-zinc-400" />
            </div>
          </div>
        )}

        {/* RIGHT COLUMN (CHAT) */}
        {isChatOpen && (
          <div className={`transition-all duration-300 overflow-hidden backdrop-blur-2xl bg-white/50 dark:bg-zinc-950/50 border-l border-zinc-200/40 dark:border-zinc-800/40 flex flex-col relative z-10 fixed md:relative inset-0 md:inset-auto`} style={{ width: window.innerWidth < 768 ? '100%' : `${chatWidth}%` }}>
            <div className="backdrop-blur-2xl bg-white/70 dark:bg-zinc-950/70 px-4 md:px-6 py-4 flex items-center justify-between border-b border-zinc-200/40 dark:border-zinc-800/40 shadow-xl shadow-black/5">
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-zinc-50 text-base md:text-lg">AI Assistant</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                  {inferenceMode === 'local' ? 'WebGPU • Llama 3.2' : 'API • vLLM'}
                </p>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-xl text-zinc-500 transition-all backdrop-blur-sm">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
              {chatMessages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-3">
                    <div className="w-14 h-14 md:w-16 md:h-16 backdrop-blur-xl bg-zinc-900/90 dark:bg-zinc-100/90 border border-zinc-800/50 dark:border-zinc-200/50 rounded-2xl mx-auto flex items-center justify-center shadow-2xl shadow-zinc-900/30">
                      <Bot size={24} className="md:w-7 md:h-7 text-white dark:text-zinc-900" />
                    </div>
                    <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400 font-medium">Ready to help you learn.</p>
                  </div>
                </div>
              )}

            {chatMessages.map((msg, i) => (
            <div key={i} className={`flex gap-2 md:gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg md:rounded-xl backdrop-blur-xl bg-zinc-900/90 dark:bg-zinc-100/90 border border-zinc-800/50 dark:border-zinc-200/50 flex items-center justify-center flex-shrink-0 shadow-lg shadow-zinc-900/20">
                    <Bot size={14} className="md:w-4 md:h-4 text-white dark:text-zinc-900" />
                </div>
                )}
                <div className={`max-w-[85%] md:max-w-[80%] rounded-xl md:rounded-2xl px-3 py-2 md:px-4 md:py-3 shadow-xl backdrop-blur-xl text-sm md:text-base ${msg.role === 'user' ? 'bg-zinc-900/90 dark:bg-zinc-100/90 text-white dark:text-zinc-900 border border-zinc-800/50 dark:border-zinc-200/50' : 'bg-white/70 dark:bg-zinc-900/70 text-zinc-900 dark:text-zinc-50 border border-zinc-200/50 dark:border-zinc-800/50'}`}>
                {msg.role === 'user' ? (
                    <div className="markdown-content space-y-3 text-sm leading-relaxed">
                    {/* CHANGE THIS LINE */}
                    <p className="text-slate-50 dark:text-slate-900 leading-7">{msg.content}</p>
                    </div>
                ) : (
                    <FormatMessage content={msg.content} />
                )}
                </div>
            </div>
            ))}
              
              {status === 'loading' && (
                <div className="backdrop-blur-xl bg-zinc-100/70 dark:bg-zinc-900/70 border border-zinc-200/50 dark:border-zinc-800/50 rounded-xl md:rounded-2xl p-4 md:p-6 space-y-3 shadow-2xl">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin w-4 h-4 md:w-5 md:h-5 border-2 border-zinc-900 dark:border-zinc-100 border-t-transparent rounded-full"></div>
                    <span className="font-semibold text-sm md:text-base text-zinc-900 dark:text-zinc-50">Downloading Model</span>
                  </div>
                  <p className="text-xs md:text-sm text-zinc-600 dark:text-zinc-400">This happens once. The model is being cached to your browser.</p>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      <span className="truncate pr-2">{progress.text}</span>
                      <span className="flex-shrink-0">{progress.percent}%</span>
                    </div>
                    <div className="h-2 backdrop-blur-xl bg-zinc-200/60 dark:bg-zinc-800/60 rounded-full overflow-hidden border border-zinc-300/50 dark:border-zinc-700/50">
                      <div className="h-full bg-zinc-900 dark:bg-zinc-100 rounded-full transition-all duration-300 shadow-lg" style={{width: `${progress.percent}%`}}></div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={chatBottomRef} />
            </div>

            <div className="p-3 md:p-4 backdrop-blur-2xl bg-white/70 dark:bg-zinc-950/70 border-t border-zinc-200/40 dark:border-zinc-800/40 shadow-2xl shadow-black/10">
              <div className="flex gap-2 items-end backdrop-blur-xl bg-white/60 dark:bg-zinc-900/60 rounded-xl md:rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50 p-2 md:p-3 shadow-xl">
                <textarea value={userInput} onChange={(e) => { setUserInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'; }} onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Ask a question..." className="w-full bg-transparent border-none focus:ring-0 resize-none text-xs md:text-sm py-2 px-2 max-h-[100px] text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none" disabled={ status === 'loading' || vllmStatus === 'checking' } />
                <button onClick={handleSendMessage} disabled={!userInput.trim() || status === 'loading'} className="p-2 md:p-3 backdrop-blur-xl bg-zinc-900/90 dark:bg-zinc-100/90 border border-zinc-800/50 dark:border-zinc-200/50 text-white dark:text-zinc-900 rounded-lg md:rounded-xl hover:bg-zinc-800/90 dark:hover:bg-zinc-200/90 disabled:bg-zinc-300/60 dark:disabled:bg-zinc-700/60 disabled:cursor-not-allowed transition-all shadow-lg flex-shrink-0">
                  <Send size={16} className="md:w-[18px] md:h-[18px]" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default function OfflineLMS() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ThemeProvider>
  );
}