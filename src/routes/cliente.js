const express = require('express');
const pool = require('../../db/pool');
const { requiereLogin, soloCliente } = require('../middleware/auth');
const { urlTemuValida } = require('../services/pedidos');
const router = express.Router();
router.use(requiereLogin, soloCliente);

router.get('/pedidos', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, estado, total, creado_en FROM pedidos WHERE usuario_id=$1 ORDER BY creado_en DESC', [req.session.usuario.id]);
    res.render('cliente/mis-pedidos', { pedidos: rows });
  } catch (e) { next(e); }
});
router.get('/pedidos/nuevo', (req, res) => res.render('cliente/nuevo-pedido', { error: null, filas: [{}] }));
router.post('/pedidos/nuevo', async (req, res, next) => {
  const links = [].concat(req.body.link || []);
  const notas = [].concat(req.body.nota || []);
  const cantidades = [].concat(req.body.cantidad || []);
  const filas = links.map((link, i) => ({ link: String(link || '').trim(), nota: String(notas[i] || '').trim(), cantidad: String(cantidades[i] ?? '1').trim() }));
  const error = filas.length < 1 || filas.length > 30 ? 'El pedido debe tener entre 1 y 30 artículos.' : filas.some(x => !urlTemuValida(x.link) || !/^\d{1,4}$/.test(x.cantidad) || Number(x.cantidad) < 1 || Number(x.cantidad) > 9999 || x.nota.length > 500) ? 'Revisa los enlaces, cantidades (mínimo 1) y notas de tus artículos.' : null;
  if (error) return res.status(400).render('cliente/nuevo-pedido', { error, filas });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query("INSERT INTO pedidos (usuario_id, estado) VALUES ($1, 'pendiente') RETURNING id", [req.session.usuario.id]);
    const pedidoId = result.rows[0].id;
    for (const fila of filas) await client.query('INSERT INTO articulos (pedido_id, link, nota, cantidad) VALUES ($1,$2,$3,$4)', [pedidoId, fila.link, fila.nota || null, Number(fila.cantidad)]);
    await client.query('COMMIT');
    req.session.mensaje = { tipo: 'exito', texto: `Pedido #${pedidoId} creado. Te avisaremos cuando esté cotizado.` };
    res.redirect(`/cliente/pedidos/${pedidoId}`);
  } catch (e) { if (client) await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client?.release(); }
});
router.get('/pedidos/:id', async (req, res, next) => {
  try {
    const r = await pool.query('SELECT * FROM pedidos WHERE id=$1 AND usuario_id=$2', [req.params.id, req.session.usuario.id]);
    if (!r.rowCount) return res.status(404).render('error', { titulo: 'Pedido no encontrado', mensaje: 'No encontramos ese pedido.' });
    const a = await pool.query('SELECT * FROM articulos WHERE pedido_id=$1 ORDER BY id', [req.params.id]);
    res.render('cliente/detalle-pedido', { pedido: r.rows[0], articulos: a.rows });
  } catch (e) { next(e); }
});
router.post('/pedidos/:id/responder', async (req, res, next) => {
  const accion = String(req.body.accion || '');
  if (!['aceptar', 'rechazar'].includes(accion)) {
    req.session.mensaje = { tipo: 'error', texto: 'Respuesta no válida.' };
    return res.redirect(`/cliente/pedidos/${encodeURIComponent(req.params.id)}`);
  }
  try {
    const estado = accion === 'aceptar' ? 'aceptado' : 'rechazado';
    const r = await pool.query("UPDATE pedidos SET estado=$1, actualizado_en=NOW() WHERE id=$2 AND usuario_id=$3 AND estado='cotizado' RETURNING id", [estado, req.params.id, req.session.usuario.id]);
    req.session.mensaje = { tipo: r.rowCount ? 'exito' : 'error', texto: r.rowCount ? `Cotización ${accion === 'aceptar' ? 'aceptada' : 'rechazada'}.` : 'Este pedido ya no tiene una cotización pendiente de respuesta.' };
    res.redirect(`/cliente/pedidos/${encodeURIComponent(req.params.id)}`);
  } catch (e) { next(e); }
});
module.exports = router;
