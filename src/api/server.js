// Central place for API base URL
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000/api';

export async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = options.headers || {};
  if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = 'Bearer ' + options.token;
  const res = await fetch(url, { ...options, headers });
  const content = await res.json().catch(() => null);
  if (!res.ok) throw content || { error: 'Request failed' };
  return content;
}
