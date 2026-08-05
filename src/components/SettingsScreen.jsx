import React, { useContext, useEffect, useState } from 'react';
import { AppCtx } from '../App.jsx';
import { deliveryAddress, setVendorAddress, overriddenVendors } from '../lib/logic/halls.js';

export default function SettingsScreen() {
  const { settings, vendors, store, reloadSettings, reloadCatalog, setToast, requirePin, IS_DEMO, hall, boxes, pos, payments, products, can } = useContext(AppCtx);
  if (!can('settings')) return <div className="card pad dimmer">Settings are Super Admin only.</div>;
  const [unlocked, setUnlocked] = useState(false);
  const [email, setEmail] = useState(null);
  const [halls, setHalls] = useState(null);
  const [pin, setPin] = useState('');
  const [vend, setVend] = useState(null);
  const [sender, setSender] = useState(null);
  const [senderHall, setSenderHall] = useState('sc');
  const [addrHall, setAddrHall] = useState(null);   // which hall's per-vendor list is open

  useEffect(() => {
    (async () => { setUnlocked(await requirePin()); })();
  }, []);   // eslint-disable-line

  useEffect(() => {
    setEmail(settings.email || { testMode: true, testAddress: '', fromAddress: '', accountingAddress: '' });
    setHalls(settings.halls_config || { sc: { address: '' }, rwc: { address: '' } });
    setVend(Object.fromEntries(vendors.map((v) => [v.id, { email: v.email || '', contact_name: v.contact_name || '' }])));
    const raw = settings.sender || {};
    const blank = { name: '', org: '', title: '', phone: '', replyTo: '' };
    // normalise the legacy flat shape into per-hall entries
    setSender((raw.name || raw.org)
      ? { sc: { ...blank, ...raw }, rwc: { ...blank, ...raw } }
      : { sc: { ...blank, ...(raw.sc || {}) }, rwc: { ...blank, ...(raw.rwc || {}) } });
  }, [settings, vendors]);

  if (!unlocked) return <div className="card pad dimmer">Settings are PIN-protected.</div>;
  if (!email || !halls || !vend || !sender) return null;

  const save = async () => {
    await store.setSetting('email', email);
    await store.setSetting('halls_config', halls);
    await store.setSetting('sender', sender);
    for (const v of vendors) {
      const next = vend[v.id];
      if ((v.email || '') !== next.email || (v.contact_name || '') !== next.contact_name) {
        await store.updateVendor(v.id, { email: next.email, contact_name: next.contact_name });
      }
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <b style={{ fontSize: 13.5 }}>Who the emails come from</b>
              <div className="hall-switch" style={{ margin: 0, width: 220 }}>
                <button type="button" className={senderHall === 'sc' ? 'on' : ''} onClick={() => setSenderHall('sc')}>Santa Clara</button>
                <button type="button" className={senderHall === 'rwc' ? 'on' : ''} onClick={() => setSenderHall('rwc')}>Redwood City</button>
              </div>
            </div>
            <p className="muted-note" style={{ marginTop: 2, marginBottom: 8 }}>
              Each hall's orders come from its own person. Vendors see this name in their inbox and in the signature.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}><Row label="Name"><input type="text" placeholder="Sagit" value={sender[senderHall].name || ''} onChange={(e) => setSender({ ...sender, [senderHall]: { ...sender[senderHall], name: e.target.value } })} style={{ width: '100%' }} /></Row></div>
              <div style={{ flex: 1 }}><Row label="Organization"><input type="text" placeholder="Vanguard" value={sender[senderHall].org || ''} onChange={(e) => setSender({ ...sender, [senderHall]: { ...sender[senderHall], org: e.target.value } })} style={{ width: '100%' }} /></Row></div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}><Row label="Title (optional)"><input type="text" value={sender[senderHall].title || ''} onChange={(e) => setSender({ ...sender, [senderHall]: { ...sender[senderHall], title: e.target.value } })} style={{ width: '100%' }} /></Row></div>
              <div style={{ flex: 1 }}><Row label="Phone (optional)"><input type="text" value={sender[senderHall].phone || ''} onChange={(e) => setSender({ ...sender, [senderHall]: { ...sender[senderHall], phone: e.target.value } })} style={{ width: '100%' }} /></Row></div>
            </div>
            <Row label="Reply-to address (where vendor replies should land)">
              <input type="email" value={sender[senderHall].replyTo || ''} onChange={(e) => setSender({ ...sender, [senderHall]: { ...sender[senderHall], replyTo: e.target.value } })} style={{ width: '100%' }} /></Row>
            <p className="muted-note">
              Emails will appear as: <b>{[sender[senderHall].name, sender[senderHall].org].filter(Boolean).join(' — ') || '(no name set)'}</b> &lt;{email.fromAddress || 'not set'}&gt;
            </p>
          </div>
          <div className="card pad" style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13.5 }}>Email</b>
            <div style={{ marginTop: 10 }}>
              <Row label="Send FROM address (your orders@ address)">
                <input type="email" value={email.fromAddress} onChange={(e) => setEmail({ ...email, fromAddress: e.target.value })} style={{ width: '100%' }} /></Row>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 2 }}><Row label="Accounting address (gets the delivered-$ report)">
                  <input type="email" value={email.accountingAddress} onChange={(e) => setEmail({ ...email, accountingAddress: e.target.value })} style={{ width: '100%' }} /></Row></div>
                <div style={{ flex: 1 }}><Row label="Their first name">
                  <input type="text" placeholder="Jamie" value={email.accountingName || ''} onChange={(e) => setEmail({ ...email, accountingName: e.target.value })} style={{ width: '100%' }} /></Row></div>
              </div>
              <Row label="CC on every email — separate several with commas (applies when test mode is OFF)">
                <input type="email" value={email.ccAddress || ''} onChange={(e) => setEmail({ ...email, ccAddress: e.target.value })} style={{ width: '100%' }} /></Row>
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
                <div key={v.id} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 2 }}><Row label={v.name}>
                    <input type="email" value={vend[v.id].email}
                      onChange={(e) => setVend({ ...vend, [v.id]: { ...vend[v.id], email: e.target.value } })} style={{ width: '100%' }} />
                  </Row></div>
                  <div style={{ flex: 1 }}><Row label="Contact first name">
                    <input type="text" placeholder="Scott" value={vend[v.id].contact_name}
                      onChange={(e) => setVend({ ...vend, [v.id]: { ...vend[v.id], contact_name: e.target.value } })} style={{ width: '100%' }} />
                  </Row></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="card pad" style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13.5 }}>Halls — delivery addresses</b>
            <p className="muted-note" style={{ marginTop: 4, marginBottom: 4 }}>
              This is the “Please deliver to” block on the PO. Set the hall's usual address, and
              give a vendor its own only when they drop somewhere else.
            </p>
            <div style={{ marginTop: 6 }}>
              {[['sc', 'Santa Clara'], ['rwc', 'Redwood City']].map(([hid, label]) => {
                const over = overriddenVendors(halls, hid, vendors);
                const open = addrHall === hid;
                return (
                  <div key={hid} style={{ marginBottom: 12 }}>
                    <Row label={`${label} — usual delivery address`}>
                      <input type="text" placeholder="street, city, state"
                        value={halls[hid]?.address || ''}
                        onChange={(e) => setHalls({ ...halls, [hid]: { ...halls[hid], address: e.target.value } })}
                        style={{ width: '100%' }} /></Row>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <button className="btn ghost sm" onClick={() => setAddrHall(open ? null : hid)}>
                        {open ? 'Hide vendor addresses' : 'Different address for some vendors →'}
                      </button>
                      {over.length > 0 && (
                        <span className="badge b-teal" title={over.map((v) => v.name).join(', ')}>
                          {over.length} vendor{over.length === 1 ? '' : 's'} elsewhere
                        </span>
                      )}
                    </div>
                    {open && (
                      <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: '2px solid var(--border)' }}>
                        {vendors.map((v) => (
                          <Row key={v.id} label={v.name}>
                            <input type="text"
                              placeholder={halls[hid]?.address ? `same as ${label} — ${halls[hid].address}` : `same as ${label}`}
                              value={halls[hid]?.byVendor?.[v.id] || ''}
                              onChange={(e) => setHalls(setVendorAddress(halls, hid, v.id, e.target.value))}
                              style={{ width: '100%' }} />
                          </Row>
                        ))}
                        <p className="muted-note" style={{ marginTop: 2 }}>
                          Leave a vendor blank to use the hall address. Clearing one puts it back to normal.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
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
