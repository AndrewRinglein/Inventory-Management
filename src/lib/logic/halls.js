// Where a delivery actually goes.
//
// Each hall has one address that covers most orders, but not every vendor drops
// at the same door — Redwood City takes some deliveries somewhere other than the
// hall itself. So a hall carries a default address plus optional per-vendor
// overrides, and the PO prints whichever applies to the vendor it's going to.
//
// halls_config shape (a plain settings JSON, no schema change):
//   { rwc: { address: "…hall…", byVendor: { md: "…warehouse…" } }, sc: { … } }
// An override that is blank or missing means "use the hall default", so clearing
// the box is how you go back to normal rather than a separate control.

/** The address a PO to this vendor should print. Falls back to the hall default. */
export function deliveryAddress(hallsConfig, hallId, vendorId) {
  const hall = (hallsConfig || {})[hallId] || {};
  const override = (hall.byVendor || {})[vendorId];
  const pick = (typeof override === 'string' && override.trim()) ? override : hall.address;
  return (pick || '').trim();
}

/** A resolver bound to one hall — what buildOrderEmails wants. */
export const addressResolver = (hallsConfig, hallId) =>
  (vendorId) => deliveryAddress(hallsConfig, hallId, vendorId);

/** True when this vendor has its own address rather than using the hall default. */
export const hasOverride = (hallsConfig, hallId, vendorId) => {
  const v = (((hallsConfig || {})[hallId] || {}).byVendor || {})[vendorId];
  return typeof v === 'string' && v.trim().length > 0;
};

/** Vendors currently pointed somewhere other than the hall default. */
export function overriddenVendors(hallsConfig, hallId, vendors = []) {
  return vendors.filter((v) => hasOverride(hallsConfig, hallId, v.id));
}

/** Set (or clear, with an empty string) one vendor's address for one hall. */
export function setVendorAddress(hallsConfig, hallId, vendorId, address) {
  const cfg = { ...(hallsConfig || {}) };
  const hall = { ...(cfg[hallId] || {}) };
  const byVendor = { ...(hall.byVendor || {}) };
  if (address && address.trim()) byVendor[vendorId] = address;
  else delete byVendor[vendorId];        // blank means "same as the hall"
  hall.byVendor = byVendor;
  cfg[hallId] = hall;
  return cfg;
}
