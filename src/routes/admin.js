const express = require('express');
const pool = require('../../db/pool');
const { requiereLogin, soloAdmin } = require('../middleware/auth');
const { ETIQUETAS, parseDinero, aMonto } = require('../services/pedidos');
const { enviarCotizacion } = require('../services/correo');
const router = express.Router();
router.use(requiereLogin, soloAdmin);

router.get('/pedidos', async (req, res, next) => {
  const estado = String(req.query.estado || '');
  const buscar = String(req.query.buscar || '').trim().slice(0, 120);
  const permitidos = Object.keys(ETIQUETAS);
  if (estado && !permitidos.includes(estado)) return res.status(400).render('error', { titulo: 'Filtro no válido', mensaje: 'El estado indicado no es válido.' });
  try {
    const { rows } = await pool.query(`SELECT p.id,p.estado,p.total,p.creado_en,u.nombre AS cliente,u.correo
      FROM pedidos p JOIN usuarios u ON u.id=p.usuario_id
      WHERE ($1='' OR p.estado=$1) AND ($2='' OR u.nombre ILIKE '%' || $2 || '%' OR u.correo ILIKE '%' || $2 || '%')
      ORDER BY p.creado_en DESC`, [estado, buscar]);
    res.render('admin/pedidos', { pedidos: rows, estado, buscar });
  } catch (e) { next(e); }
});
async function cargarDetalle(id) {
  const p = await pool.query('SELECT p.*,u.nombre AS cliente,u.correo,u.telefono FROM pedidos p JOIN usuarios u ON u.id=p.usuario_id WHERE p.id=$1', [id]);
  if (!p.rowCount) return null;
  const a = await pool.query('SELECT * FROM articulos WHERE pedido_id=$1 ORDER BY id', [id]);
  return { pedido: p.rows[0], articulos: a.rows };
}
router.get('/pedidos/:id', async (req, res, next) => {
  try {
    const datos = await cargarDetalle(req.params.id);
    if (!datos) return res.status(404).render('error', { titulo: 'Pedido no encontrado', mensaje: 'No encontramos ese pedido.' });
    res.render('admin/detalle-pedido', { ...datos, error: null });
  } catch (e) { next(e); }
});
router.post('/pedidos/:id/cotizar', async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const pedidoR = await client.query("SELECT p.*,u.nombre AS cliente,u.correo,u.telefono FROM pedidos p JOIN usuarios u ON u.id=p.usuario_id WHERE p.id=$1 FOR UPDATE OF p", [req.params.id]);
    if (!pedidoR.rowCount) { await client.query('ROLLBACK'); return res.status(404).render('error', { titulo: 'Pedido no encontrado', mensaje: 'No encontramos ese pedido.' }); }
    const pedido = pedidoR.rows[0];
    if (!['pendiente', 'cotizado'].includes(pedido.estado)) throw new Error('Solo se pueden cotizar pedidos pendientes o volver a cotizar pedidos cotizados.');
    const artR = await client.query('SELECT * FROM articulos WHERE pedido_id=$1 ORDER BY id FOR UPDATE', [pedido.id]);
    const precios = [].concat(req.body.precio_unitario || []);
    if (!artR.rowCount || precios.length !== artR.rowCount) throw new Error('Ingresa un precio para cada artículo.');
    const cents = precios.map((v, i) => parseDinero(v, `Precio del artículo ${i + 1}`));
    const envioCents = parseDinero(req.body.envio ?? '0', 'El envío');
    const comisionCents = parseDinero(req.body.comision ?? '0', 'La comisión');
    let totalCents = envioCents + comisionCents;
    for (let i = 0; i < artR.rows.length; i++) {
      totalCents += Number(artR.rows[i].cantidad) * cents[i];
      await client.query('UPDATE articulos SET precio_unitario=$1 WHERE id=$2 AND pedido_id=$3', [aMonto(cents[i]), artR.rows[i].id, pedido.id]);
    }
    if (!Number.isSafeInteger(totalCents) || totalCents > 999999999999) throw new Error('El total calculado excede el monto permitido.');
    const upd = await client.query("UPDATE pedidos SET envio=$1,comision=$2,total=$3,estado='cotizado',cotizado_en=NOW(),actualizado_en=NOW() WHERE id=$4 RETURNING *", [aMonto(envioCents), aMonto(comisionCents), aMonto(totalCents), pedido.id]);
    const artFinal = await client.query('SELECT * FROM articulos WHERE pedido_id=$1 ORDER BY id', [pedido.id]);
    await client.query('COMMIT');
    client.release();
    client = null;
    try {
      await enviarCotizacion({ cliente: pedido, pedido: upd.rows[0], articulos: artFinal.rows });
      req.session.mensaje = { tipo: 'exito', texto: `La cotización se guardó y se envió al correo de ${pedido.correo}.` };
    } catch (mailError) {
      console.error('No se pudo enviar la cotización:', mailError.message);
      req.session.mensaje = { tipo: 'error', texto: 'La cotización se guardó pero el correo no se pudo enviar. Puedes reenviarlo desde el pedido.' };
    }
    return res.redirect(`/admin/pedidos/${pedido.id}`);
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    const datos = await cargarDetalle(req.params.id).catch(() => null);
    if (!datos) return next(e);
    return res.status(400).render('admin/detalle-pedido', { ...datos, error: e.message });
  } finally { client?.release(); }
});
router.post('/pedidos/:id/reenviar', async (req, res, next) => {
  try {
    const datos = await cargarDetalle(req.params.id);
    if (!datos) return res.status(404).render('error', { titulo: 'Pedido no encontrado', mensaje: 'No encontramos ese pedido.' });
    if (datos.pedido.estado !== 'cotizado') {
      req.session.mensaje = { tipo: 'error', texto: 'Solo se puede reenviar el correo de un pedido cotizado.' };
      return res.redirect(`/admin/pedidos/${datos.pedido.id}`);
    }
    await enviarCotizacion({ cliente: datos.pedido, pedido: datos.pedido, articulos: datos.articulos });
    req.session.mensaje = { tipo: 'exito', texto: `Se reenvió la cotización a ${datos.pedido.correo}.` };
  } catch (e) {
    if (e.message.includes('Pedido')) return next(e);
    req.session.mensaje = { tipo: 'error', texto: 'No se pudo reenviar el correo. Verifica la configuración de Gmail.' };
  }
  res.redirect(`/admin/pedidos/${encodeURIComponent(req.params.id)}`);
});
router.post('/pedidos/:id/estado', async (req, res, next) => {
  const esperado = { comprado: 'aceptado', entregado: 'comprado' };
  const nuevo = String(req.body.estado || '');
  const anterior = esperado[nuevo];
  if (!anterior) {
    req.session.mensaje = { tipo: 'error', texto: 'Transición de estado no válida.' };
    return res.redirect(`/admin/pedidos/${encodeURIComponent(req.params.id)}`);
  }
  try {
    const r = await pool.query('UPDATE pedidos SET estado=$1,actualizado_en=NOW() WHERE id=$2 AND estado=$3 RETURNING id', [nuevo, req.params.id, anterior]);
    req.session.mensaje = { tipo: r.rowCount ? 'exito' : 'error', texto: r.rowCount ? `El pedido pasó a ${ETIQUETAS[nuevo].toLowerCase()}.` : 'El estado actual del pedido no permite ese cambio.' };
    res.redirect(`/admin/pedidos/${encodeURIComponent(req.params.id)}`);
  } catch (e) { next(e); }
});
module.exports = router;
