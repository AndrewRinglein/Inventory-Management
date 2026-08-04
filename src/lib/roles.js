// Role system — role comes from the URL (?role=...), by explicit decision "links and
// HTML parameters (unsecure)". A shared site password still gates entry; the link picks
// what the person can DO. Distribute one link per person:
//
//   https://yourapp.com/?role=admin        Super Admin — everything
//   https://yourapp.com/?role=sc           Inventory Master, Santa Clara
//   https://yourapp.com/?role=rwc          Inventory Master, Redwood City
//   https://yourapp.com/?role=accountant   Accountant — read all, mark invoices paid
//
// Add &demo to any link for the staged sandbox: https://yourapp.com/?role=admin&demo

export const ROLES = {
  admin:      { label: 'Super Admin',            home: null,  badge: 'b-teal' },
  sc:         { label: 'Inventory Master — SC',  home: 'sc',  badge: 'b-green' },
  rwc:        { label: 'Inventory Master — RWC', home: 'rwc', badge: 'b-green' },
  accountant: { label: 'Accountant',             home: null,  badge: 'b-gold' },
};

export function roleFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const r = p.get('role');
  return ROLES[r] ? r : null;    // null -> show the role picker
}

export function demoFromUrl() {
  return new URLSearchParams(window.location.search).has('demo');
}

export function roleLink(roleId, demo) {
  const u = new URL(window.location.href);
  u.searchParams.set('role', roleId);
  if (demo) u.searchParams.set('demo', '');
  else u.searchParams.delete('demo');
  return u.pathname + '?' + u.searchParams.toString().replace(/=(&|$)/g, '$1');
}

/**
 * Central permission check. Actions:
 *  order / send      build + send purchase orders          (masters: own hall; admin)
 *  receive           receive shipments                     (masters: own hall; admin)
 *  boxes             open / sold-out / return / set-aside  (masters: own hall; admin)
 *  markPaid          mark invoices paid                    (accountant; admin)
 *  editCatalog       add/edit games & prices               (admin only)
 *  settings          settings screen                       (admin only)
 */
export function can(roleId, action, hall) {
  if (roleId === 'admin') return true;
  const role = ROLES[roleId];
  if (!role) return false;
  if (roleId === 'accountant') return action === 'markPaid';
  // inventory masters
  if (['order', 'send', 'receive', 'boxes'].includes(action)) return hall === role.home;
  return false;
}
