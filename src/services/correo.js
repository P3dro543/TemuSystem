const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');
const { dinero } = require('./pedidos');

let transportador;
function obtenerTransportador() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('Falta configurar GMAIL_USER o GMAIL_APP_PASSWORD.');
  if (!transportador) transportador = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  return transportador;
}
async function enviarCotizacion({ cliente, pedido, articulos }) {
  const simbolo = process.env.CURRENCY_SYMBOL || '$';
  const enlace = `${(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}/cliente/pedidos/${pedido.id}`;
  const datos = { cliente, pedido, articulos, enlace, simbolo, dinero };
  const html = await ejs.renderFile(path.join(__dirname, '../../views/emails/cotizacion.ejs'), datos, { async: true });
  const filas = articulos.map(a => `- ${a.link}\n  Nota: ${a.nota || 'Sin nota'}\n  Cantidad: ${a.cantidad} × ${dinero(a.precio_unitario, simbolo)} = ${dinero(a.subtotal, simbolo)}`).join('\n');
  const texto = `Hola ${cliente.nombre},\n\nEsta es la cotización del pedido #${pedido.id} (${new Date(pedido.cotizado_en || Date.now()).toLocaleDateString('es-CR')}).\n\n${filas}\n${Number(pedido.envio) > 0 ? `Envío: ${dinero(pedido.envio, simbolo)}\n` : ''}${Number(pedido.comision) > 0 ? `Comisión: ${dinero(pedido.comision, simbolo)}\n` : ''}TOTAL: ${dinero(pedido.total, simbolo)}\n\nIngresa a tu cuenta para aceptar o rechazar la cotización: ${enlace}`;
  return obtenerTransportador().sendMail({ from: process.env.GMAIL_USER, to: cliente.correo, subject: `Tu cotización del pedido #${pedido.id}`, text: texto, html });
}
module.exports = { enviarCotizacion };
