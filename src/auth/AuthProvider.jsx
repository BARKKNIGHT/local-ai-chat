import React, { createContext, useState, useEffect } from 'react';
import { apiFetch, API_BASE } from '../api/server';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem('auth_token'));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token && !user) {
      fetchProfile(token).catch(() => {});
    }
  }, []);

  async function register({ username, email, password }) {
    const res = await apiFetch('/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
    if (res.token) {
      setToken(res.token);
      setUser(res.user);
      localStorage.setItem('auth_token', res.token);
      localStorage.setItem('auth_user', JSON.stringify(res.user));
    }
    return res;
  }

  async function login({ email, password }) {
    const res = await apiFetch('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (res.token) {
      setToken(res.token);
      setUser(res.user);
      localStorage.setItem('auth_token', res.token);
      localStorage.setItem('auth_user', JSON.stringify(res.user));
    }
    return res;
  }

  async function fetchProfile(t = token) {
    if (!t) return null;
    setLoading(true);
    try {
      const res = await apiFetch('/me', { method: 'GET', token: t });
      setUser(res.user);
      localStorage.setItem('auth_user', JSON.stringify(res.user));
      return res;
    } finally { setLoading(false); }
  }

  function logout() {
    setToken(null); setUser(null);
    localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user');
  }

  return (
    <AuthContext.Provider value={{ token, user, login, register, logout, fetchProfile, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
