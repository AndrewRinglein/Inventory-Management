import React, { useContext } from 'react';
import { AppCtx } from '../App.jsx';

export default function Sidebar() {
  const { hall, setHall, screen, setScreen, payments, pos, store, role, roleLabel, can } = useContext(AppCtx);
  const openPay = payments.filter((p) => p.status === 'open').length;
  const openPos = pos.filter((p) => p.status === 'sent' || p.status === 'partial').length;

  const Item = ({ id, label, badge }) => (
    <div className={'nav-item' + (screen === id ? ' active' : '')} onClick={() => setScreen(id)}>
      <span>{label}</span>
      {badge ? <span className="nav-badge">{badge}</span> : null}
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
      <Item id="openboxes" label="Open Boxes" />
      <Item id="inventory" label="Inventory" />
      <Item id="orders" label="Open Orders" badge={openPos || null} />
      <Item id="accounting" label="Accounting" badge={openPay || null} />
      <Item id="intake" label="Receiving" />
      <div className="sb-sec">Admin</div>
      <Item id="games" label={can('editCatalog') ? 'Add / Update Games' : 'Game Catalog'} />
      {can('settings') && <Item id="settings" label="Settings" />}
      <div style={{ marginTop: 22, padding: '0 6px' }}>
        <button className="btn ghost sm" style={{ width: '100%' }}
          onClick={async () => { await store.signOut(); location.reload(); }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
