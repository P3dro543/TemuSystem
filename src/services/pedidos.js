const ETIQUETAS = { pendiente: 'Pendiente', cotizado: 'Cotizado', aceptado: 'Aceptado', rechazado: 'Rechazado', comprado: 'Comprado', entregado: 'Entregado' };
function dinero(valor, simbolo = '$') {
  const numero = Number(valor || 0);
  return `${simbolo}${(Number.isFinite(numero) ? numero : 0).toFixed(2)}`;
}
function parseDinero(valor, nombre) {
  const texto = String(valor ?? '').trim().replace(',', '.');
  if (!/^(?:\d{1,10})(?:\.\d{1,2})?$/.test(texto)) throw new Error(`${nombre} debe ser un monto positivo o cero, con hasta dos decimales.`);
  const cents = Math.round(Number(texto) * 100);
  if (!Number.isSafeInteger(cents) || cents > 999999999999) throw new Error(`${nombre} excede el monto permitido.`);
  return cents;
}
function aMonto(cents) { return (cents / 100).toFixed(2); }
function urlTemuValida(texto) {
  try { const u = new URL(texto); return ['http:', 'https:'].includes(u.protocol); } catch { return false; }
}
module.exports = { ETIQUETAS, dinero, parseDinero, aMonto, urlTemuValida };
