import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { store, IS_DEMO, IS_SANDBOX } from './lib/store/index.js';
import { roleFromUrl, roleLink, can as roleCan, ROLES } from './lib/roles.js';
import { createScanCapture, resolveScan, beep } from './lib/logic/scan.js';
import { suggestSession } from './lib/sessions.js';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './components/Dashboard.jsx';
import Purchase from './components/Purchase.jsx';
import Review from './components/Review.jsx';
import Inventory from './components/Inventory.jsx';
import OpenBoxes from './components/OpenBoxes.jsx';
import Orders from './components/Orders.jsx';
import Accounting from './components/Accounting.jsx';
import Receiving from './components/Receiving.jsx';
import Games from './components/Games.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import SessionUse from './components/SessionUse.jsx';
import Assign from './components/Assign.jsx';
import { PinModal } from './components/PinModal.jsx';

export const AppCtx = React.createContext(null);

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const role = roleFromUrl();                       // null -> role picker
  const roleHome = role ? ROLES[role].home : null;
  const [hall, setHall] = useState(() => roleHome || localStorage.getItem('hall_pref') || 'sc');
  const [screen, setScreen] = useState('dashboard');

  // data
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [allPos, setPos] = useState([]);
  // archived orders drop out of every working view — Open Orders' Archive tab reads allPos
  const pos = useMemo(() => allPos.filter((p) => !p.archived_at), [allPos]);
  const [payments, setPayments] = useState([]);
  const [orderQty, setOrderQtyState] = useState({});
  const [settings, setSettings] = useState({});

  // ui
  const [toast, setToastState] = useState(null);
  const [flash, setFlash] = useState(null);
  const [scanMode, setScanMode] = useState('off');       // off | open | soldout | receive
  const [openSession, setOpenSession] = useState(() => suggestSession());
  const [receivingPo, setReceivingPo] = useState(null);  // po id selected on Receiving screen
  const [pinAsk, setPinAsk] = useState(null);            // {resolve}
  const receivingScanRef = useRef(null);                 // Receiving screen registers its scan handler here
  const pinOkRef = useRef(false);
  const toastTimer = useRef(null);
  const undoRef = useRef(null);

  const setToast = useCallback((msg, undo = null, ms = 3200) => {
    clearTimeout(toastTimer.current);
    undoRef.current = undo;
    setToastState(msg ? { msg, undo: !!undo } : null);
    if (msg) toastTimer.current = setTimeout(() => setToastState(null), undo ? 10000 : ms);
  }, []);

  const doUndo = useCallback(async () => {
    const u = undoRef.current;
    undoRef.current = null;
    setToastState(null);
    if (u) { await u(); }
  }, []);

  const reloadHall = useCallback(async (h = hall) => {
    const [bx, ps, pay, oq] = await Promise.all([
      store.getBoxes(h), store.getPos(h), store.getPayments(h), store.getOrderQty(h),
    ]);
    setBoxes(bx); setPos(ps); setPayments(pay); setOrderQtyState(oq);
  }, [hall]);

  const reloadCatalog = useCallback(async () => {
    const [vs, prods] = await Promise.all([store.getVendors(), store.getProducts()]);
    setVendors(vs); setProducts(prods);
  }, []);

  const reloadSettings = useCallback(async () => {
    const keys = ['email', 'po_sequence', 'admin_pin', 'halls_config', 'eom', 'sender'];
    const entries = await Promise.all(keys.map(async (k) => [k, await store.getSetting(k)]));
    setSettings(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    (async () => {
      await store.init();
      setSession(await store.getSession());
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!session) return;
    reloadCatalog();
    reloadSettings();
  }, [session, reloadCatalog, reloadSettings]);

  useEffect(() => {
    if (!session) return;
    reloadHall(hall);
    localStorage.setItem('hall_pref', hall);
  }, [session, hall, reloadHall]);

  // ---- is this tab running the current build? ----
  //
  // Asset filenames are content-hashed, so a browser holding a cached index.html
  // keeps asking for files a later deploy deleted. What the person sees is a screen
  // that will not load and a stack trace from code we already fixed. Poll the build
  // id and say so plainly instead.
  const [staleBuild, setStaleBuild] = useState(false);
  useEffect(() => {
    if (typeof __BUILD_ID__ === 'undefined') return;
    let stop = false;
    const check = async () => {
      try {
        const base = import.meta.env.BASE_URL || '/';
        const r = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const { build } = await r.json();
        if (!stop && build && build !== __BUILD_ID__) setStaleBuild(true);
      } catch { /* offline, or the file isn't there yet — say nothing */ }
    };
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => { stop = true; clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);

  // ---- admin PIN gate ----
  const requirePin = useCallback(() => {
    if (pinOkRef.current) return Promise.resolve(true);
    return new Promise((resolve) => setPinAsk({ resolve }));
  }, []);
  // Check the PIN against the stored value, read fresh at the moment of asking.
  //
  // It used to compare against the copy loaded into React state at sign-in, which
  // meant changing the PIN didn't take effect until everyone reloaded — the new one
  // was rejected and the old one still worked. Worse, a settings read that came back
  // empty fell through to '1234', so a hiccup silently restored the factory PIN.
  // Now: a failed read refuses rather than guessing, and '1234' applies only when no
  // PIN has ever been set.
  const answerPin = useCallback(async (pin) => {
    if (pin === null) { pinAsk?.resolve(false); setPinAsk(null); return; }
    let want;
    try {
      want = (await store.getSetting('admin_pin'))?.pin;
    } catch {
      setToast('Could not check the PIN — check your connection and try again', null, 6000);
      pinAsk?.resolve(false); setPinAsk(null); return;
    }
    if (want == null || want === '') want = '1234';   // never configured
    const ok = String(pin).trim() === String(want).trim();
    if (ok) pinOkRef.current = true;
    pinAsk?.resolve(ok);
    setPinAsk(null);
    if (!ok) setToast('Wrong PIN');
  }, [pinAsk, setToast]);

  // ---- scanner ----
  const scanCtxRef = useRef({});
  scanCtxRef.current = { scanMode, screen, boxes, receivingPo, hall, openSession };

  useEffect(() => {
    if (!session) return;
    const stop = createScanCapture(async (code) => {
      const { scanMode, screen, boxes, receivingPo, hall } = scanCtxRef.current;
      const mode = screen === 'intake' ? 'receive' : scanMode;
      if (mode !== 'off' && !roleCan(role, mode === 'receive' ? 'receive' : 'boxes', hall)) {
        beep(false);
        setToast('Your role can\'t do that in this hall (read-only)');
        return;
      }
      if (mode === 'receive' && receivingScanRef.current) {
        const r = await receivingScanRef.current(code);
        beep(!!r.ok);
        setFlash(r.ok ? 'ok' : 'bad'); setTimeout(() => setFlash(null), 500);
        if (r.message) setToast(r.message);
        return;
      }
      const res = resolveScan(code, { mode, boxes, poId: receivingPo });
      if (!res.ok) {
        beep(false);
        setFlash('bad'); setTimeout(() => setFlash(null), 500);
        setToast(res.message);
        return;
      }
      beep(true);
      setFlash('ok'); setTimeout(() => setFlash(null), 500);
      const b = res.box;
      const pname = productName(b.product_id);
      try {
        if (res.action === 'open') {
          const sess = scanCtxRef.current.openSession;
          await store.updateBox(b.id, { opened_session: sess });
          await store.transitionBox(b.id, 'opened');
          setToast(`Opened for ${sess} — ${pname}`, async () => { await store.transitionBox(b.id, 'in_inventory'); await store.updateBox(b.id, { opened_session: null }); await reloadHall(); });
        } else if (res.action === 'soldout') {
          await store.transitionBox(b.id, 'sold_out');
          setToast(`Sold out — ${pname}`, async () => { await store.transitionBox(b.id, 'opened'); await reloadHall(); });
        } else if (res.action === 'receive') {
          await store.transitionBox(b.id, 'in_inventory');
          setToast(`Received — ${pname}`, async () => { await store.transitionBox(b.id, 'on_order'); await reloadHall(); });
        }
        await reloadHall();
      } catch (err) {
        setToast('Scan failed: ' + err.message);
      }
    });
    return stop;
  }, [session]);   // eslint-disable-line

  const productName = (pid) => products.find((p) => p.id === pid)?.name || pid;

  if (!ready) return null;
  if (!session) return <Login onLogin={async () => setSession(await store.getSession())} />;
  if (!role) return <RolePicker />;

  const canDo = (action, h = hall) => roleCan(role, action, h);
  const readOnlyHall = roleHome && hall !== roleHome;   // master viewing the other hall

  const ctx = {
    store, IS_DEMO, IS_SANDBOX, hall, setHall, screen, setScreen,
    role, roleLabel: ROLES[role].label, roleHome, can: canDo, readOnlyHall,
    vendors, products, boxes, pos, allPos, payments, orderQty, settings,
    reloadHall, reloadCatalog, reloadSettings,
    setToast, requirePin, scanMode, setScanMode, openSession, setOpenSession,
    receivingPo, setReceivingPo, productName, receivingScanRef,
  };

  const SCREENS = {
    dashboard: Dashboard, purchase: Purchase, review: Review, inventory: Inventory,
    openboxes: OpenBoxes, orders: Orders, accounting: Accounting, intake: Receiving,
    games: Games, settings: SettingsScreen, sessionuse: SessionUse, assign: Assign,
  };
  const Screen = SCREENS[screen] || Dashboard;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="layout">
        <Sidebar />
        <div className="main">
          {staleBuild && (
            <div className="demo-banner" style={{ background: '#fdf3e7', borderColor: '#e2c39a', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>
                <b>A newer version of this app has been published.</b> This tab is still running an
                older one — some screens may fail to load until you reload.
              </span>
              <div style={{ flex: 1 }} />
              <button className="btn primary sm" onClick={() => location.reload(true)}>Reload now</button>
            </div>
          )}
          {IS_SANDBOX ? (
            <div className="demo-banner" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span><b>Test mode</b> — staged sandbox with fake data at every stage. Nothing here touches the real system.</span>
              <div style={{ flex: 1 }} />
              <button className="btn ghost sm" onClick={async () => { await store.resetDemo(); location.reload(); }}>Reset demo data</button>
            </div>
          ) : IS_DEMO ? (
            <div className="demo-banner">
              Local mode — data lives only in this browser. Add your Supabase keys to <b>.env</b> to go live (see SETUP.md). Emails are logged, never sent.
            </div>
          ) : null}
          {readOnlyHall && (
            <div className="demo-banner" style={{ background: '#e8eef1', borderColor: '#c3d4db', color: '#2e5d6e' }}>
              Viewing {hall === 'sc' ? 'Santa Clara' : 'Redwood City'} <b>read-only</b> — your role manages {roleHome === 'sc' ? 'Santa Clara' : 'Redwood City'}.
            </div>
          )}
          <Screen />
        </div>
      </div>
      {flash && <div className={`scan-flash ${flash}`} />}
      {toast && (
        <div className="toast">
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={doUndo}>Undo</button>}
        </div>
      )}
      {pinAsk && <PinModal onSubmit={answerPin} />}
    </AppCtx.Provider>
  );
}

/** Shown when the URL has no ?role= parameter — normally people arrive via their role link. */
function RolePicker() {
  return (
    <div className="login-wrap">
      <div className="login-box" style={{ width: 420, textAlign: 'left' }}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 30 }}>🎱</div>
          <h1 style={{ fontSize: 18, margin: '6px 0 2px' }}>Who's signing in?</h1>
          <p className="dim" style={{ fontSize: 12.5 }}>
            Normally you'd open your personal role link — bookmark the one you pick.
          </p>
        </div>
        {Object.entries(ROLES).map(([id, r]) => (
          <a key={id} href={roleLink(id, IS_SANDBOX)} className="nav-item"
            style={{ display: 'flex', border: '1px solid var(--border)', marginBottom: 8, textDecoration: 'none' }}>
            <span style={{ fontWeight: 600 }}>{r.label}</span>
            <span className={'badge ' + r.badge}>{id}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
