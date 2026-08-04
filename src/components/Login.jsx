import React, { useState } from 'react';
import { store, IS_DEMO } from '../lib/store/index.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState(localStorage.getItem('login_email') || '');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await store.signIn(email, pass);
    setBusy(false);
    if (r.ok) { localStorage.setItem('login_email', email); onLogin(); }
    else setErr(r.error || 'Sign-in failed');
  };

  return (
    <div className="login-wrap">
      <form className="login-box" onSubmit={submit}>
        <div style={{ fontSize: 30 }}>🎱</div>
        <h1 style={{ fontSize: 19, margin: '8px 0 4px' }}>Bingo Inventory &amp; Ordering</h1>
        <p className="dim" style={{ fontSize: 13, marginBottom: 18 }}>
          {IS_DEMO ? 'Demo mode — password is "bingo"' : 'Sign in to continue'}
        </p>
        {!IS_DEMO && (
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }} autoFocus />
        )}
        <input type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)}
          style={{ width: '100%', marginBottom: 14 }} autoFocus={IS_DEMO} />
        {err && <div style={{ color: '#a33b2e', fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
