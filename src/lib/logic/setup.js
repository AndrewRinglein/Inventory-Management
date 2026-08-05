// Products imported from a paper count sheet arrive half-filled: no unit cost,
// no ticket count, and a placeholder type. They can be held and counted, but a
// missing cost must not reach a PO — so anything without a cost is blocked from
// being ordered or received until someone fills it in.
//
// Every field a person still has to fill in shows "update" in its own cell, so
// the gap is visible right where it gets fixed.

import { isMisc } from './categories.js';

/** Type was never set. */
export const needsType = (p) => !p || !p.type;

/** Games sold by the ticket need a count. Paper and dauber supplies don't. */
export const needsTickets = (p) =>
  !!p && !isMisc(p) && p.type !== 'paper' && !(Number(p.tickets) > 0);

/** No unit cost — this is the one that blocks ordering and receiving. */
export const needsCost = (p) => !p || !(Number(p.cost) > 0);

/** Hard gate: can this product be put on a PO or received? */
export const needsSetup = (p) => needsCost(p);

/** Any field still waiting on a person. */
export const needsAnyUpdate = (p) => needsCost(p) || needsType(p) || needsTickets(p);

export const setupReason = (p) => {
  const gaps = [];
  if (needsCost(p)) gaps.push('unit cost');
  if (needsType(p)) gaps.push('type');
  if (needsTickets(p)) gaps.push('ticket count');
  return gaps.length ? `Needs ${gaps.join(', ')}` : '';
};

/** Products that cannot be ordered yet, alphabetical. */
export function productsNeedingSetup(products) {
  return (products || []).filter(needsSetup).sort((a, b) => a.name.localeCompare(b.name));
}

/** Products with any blank field, alphabetical. */
export function productsNeedingUpdate(products) {
  return (products || []).filter(needsAnyUpdate).sort((a, b) => a.name.localeCompare(b.name));
}
