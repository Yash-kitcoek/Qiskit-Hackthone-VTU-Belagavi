export const SHIPMENT_PRICING = Object.freeze({
  depositRupeesPerKm: 5,
  brokerCommissionRupeesPerKm: 3,
  otherChargesRupees: 0,
  termsVersion: "LOADSETU-SHIPMENT-TERMS-1.0",
  confirmationTokenTtlHours: 72,
});

export function roundRupees(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
export function toPaise(rupees) { return Math.round(roundRupees(rupees) * 100); }
export function haversineKm(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 100) / 100;
}
