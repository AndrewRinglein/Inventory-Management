import React, { useContext } from 'react';
import { AppCtx } from '../App.jsx';
import { productsNeedingUpdate } from '../lib/logic/setup.js';

export default function Sidebar() {
  const { hall, setHall, screen, setScreen, payments, pos, products, store, role, roleLabel, can, IS_SANDBOX } = useContext(AppCtx);
  const demoHref = (on) => {
    const u = new URL(window.location.href);
    if (on) u.searchParams.set('demo', ''); else u.searchParams.delete('demo');
    return u.pathname + '?' + u.searchParams.toString().replace(/=(&|$)/g, '$1');
  };
  const openPay = payments.filter((p) => p.status === 'open').length;
  const openPos = pos.filter((p) => p.status === 'sent' || p.status === 'partial').length;
  const toUpdate = productsNeedingUpdate(products).length;

  const Item = ({ id, label, badge, gold, title }) => (
    <div className={'nav-item' + (screen === id ? ' active' : '')} onClick={() => setScreen(id)} title={title || ''}>
      <span>{label}</span>
      {badge ? <span className={'nav-badge' + (gold ? ' gold' : '')}>{badge}</span> : null}
    </div>
  );

  return (
    <div className="sidebar">
      <div className="sb-title">Inventory &amp; Ordering</div>
      <div style={{ padding: '0 6px', marginBottom: 6 }}>
        <span className={'badge ' + ({ admin: 'b-teal', accountant: 'b-gold', sc: 'b-green', rwc: 'b-green' }[role] || 'b-gray')}>{roleLabel}</span>
      </div>
      <div className="sb-sec">Hall</div>
      <div className="hall-switch">
        <button className={hall === 'sc' ? 'on' : ''} onClick={() => setHall('sc')}>Santa Clara</button>
        <button className={hall === 'rwc' ? 'on' : ''} onClick={() => setHall('rwc')}>Redwood City</button>
      </div>
      <Item id="dashboard" label="Dashboard" />
      <Item id="purchase" label="Purchase" />
      <div className="sb-sec">Track</div>
      <Item id="assign" label="Assign Pre-Sale" title="Rack the flash games for a session and print the Paymaster sheet" />
      <Item id="sessionuse" label="Session Use" title="What each session played, and taking it out of stock" />
      <Item id="openboxes" label="Open Boxes" />
      <Item id="inventory" label="Inventory" />
      <Item id="offsite" label="Off-site Stock"
        title="Stock we own that isn't on the floor — held by a distributor or in storage. Counts toward value, never toward what can be played." />
      <Item id="orders" label="Open Orders" badge={openPos || null} />
      <Item id="accounting" label="Accounting" badge={openPay || null} />
      <Item id="intake" label="Receiving" />
      <Item id="history" label="History" title="Everything that has happened — adjustments, deliveries, orders, sessions" />
      <div className="sb-sec">Admin</div>
      <Item id="games" label={can('editCatalog') ? 'Add / Update Games' : 'Game Catalog'}
        badge={toUpdate || null} gold
        title={toUpdate ? `${toUpdate} item${toUpdate === 1 ? '' : 's'} have a blank cost, ticket count or type` : ''} />
      {can('settings') && <Item id="settings" label="Settings" />}
      <div className="sb-sec">Training</div>
      {IS_SANDBOX ? (
        <a className="nav-item" style={{ textDecoration: 'none', color: '#8a6d1f', fontWeight: 600 }} href={demoHref(false)}>← Exit training</a>
      ) : (
        <a className="nav-item" style={{ textDecoration: 'none' }} href={demoHref(true)} title="Sandbox with fake data at every stage — never touches real inventory">🎓 Demo / Training</a>
      )}
      <div style={{ marginTop: 22, padding: '0 6px' }}>
        <button className="btn ghost sm" style={{ width: '100%' }}
          onClick={async () => { await store.signOut(); location.reload(); }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
