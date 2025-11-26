import React, { useState, useEffect, useRef, useCallback } from 'react';
// import Dexie from 'dexie'; <-- Removed to fix build error
// import { v4 as uuidv4 } from 'uuid'; <-- Removed to fix build error
import { 
  Send, 
  Menu, 
  Settings, 
  Brain, 
  X, 
  Download, 
  RotateCcw,
  Bot,
  User,
  Cpu,
  Zap,
  Activity,
  Trash2,
  Database,
  MessageSquare,
  Plus,
  History,
  ChevronRight,
  MoreHorizontal,
  Cloud,
  Globe,
  Server,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';

// --- DATABASE SETUP (Native LocalStorage Wrapper) ---
// Replaces Dexie to ensure code runs without 'npm install' errors
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const db = {
  chats: {
    list: () => {
      try {
        return JSON.parse(localStorage.getItem('webllm_chats') || '[]');
      } catch { return []; }
    },
    add: (chat) => {
      const chats = db.chats.list();
      const updated = [chat, ...chats]; // Add to top
      localStorage.setItem('webllm_chats', JSON.stringify(updated));
    },
    update: (id, updates) => {
      const chats = db.chats.list();
      const updated = chats.map(c => c.id === id ? { ...c, ...updates } : c);
      localStorage.setItem('webllm_chats', JSON.stringify(updated));
    },
    delete: (id) => {
      const chats = db.chats.list();
      const updated = chats.filter(c => c.id !== id);
      localStorage.setItem('webllm_chats', JSON.stringify(updated));
    }
  },
  messages: {
    getByChatId: (chatId) => {
      try {
        return JSON.parse(localStorage.getItem(`webllm_msgs_${chatId}`) || '[]');
      } catch { return []; }
    },
    add: (msg) => {
      const msgs = db.messages.getByChatId(msg.chatId);
      const updated = [...msgs, msg];
      localStorage.setItem(`webllm_msgs_${msg.chatId}`, JSON.stringify(updated));
    },
    deleteByChatId: (chatId) => {
      localStorage.removeItem(`webllm_msgs_${chatId}`);
    }
  }
};

import FormatMessage from './components/FormatMessage';

// --- HOOK: WebLLM Engine ---
const useWebLLM = () => {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ text: '', percent: 0 });
  const [error, setError] = useState(null);
  const [activeModel, setActiveModel] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [cachedModels, setCachedModels] = useState([]);
  const [config, setConfig] = useState({ temperature: 0.7, top_p: 0.9 });
  const [currentTps, setCurrentTps] = useState(0);
  
  const engineRef = useRef(null);
  const webLLMRef = useRef(null);

  const refreshCacheStatus = useCallback(async (models = availableModels) => {
    if (!webLLMRef.current || models.length === 0) return;
    try {
      const { hasModelInCache, prebuiltAppConfig } = webLLMRef.current;
      const appConfig = { ...prebuiltAppConfig, useIndexedDBCache: true };
      const cachedIds = [];
      for (const model of models) {
        const isCached = await hasModelInCache(model.model_id, appConfig);
        if (isCached) cachedIds.push(model.model_id);
      }
      setCachedModels(cachedIds);
    } catch (err) {
      console.error("Error checking cache:", err);
    }
  }, [availableModels]);

  useEffect(() => {
    const initLib = async () => {
      try {
        const module = await import('@mlc-ai/web-llm');
        webLLMRef.current = module;
        const allModels = module.prebuiltAppConfig.model_list;
        const curatedModels = allModels.filter(m => 
          m.model_id.includes('Llama-3') || m.model_id.includes('Gemma') || m.model_id.includes('Phi')
        );
        setAvailableModels(curatedModels.length > 0 ? curatedModels : allModels);
        
        // Initial cache check
        const { hasModelInCache, prebuiltAppConfig } = module;
        const appConfig = { ...prebuiltAppConfig, useIndexedDBCache: true };
        const cachedIds = [];
        for (const model of (curatedModels.length > 0 ? curatedModels : allModels)) {
          const isCached = await hasModelInCache(model.model_id, appConfig);
          if (isCached) cachedIds.push(model.model_id);
        }
        setCachedModels(cachedIds);
      } catch (err) {
        console.error(err);
        setError("Failed to load WebLLM library.");
        setStatus('error');
      }
    };
    initLib();
  }, []);

  const loadModel = useCallback(async (modelId) => {
    if (!webLLMRef.current) return;
    if (activeModel === modelId && status === 'ready') return;
    try {
      setStatus('loading');
      setError(null);
      setProgress({ text: 'Initializing engine...', percent: 0 });
      const { CreateMLCEngine } = webLLMRef.current;
      if (engineRef.current) await engineRef.current.unload();
      
      const appConfig = { ...webLLMRef.current.prebuiltAppConfig, useIndexedDBCache: true };
      engineRef.current = await CreateMLCEngine(modelId, {
        initProgressCallback: (report) => {
          setProgress({ text: report.text, percent: Math.round(report.progress * 100) });
        },
        appConfig 
      });
      setActiveModel(modelId);
      setStatus('ready');
      refreshCacheStatus();
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load model.");
      setStatus('error');
    }
  }, [activeModel, status, refreshCacheStatus]);

  const deleteModel = useCallback(async (modelId, e) => {
    e.stopPropagation();
    if (!webLLMRef.current) return;
    if (!window.confirm(`Delete ${modelId} from cache?`)) return;
    try {
      const { deleteModelAllInfo, prebuiltAppConfig } = webLLMRef.current;
      const appConfig = { ...prebuiltAppConfig, useIndexedDBCache: true };
      await deleteModelAllInfo(modelId, appConfig);
      setCachedModels(prev => prev.filter(id => id !== modelId));
      if (activeModel === modelId) {
        setActiveModel(null);
        setStatus('idle');
        if (engineRef.current) await engineRef.current.unload();
      }
    } catch (err) {
      alert("Error deleting model: " + err.message);
    }
  }, [activeModel]);

  const generate = useCallback(async (messages, onUpdate) => {
    if (!engineRef.current || status !== 'ready') return;
    setCurrentTps(0);
    try {
      const chunks = await engineRef.current.chat.completions.create({
        messages,
        temperature: config.temperature,
        top_p: config.top_p,
        stream: true,
      });
      let fullResponse = "";
      let tokenCount = 0;
      const startTime = performance.now();
      for await (const chunk of chunks) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          tokenCount++;
          const elapsed = (performance.now() - startTime) / 1000;
          if (elapsed > 0) setCurrentTps(Math.round((tokenCount / elapsed) * 10) / 10);
          onUpdate(fullResponse);
        }
      }
    } catch (err) {
      onUpdate("\n\n*Error: " + err.message + "*");
    }
  }, [status, config]);

  const updateConfig = (key, value) => setConfig(prev => ({ ...prev, [key]: value }));

  return { status, progress, error, activeModel, availableModels, cachedModels, loadModel, deleteModel, generate, config, updateConfig, currentTps };
};

// --- COMPONENT: Settings Modal ---
const SettingsModal = ({ isOpen, onClose, config, updateConfig, systemPrompt, setSystemPrompt }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/50 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-5 border-b border-slate-800">
          <h2 className="font-bold text-lg flex items-center gap-2 text-white"><Settings className="text-indigo-400" size={20} /> System Config</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-lg text-slate-400"><X size={20}/></button>
        </div>
        <div className="p-6 space-y-6 overflow-y-auto">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">System Prompt</label>
            <textarea 
              className="w-full bg-slate-950/50 border border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none h-32 resize-none text-slate-200 transition-all"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful AI assistant..."
            />
          </div>
          <div>
            <div className="flex justify-between mb-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Temperature</label>
              <span className="text-xs font-mono bg-indigo-900/30 text-indigo-300 px-2 py-0.5 rounded">{config.temperature}</span>
            </div>
            <input 
              type="range" min="0" max="2" step="0.1"
              value={config.temperature}
              onChange={(e) => updateConfig('temperature', parseFloat(e.target.value))}
              className="w-full accent-indigo-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
        <div className="p-5 border-t border-slate-800">
          <button onClick={onClose} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-indigo-500/20">Save Configuration</button>
        </div>
      </div>
    </div>
  );
};

// --- MAIN PAGE COMPONENT ---
export default function App() {
  // Chat State
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [messages, setMessages] = useState([]);
  
  // UI State
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // New States for API Support
  const [inferenceMode, setInferenceMode] = useState('local'); // 'local' | 'cloud' | 'vllm'
  const [activeTab, setActiveTab] = useState('models'); // 'chats' | 'models' (reused for both modes)
  const [cloudConfig, setCloudConfig] = useState({
    url: 'http://localhost:11434/v1',
    key: '',
    model: 'llama3'
  });
  const [cloudModels, setCloudModels] = useState([]);
  const [isFetchingCloudModels, setIsFetchingCloudModels] = useState(false);
  
  // LLM State
  const [isGenerating, setIsGenerating] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful, respectful, and honest assistant.");
  
  const chatContainerRef = useRef(null);
  const inputRef = useRef(null);
  // We don't currently display the engine-level error in the UI, keep it available in the hook
  const { status, progress, activeModel, availableModels, cachedModels, loadModel, deleteModel, generate, config, updateConfig, currentTps } = useWebLLM();

  // --- DB Operations ---
  
  // Load Chats on Mount
  useEffect(() => {
    const chats = db.chats.list();
    setChatHistory(chats);
    
    // Auto-create new chat if none exists
    if (chats.length === 0) {
      createNewChat();
    } else {
      // Load most recent chat
      selectChat(chats[0].id);
    }
  }, []);

  // Create New Chat
  const createNewChat = async () => {
    const newId = generateId();
    const newChat = {
      id: newId,
      title: 'New Conversation',
      timestamp: Date.now(),
      modelId: inferenceMode === 'local' ? (activeModel || 'unknown') : cloudConfig.model
    };
    
    db.chats.add(newChat);
    setChatHistory(prev => [newChat, ...prev]);
    setActiveChatId(newId);
    setMessages([]);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  // Delete Chat
  const deleteChat = async (e, chatId) => {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation?")) return;
    
    db.chats.delete(chatId);
    db.messages.deleteByChatId(chatId);
    
    const updatedHistory = chatHistory.filter(c => c.id !== chatId);
    setChatHistory(updatedHistory);
    
    if (activeChatId === chatId) {
      if (updatedHistory.length > 0) {
        selectChat(updatedHistory[0].id);
      } else {
        createNewChat();
      }
    }
  };

  // Select Chat & Load Messages
  const selectChat = async (chatId) => {
    setActiveChatId(chatId);
    const msgs = db.messages.getByChatId(chatId);
    setMessages(msgs);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  // --- API GENERATION LOGIC ---
  const generateCloud = async (messages, onUpdate) => {
    try {
      const response = await fetch(`${cloudConfig.url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cloudConfig.key}`
        },
        body: JSON.stringify({
          model: cloudConfig.model,
          messages,
          stream: true,
          temperature: config.temperature,
          top_p: config.top_p
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`API Error: ${response.status} ${err}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE (data: {...})
        const lines = chunk.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const content = json.choices[0]?.delta?.content || '';
              fullText += content;
              onUpdate(fullText);
            } catch {
              // ignore parse errors for partial chunks
            }
          }
        }
      }
    } catch (e) {
      onUpdate(`Error: ${e.message}`);
      throw e;
    }
  };

  // Fetch Cloud Models
  const fetchCloudModels = async () => {
    // If in vLLM mode we use a locked preset — no network fetch needed.
    if (inferenceMode === 'vllm') {
      setCloudModels(['openai/gpt-oss-20b']);
      setCloudConfig(prev => ({ ...prev, url: 'http://localhost:8000/v1', model: 'openai/gpt-oss-20b' }));
      return;
    }
    setIsFetchingCloudModels(true);
    try {
      // Remove /v1 if present to get base, then try /v1/models or /models
      // Standard OpenAI compatible usually is GET /v1/models
      const baseUrl = cloudConfig.url.endsWith('/') ? cloudConfig.url.slice(0, -1) : cloudConfig.url;
      const response = await fetch(`${baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${cloudConfig.key}` }
      });
      
      if (!response.ok) throw new Error('Failed to fetch');
      
      const data = await response.json();
      // Handle different formats (Ollama: .models, OpenAI: .data)
      const list = data.data || data.models || [];
      const modelNames = list.map(m => m.id || m.name);
      setCloudModels(modelNames);
      
      // Auto-select first model if current one isn't in list to prevent stuck state
      if (modelNames.length > 0 && !modelNames.includes(cloudConfig.model)) {
         setCloudConfig(prev => ({...prev, model: modelNames[0]}));
      }
    } catch (err) {
      alert("Could not fetch models. Check URL and Key: " + (err?.message || err));
    } finally {
      setIsFetchingCloudModels(false);
    }
  };

  // Handle Sending Messages
  const handleSend = async () => {
    if (!input.trim() || isGenerating || !activeChatId) return;
    if (inferenceMode === 'local' && status !== 'ready') return;
    
    const text = input;
    setInput('');
    setIsGenerating(true);

    // 1. Add User Message to State & DB
    const userMsg = { chatId: activeChatId, role: 'user', content: text };
    db.messages.add(userMsg);
    setMessages(prev => [...prev, userMsg]);

    // 2. Update Chat Title
    const currentChat = chatHistory.find(c => c.id === activeChatId);
    if (currentChat && currentChat.title === 'New Conversation') {
      const newTitle = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      db.chats.update(activeChatId, { title: newTitle, timestamp: Date.now() });
      setChatHistory(prev => prev.map(c => c.id === activeChatId ? { ...c, title: newTitle } : c));
    } else {
      db.chats.update(activeChatId, { timestamp: Date.now() });
      setChatHistory(prev => {
        const filtered = prev.filter(c => c.id !== activeChatId);
        return [{...currentChat, timestamp: Date.now()}, ...filtered];
      });
    }

    // 3. Prepare Context
    const llmMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text }
    ];

    // 4. Stream Response
    let botResponseText = "";
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      if (inferenceMode === 'local') {
        await generate(llmMessages, (chunk) => {
          botResponseText = chunk;
          setMessages(prev => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...copy[copy.length - 1], content: chunk };
            return copy;
          });
        });
      } else {
        await generateCloud(llmMessages, (chunk) => {
          botResponseText = chunk;
          setMessages(prev => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...copy[copy.length - 1], content: chunk };
            return copy;
          });
        });
      }
      // 5. Save Final Bot Message
      db.messages.add({ chatId: activeChatId, role: 'assistant', content: botResponseText });
    } catch (err) {
      console.error(err);
    }
    
    setIsGenerating(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Auto-scroll
  useEffect(() => {
    if (chatContainerRef.current) chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [messages, progress.text, isGenerating]);

  // Models Filter
  const filteredModels = availableModels.filter(m => m.model_id.toLowerCase().includes(searchQuery.toLowerCase()));

  // --- RENDER ---
  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden selection:bg-indigo-500/30 selection:text-indigo-200">
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} config={config} updateConfig={updateConfig} systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />
      
      {/* MOBILE OVERLAY */}
      {isSidebarOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden" onClick={() => setIsSidebarOpen(false)} />}

      {/* SIDEBAR */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-80 bg-slate-900/95 backdrop-blur-xl border-r border-slate-800 
        transform transition-transform duration-300 ease-out flex flex-col shadow-2xl
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0
      `}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-900 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-white tracking-tight">
              <div className="w-8 h-8 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Brain className="text-white" size={18} />
              </div>
              <span className="text-lg">WebLLM</span>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
          </div>

          {/* Inference Mode Toggle */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button 
              onClick={() => { setInferenceMode('local'); setActiveTab('models'); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${inferenceMode === 'local' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Cpu size={14}/> Local
            </button>
            <button 
              onClick={() => { setInferenceMode('cloud'); setActiveTab('models'); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${inferenceMode === 'cloud' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Cloud size={14}/> API
            </button>
            <button
              onClick={() => {
                // Hard-coded vLLM preset (localhost:8000/v1 + openai/gpt-oss-20b)
                setInferenceMode('vllm');
                setActiveTab('models');
                setCloudConfig({ url: 'http://localhost:8000/v1', key: '', model: 'openai/gpt-oss-20b' });
                setCloudModels(['openai/gpt-oss-20b']);
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${inferenceMode === 'vllm' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Server size={14}/> vLLM
            </button>
          </div>
          
          <button 
            onClick={createNewChat}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl transition-all shadow-lg shadow-indigo-500/10 active:scale-95 font-medium text-sm"
          >
            <Plus size={16} /> New Chat
          </button>

          {/* Tabs */}
          <div className="flex border-b border-slate-800 -mb-4 gap-4 px-2">
            <button 
              onClick={() => setActiveTab('models')} 
              className={`pb-3 text-xs font-bold border-b-2 transition-colors ${activeTab === 'models' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
            >
              Settings & Models
            </button>
            <button 
              onClick={() => setActiveTab('chats')} 
              className={`pb-3 text-xs font-bold border-b-2 transition-colors ${activeTab === 'chats' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
            >
              History
            </button>
          </div>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 mt-2">
          
          {/* HISTORY TAB */}
          {activeTab === 'chats' && (
            <div className="space-y-1">
              {chatHistory.length === 0 ? (
                <div className="text-center text-slate-600 mt-10 text-sm">No chat history</div>
              ) : (
                chatHistory.map((chat) => (
                  <div 
                    key={chat.id}
                    onClick={() => selectChat(chat.id)}
                    className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border border-transparent ${activeChatId === chat.id ? 'bg-slate-800 border-slate-700/50 shadow-sm' : 'hover:bg-slate-800/50 hover:border-slate-800'}`}
                  >
                    <MessageSquare size={18} className={activeChatId === chat.id ? 'text-indigo-400' : 'text-slate-600'} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${activeChatId === chat.id ? 'text-white font-medium' : 'text-slate-400'}`}>{chat.title}</div>
                      <div className="text-[10px] text-slate-600 truncate">{new Date(chat.timestamp).toLocaleDateString()}</div>
                    </div>
                    <button 
                      onClick={(e) => deleteChat(e, chat.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* MODELS TAB - LOCAL */}
          {activeTab === 'models' && inferenceMode === 'local' && (
            <div className="space-y-3 p-1">
              <input 
                type="text" 
                placeholder="Filter models..." 
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 mb-2 text-white"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)} 
              />
              {filteredModels.map((model) => {
                const isCached = cachedModels.includes(model.model_id);
                const isActive = activeModel === model.model_id;
                
                return (
                  <div key={model.model_id} onClick={() => loadModel(model.model_id)}
                    className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${isActive ? 'bg-indigo-900/10 border-indigo-500/50' : 'bg-slate-800/30 border-slate-800 hover:border-slate-700'}`} 
                  >
                    <div className="flex justify-between items-start mb-2">
                       <div className="font-medium text-xs text-slate-300 break-all pr-6 leading-relaxed">{model.model_id}</div>
                       {isCached && (
                         <button onClick={(e) => deleteModel(model.model_id, e)} className="absolute top-2 right-2 p-1 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={12} /></button>
                       )}
                    </div>
                    <div className="flex justify-between items-center">
                       <div className="flex gap-1.5">
                         <span className="text-[10px] bg-slate-950 px-1.5 py-0.5 rounded text-slate-500 border border-slate-800">{model.model_id.includes('1b') ? '1.2GB' : model.model_id.includes('7b') ? '5GB' : 'Unknown'}</span>
                         {isCached && <span className="text-[10px] bg-emerald-950/30 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-900/30 flex items-center gap-1"><Database size={8}/> Cached</span>}
                       </div>
                       {isActive ? <span className="text-emerald-400 text-[10px] flex items-center gap-1"><Cpu size={10}/> Active</span> : !isCached && <span className="text-slate-500 text-[10px] flex items-center gap-1"><Download size={10}/> Get</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* MODELS TAB - CLOUD OR vLLM */}
          {activeTab === 'models' && (inferenceMode === 'cloud' || inferenceMode === 'vllm') && (
            <div className="p-1 space-y-4">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-3">
                {inferenceMode === 'vllm' ? (
                  <div className="space-y-2">
                    <div className="text-xs text-slate-400 uppercase font-bold">vLLM Preset</div>
                    <div className="text-sm bg-slate-950/40 p-3 rounded-lg border border-slate-800 text-white">
                      <div className="font-medium">URL</div>
                      <div className="text-xs text-slate-300 truncate">http://localhost:8000/v1</div>
                      <div className="mt-2 font-medium">Model</div>
                      <div className="text-xs text-slate-300 truncate">openai/gpt-oss-20b</div>
                    </div>
                    <div className="text-xs text-slate-400/80">This preset uses a local vLLM server (hard-coded). Fetch/selection is locked.</div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Base URL</label>
                      <div className="relative mt-1">
                        <Globe size={14} className="absolute left-3 top-2.5 text-slate-500"/>
                        <input 
                          type="text" 
                          value={cloudConfig.url}
                          onChange={(e) => setCloudConfig(prev => ({...prev, url: e.target.value}))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                          placeholder="http://localhost:11434/v1"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase">API Key (Optional)</label>
                      <div className="relative mt-1">
                        <Server size={14} className="absolute left-3 top-2.5 text-slate-500"/>
                        <input 
                          type="password" 
                          value={cloudConfig.key}
                          onChange={(e) => setCloudConfig(prev => ({...prev, key: e.target.value}))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                          placeholder="sk-..."
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex justify-between items-center">
                        Model Name
                        <button onClick={fetchCloudModels} className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                          <RefreshCw size={10} className={isFetchingCloudModels ? "animate-spin" : ""}/> Fetch
                        </button>
                      </label>

                      {cloudModels.length > 0 ? (
                        <select 
                          value={cloudConfig.model}
                          onChange={(e) => setCloudConfig(prev => ({...prev, model: e.target.value}))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        >
                          {cloudModels.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      ) : (
                        <input 
                          type="text" 
                          value={cloudConfig.model}
                          onChange={(e) => setCloudConfig(prev => ({...prev, model: e.target.value}))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                          placeholder="e.g. llama3"
                        />
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="bg-indigo-900/10 border border-indigo-500/20 p-3 rounded-xl flex items-start gap-2">
                <Server size={16} className="text-indigo-400 mt-0.5 shrink-0"/>
                <div className="text-xs text-indigo-200/80">
                  Compatible with OpenAI, Ollama, LM Studio, vLLM and generic /v1/chat/completions endpoints.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col h-full relative bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950">
        
        {/* Header */}
        <header className="h-16 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/50 flex items-center px-4 md:px-6 justify-between shrink-0 absolute top-0 w-full z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><Menu size={20} /></button>
            <div className="flex flex-col">
              <h1 className="font-bold text-slate-200 text-sm flex items-center gap-2">
                {chatHistory.find(c => c.id === activeChatId)?.title || 'New Chat'}
              </h1>
              <div className="flex items-center gap-1.5">
                {inferenceMode === 'local' ? (
                   <>
                     <span className={`w-1.5 h-1.5 rounded-full ${status === 'ready' ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 'bg-amber-500'}`}></span>
                     <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{status === 'ready' ? activeModel?.split('-')[0] : status}</span>
                   </>
                ) : inferenceMode === 'vllm' ? (
                   <>
                     <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_5px_rgba(139,92,246,0.5)]"></span>
                     <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide flex items-center gap-1">vLLM: openai/gpt-oss-20b</span>
                   </>
                ) : (
                   <>
                     <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]"></span>
                     <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide flex items-center gap-1">API: {cloudConfig.model}</span>
                   </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
             <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-all" title="Settings"><Settings size={18} /></button>
          </div>
        </header>

        {/* Messages */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto pt-20 pb-32 px-4 md:px-0 scroll-smooth">
           {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 opacity-0 animate-in fade-in zoom-in duration-500">
               <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-indigo-500/10 border border-slate-800 relative">
                 {inferenceMode === 'local' ? <Bot size={40} className="text-indigo-500" /> : <Cloud size={40} className="text-blue-500" />}
                 <div className="absolute -bottom-2 -right-2 bg-slate-950 rounded-full p-1 border border-slate-800">
                   {inferenceMode === 'local' ? <Zap size={14} className="text-yellow-500" fill="currentColor"/> : <Globe size={14} className="text-blue-400"/>}
                 </div>
               </div>
               <h2 className="text-2xl font-bold text-slate-200 mb-2">
                 {inferenceMode === 'local' ? "Local GPU Intelligence" : "Cloud API Connection"}
               </h2>
               <p className="text-slate-500 text-center max-w-sm mb-8">
                 {inferenceMode === 'local' 
                   ? "I run entirely in your browser using WebGPU. No data leaves your device." 
                   : `Connected to ${cloudConfig.url}. Data is processed remotely.`}
               </p>
               
               <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full">
                 {['Explain quantum computing', 'Write a Python script to scrape data', 'Creative story about a robot', 'Analyze this code snippet'].map((suggestion, i) => (
                   <button key={i} onClick={() => setInput(suggestion)} className="p-4 bg-slate-900/50 border border-slate-800/50 hover:border-indigo-500/30 hover:bg-slate-800 rounded-xl text-sm text-slate-400 text-left transition-all">{suggestion}</button>
                 ))}
               </div>
            </div>
           ) : (
            <div className="max-w-3xl mx-auto space-y-6 md:px-6">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                  <div className={`flex max-w-[90%] md:max-w-[80%] gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-lg mt-1 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-slate-800 border border-slate-700'}`}>
                      {msg.role === 'user' ? <User size={16} className="text-white"/> : (inferenceMode === 'local' ? <Bot size={16} className="text-emerald-400"/> : <Cloud size={16} className="text-blue-400"/>)}
                    </div>
                    <div className={`group relative px-5 py-3.5 rounded-2xl shadow-sm text-[15px] leading-relaxed ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800/80 backdrop-blur-sm text-slate-200 rounded-tl-none border border-slate-700/50'}`}>
                      <FormatMessage content={msg.content} />
                    </div>
                  </div>
                </div>
              ))}
              {(isGenerating || currentTps > 0) && (
                <div className="flex justify-start max-w-3xl mx-auto md:px-6 mb-2">
                   <div className="ml-12 bg-slate-800/40 p-2 px-3 rounded-lg rounded-tl-none border border-slate-700/30 flex items-center gap-3 backdrop-blur-sm">
                     {isGenerating ? (
                       <div className="flex items-center gap-2">
                         <div className="flex gap-1">
                           <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                           <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-100"></span>
                           <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-200"></span>
                         </div>
                       </div>
                     ) : (
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <CheckCircle2 size={12} className="text-emerald-500/80"/>
                          <span className="text-[10px] font-medium uppercase tracking-wide">Done</span>
                        </div>
                     )}
                     
                     {currentTps > 0 && (
                        <div className="flex items-center gap-1.5 border-l border-slate-700/50 pl-3">
                            <Activity size={10} className="text-indigo-400"/>
                            <span className="text-[10px] font-mono text-indigo-300/90">
                                {currentTps} t/s
                            </span>
                        </div>
                     )}
                   </div>
                </div>
              )}
            </div>
           )}
        </div>

        {/* Loading Overlay (Local Only) */}
        {inferenceMode === 'local' && status === 'loading' && (
          <div className="absolute inset-0 z-20 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 animate-gradient"></div>
              <div className="flex justify-between items-end mb-4">
                <div><h3 className="font-bold text-white text-lg">Downloading Model</h3><p className="text-slate-400 text-xs mt-1">Downloading to browser cache...</p></div>
                <span className="text-indigo-400 font-mono text-xl font-bold">{progress.percent}%</span>
              </div>
              <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden mb-4 border border-slate-700"><div className="h-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-all duration-300 ease-out relative" style={{ width: `${progress.percent}%` }}><div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]"></div></div></div>
              <p className="text-xs text-slate-500 font-mono truncate bg-slate-950 p-2 rounded border border-slate-800">{progress.text}</p>
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent pt-10 pb-6 px-4">
          <div className="max-w-3xl mx-auto relative group">
            <div className={`absolute -inset-0.5 bg-gradient-to-r ${inferenceMode === 'local' ? 'from-indigo-500 to-violet-600' : 'from-blue-500 to-cyan-500'} rounded-2xl opacity-0 transition duration-500 ${(status === 'ready' || inferenceMode === 'cloud') && !isGenerating ? 'group-hover:opacity-40' : ''} blur`}></div>
            <div className="relative flex items-end bg-slate-900 rounded-2xl border border-slate-700/80 shadow-2xl overflow-hidden focus-within:border-indigo-500/50 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={(inferenceMode === 'local' && status !== 'ready') || isGenerating}
                placeholder={inferenceMode === 'local' ? (status === 'ready' ? "Send a message..." : "Load a model to start...") : "Send API message..."}
                className="w-full max-h-32 bg-transparent text-slate-200 placeholder-slate-500 pl-4 pr-14 py-4 focus:outline-none resize-none scrollbar-thin scrollbar-thumb-slate-700"
                rows={1}
                style={{ minHeight: '56px' }}
              />
              <div className="absolute right-2 bottom-2">
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || (inferenceMode === 'local' && status !== 'ready') || isGenerating}
                  className={`p-2.5 rounded-xl flex items-center justify-center transition-all duration-200 ${!input.trim() || (inferenceMode === 'local' && status !== 'ready') || isGenerating ? 'bg-slate-800 text-slate-600' : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg hover:shadow-indigo-500/25 active:scale-95'}`}
                >
                  {isGenerating ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <Send size={20} className={(inferenceMode === 'cloud' || status === 'ready') && input.trim() ? 'ml-0.5' : ''} />}
                </button>
              </div>
            </div>
            <div className="text-center mt-3 flex justify-center items-center gap-3">
              {inferenceMode === 'local' ? (
                 <span className="text-[10px] text-slate-600 uppercase tracking-widest font-bold flex items-center gap-1"><Zap size={10} className="text-indigo-500" /> Powered by WebGPU</span>
              ) : (
                 <span className="text-[10px] text-slate-600 uppercase tracking-widest font-bold flex items-center gap-1"><Cloud size={10} className="text-blue-500" /> Powered by External API</span>
              )}
              <span className="text-[10px] text-slate-700">|</span>
              <span className="text-[10px] text-slate-600 uppercase tracking-widest font-bold flex items-center gap-1"><Database size={10} className="text-emerald-500" /> Private Browser Storage</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}