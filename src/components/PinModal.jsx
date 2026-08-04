import React, { useState } from 'react';

export function PinModal({ onSubmit }) {
  const [pin, setPin] = useState('');
  return (
    <div className="modal-bg" onClick={() => onSubmit(null)}>
      <div className="modal" style={{ width: 340, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Admin PIN required</div>
        <p className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>
          Settings, prices, vendors, and deletes are protected.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(pin); }}>
          <input type="password" inputMode="numeric" autoFocus value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={{ textAlign: 'center', fontSize: 18, letterSpacing: 6, width: 160 }} />
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn ghost" onClick={() => onSubmit(null)}>Cancel</button>
            <button className="btn primary">Unlock</button>
          </div>
        </form>
      </div>
    </div>
  );
}
