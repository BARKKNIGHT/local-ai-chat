import React, { useState, useContext } from 'react';
import AuthContext from '../auth/AuthProvider';

export default function Register({ onDone }) {
  const { register } = useContext(AuthContext);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const handle = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await register({ username, email, password });
      if (onDone) onDone();
    } catch (err) {
      setError(err?.error || err?.message || 'Sign up failed');
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800">
      <h2 className="text-xl font-bold mb-4">Create Account</h2>
      <form onSubmit={handle} className="space-y-3">
        <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full p-3 rounded-lg border" />
        <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-3 rounded-lg border" />
        <input placeholder="Password (min 6)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-3 rounded-lg border" />
        {error && <div className="text-sm text-rose-500">{error}</div>}
        <div className="flex justify-between items-center">
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg">Create account</button>
        </div>
      </form>
    </div>
  );
}
