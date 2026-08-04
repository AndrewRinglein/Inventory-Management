import React, { useContext, useEffect, useState } from 'react';
import { AppCtx } from '../App.jsx';

export default function SettingsScreen() {
  const { settings, vendors, store, reloadSettings, reloadCatalog, setToast, requirePin, IS_DEMO, hall, boxes, pos, payments, products, can } = useContext(AppCtx);
  if (!can('settings')) return <div className="card pad dimmer">Settings are Super Admin only.</div>;
  const [unlocked, setUnlocked] = useState(false);
  const [email, setEmail] = useState(null);
  const [halls, setHalls] = useState(null);
  const [pin, setPin] = useState('');
  const [vend, setVend] = useState(null);

  useEffect(() => {
    (async () => { setUnlocked(await requirePin()); })();
  }, []);   // eslint-disable-line

  useEffect(() => {
    setEmail(settings.email || { testMode: true, testAddress: '', fromAddress: '', accountingAddress: '' });
    setHalls(settings.halls_config || { sc: { address: '' }, rwc: { address: '' } });
    setVend(Object.fromEntries(vendors.map((v) => [v.id, v.email || ''])));
  }, [settings, vendors]);

  if (!unlocked) return <div className="card pad dimmer">Settings are PIN-protected.</div>;
  if (!email || !halls || !vend) return null;

  const save = async () => {
    await store.setSetting('email', email);
    await store.setSetting('halls_config', halls);
    for (const v of vendors) {
      if ((v.email || '') !== vend[v.id]) await store.updateVendor(v.id, { email: vend[v.id] });
    }
    if (pin.trim()) await store.setSetting('admin_pin', { pin: pin.trim() });
    await reloadSettings(); await reloadCatalog();
    setToast('Settings saved');
  };

  const exportData = () => {
    const data = { exported_at: new Date().toISOString(), hall, products, boxes, pos, payments };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bingo-inventory-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const Row = ({ label, children }) => (
    <div className="field"><label>{label}</label>{children}</div>
  );

  return (
    <div>
      <div className="page-head"><div className="h1">Settings</div></div>
      <div className="two-col">
        <div>
          <div className="card pad" style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13.5 }}>Email</b>
            <div style={{ marginTop: 10 }}>
              <Row label="Send FROM address (your orders@ address)">
                <input type="email" value={email.fromAddress} onChange={(e) => setEmail({ ...email, fromAddress: e.target.value })} style={{ width: '100%' }} /></Row>
              <Row label="Accounting address (receives PO copies + delivered-$ reports)">
                <input type="email" value={email.accountingAddress} onChange={(e) => setEmail({ ...email, accountingAddress: e.target.value })} style={{ width: '100%' }} /></Row>
              <Row label={<span><b>Test mode</b> — all emails go to this address instead of vendors</span>}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!email.testMode} onChange={(e) => setEmail({ ...email, testMode: e.target.checked })} />
                  <input type="email" placeholder="test inbox" value={email.testAddress} onChange={(e) => setEmail({ ...email, testAddress: e.target.value })} style={{ flex: 1 }} />
                </div></Row>
            </div>
          </div>
          <div className="card pad" style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13.5 }}>Vendor PO addresses</b>
            <div style={{ marginTop: 10 }}>
              {vendors.map((v) => (
                <Row key={v.id} label={v.name}>
                  <input type="email" value={vend[v.id]} onChange={(e) => setVend({ ...vend, [v.id]: e.target.value })} style={{ width: '100%' }} />
                </Row>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="card pad" style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13.5 }}>Halls</b>
            <div style={{ marginTop: 10 }}>
              <Row label="Santa Clara delivery address">
                <input type="text" value={halls.sc?.address || ''} onChange={(e) => setHalls({ ...halls, sc: { ...halls.sc, address: e.target.value } })} style={{ width: '100%' }} /></Row>
              <Row label="Redwood City delivery address">
                <input type="text" value={halls.rwc?.address || ''} onChange={(e) => setHalls({ ...halls, rwc: { ...halls.rwc, address: e.target.value } })} style={{ width: '100%' }} /></Row>
            </div>
          </div>
          <div className="card pad" style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13.5 }}>Admin PIN</b>
            <div style={{ marginTop: 10 }}>
              <Row label="New PIN (leave blank to keep current)">
                <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} style={{ width: 140 }} /></Row>
            </div>
          </div>
          <div className="card pad">
            <b style={{ fontSize: 13.5 }}>Data</b>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={exportData}>Download data export (JSON)</button>
            </div>
            <p className="muted-note">
              {IS_DEMO
                ? 'Demo mode: data lives in this browser. The weekly email export activates with Supabase.'
                : 'Supabase also keeps daily backups; the weekly export email goes to the accounting address.'}
            </p>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={save}>Save settings</button>
      </div>
    </div>
  );
}
