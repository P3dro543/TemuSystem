const express = require('express');
const pool = require('../../db/pool');
const { requiereLogin, soloAdmin } = require('../middleware/auth');
const { ETIQUETAS, parseDinero, aMonto } = require('../services/pedidos');
const { enviarCotizacion } = require('../services/correo');
const router = express.Router();
router.use(requiereLogin, soloAdmin);

router.get('/usuarios', async (req, res, next) => {
  const buscar = String(req.query.buscar || '').trim().slice(0, 120);
  const rol = String(req.query.rol || '');
  const roles = ['admin', 'cliente'];
  const paginaTexto = String(req.query.pagina || '1');
  if ((rol && !roles.includes(rol)) || !/^\d{1,7}$/.test(paginaTexto) || Number(paginaTexto) < 1) {
    return res.status(400).render('error', { titulo: 'Filtro no válido', mensaje: 'Revisa la búsqueda y vuelve a intentarlo.' });
  }
  const porPagina = 50;
  try {
    const conteo = await pool.query(`SELECT COUNT(*)::int AS total FROM usuarios u
      WHERE ($1='' OR u.nombre ILIKE '%' || $1 || '%' OR u.correo ILIKE '%' || $1 || '%')
      AND ($2='' OR u.rol::text=$2)`, [buscar, rol]);
    const total = conteo.rows[0].total;
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const pagina = Math.min(Number(paginaTexto), paginas);
    const { rows } = await pool.query(`SELECT u.id,u.nombre,u.correo,u.telefono,u.rol::text AS rol,u.creado_en,
        COUNT(p.id)::int AS cantidad_pedidos
      FROM usuarios u LEFT JOIN pedidos p ON p.usuario_id=u.id
      WHERE ($1='' OR u.nombre ILIKE '%' || $1 || '%' OR u.correo ILIKE '%' || $1 || '%')
      AND ($2='' OR u.rol::text=$2)
      GROUP BY u.id ORDER BY u.creado_en DESC,u.id DESC LIMIT $3 OFFSET $4`,
    [buscar, rol, porPagina, (pagina - 1) * porPagina]);
    res.render('admin/usuarios', { usuarios: rows, buscar, rol, pagina, paginas, total });
  } catch (e) { next(e); }
});

router.get('/usuarios/:id/editar', async (req, res, next) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).render('error', { titulo: 'Usuario no encontrado', mensaje: 'No encontramos esa cuenta.' });
  try {
    const { rows } = await pool.query(`SELECT id,nombre,correo,telefono,rol::text AS rol
      FROM usuarios WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).render('error', { titulo: 'Usuario no encontrado', mensaje: 'No encontramos esa cuenta.' });
    res.render('admin/editar-usuario', { cuenta: rows[0], error: null });
  } catch (e) { next(e); }
});

router.post('/usuarios/:id/editar', async (req, res, next) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).render('error', { titulo: 'Usuario no encontrado', mensaje: 'No encontramos esa cuenta.' });
  const cuenta = {
    id: req.params.id,
    nombre: String(req.body.nombre || '').trim(),
    correo: String(req.body.correo || '').trim().toLowerCase(),
    telefono: String(req.body.telefono || '').trim(),
    rol: String(req.body.rol || '')
  };
  let error = null;
  if (cuenta.nombre.length < 2 || cuenta.nombre.length > 100) error = 'El nombre debe tener entre 2 y 100 caracteres.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cuenta.correo) || cuenta.correo.length > 254) error = 'Ingresa un correo válido.';
  else if (cuenta.telefono.length > 30) error = 'El teléfono debe tener 30 caracteres o menos.';
  else if (!['admin', 'cliente'].includes(cuenta.rol)) error = 'El tipo de cuenta no es válido.';
  if (error) return res.status(400).render('admin/editar-usuario', { cuenta, error });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const actual = await client.query('SELECT id,rol::text AS rol FROM usuarios WHERE id=$1 FOR UPDATE', [cuenta.id]);
    if (!actual.rowCount) {
      await client.query('ROLLBACK');
      req.session.mensaje = { tipo: 'error', texto: 'No encontramos esa cuenta.' };
      return res.redirect('/admin/usuarios');
    }
    const rolActual = actual.rows[0].rol;
    const esCuentaActual = String(req.session.usuario.id) === String(cuenta.id);
    if (esCuentaActual && rolActual !== cuenta.rol) throw new Error('No puedes cambiar tu propio rol. Otro administrador puede hacerlo.');
    if (rolActual === 'admin' && cuenta.rol === 'cliente') {
      const admins = await client.query("SELECT id FROM usuarios WHERE rol::text='admin' ORDER BY id FOR UPDATE");
      if (admins.rowCount <= 1) throw new Error('No se puede cambiar el rol del último administrador.');
    }
    const repetido = await client.query('SELECT 1 FROM usuarios WHERE LOWER(correo)=LOWER($1) AND id<>$2 LIMIT 1', [cuenta.correo, cuenta.id]);
    if (repetido.rowCount) throw new Error('Ya existe otra cuenta con ese correo.');
    await client.query('UPDATE usuarios SET nombre=$1,correo=$2,telefono=$3,rol=$4 WHERE id=$5', [cuenta.nombre, cuenta.correo, cuenta.telefono || null, cuenta.rol, cuenta.id]);
    await client.query("DELETE FROM session WHERE sess->'usuario'->>'id'=$1", [cuenta.id]);
    await client.query('COMMIT');
    if (esCuentaActual) Object.assign(req.session.usuario, { nombre: cuenta.nombre, correo: cuenta.correo, telefono: cuenta.telefono || null });
    req.session.mensaje = { tipo: 'exito', texto: `Se actualizaron los datos de ${cuenta.nombre}.` };
    res.redirect('/admin/usuarios');
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    if (e.code === '23505') error = 'Ya existe otra cuenta con ese correo.';
    else if (e.message.includes('No puedes') || e.message.includes('último administrador') || e.message.includes('Ya existe otra cuenta')) error = e.message;
    else return next(e);
    return res.status(400).render('admin/editar-usuario', { cuenta, error });
  } finally { client?.release(); }
});

router.post('/usuarios/:id/eliminar', async (req, res, next) => {
  if (!/^\d{1,18}$/.test(req.params.id)) {
    req.session.mensaje = { tipo: 'error', texto: 'La cuenta indicada no es válida.' };
    return res.redirect('/admin/usuarios');
  }
  const id = String(req.params.id);
  if (String(req.session.usuario.id) === id) {
    req.session.mensaje = { tipo: 'error', texto: 'No puedes eliminar la cuenta con la que tienes iniciada esta sesión.' };
    return res.redirect('/admin/usuarios');
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const target = await client.query('SELECT id,nombre,rol::text AS rol FROM usuarios WHERE id=$1 FOR UPDATE', [id]);
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      req.session.mensaje = { tipo: 'error', texto: 'No encontramos esa cuenta.' };
      return res.redirect('/admin/usuarios');
    }
    if (target.rows[0].rol === 'admin') {
      const admins = await client.query("SELECT id FROM usuarios WHERE rol::text='admin' ORDER BY id FOR UPDATE");
      if (admins.rowCount <= 1) throw new Error('No se puede eliminar el último administrador.');
    }
    const pedidos = await client.query('SELECT 1 FROM pedidos WHERE usuario_id=$1 LIMIT 1', [id]);
    if (pedidos.rowCount) throw new Error('Esta cuenta tiene pedidos asociados; no se puede eliminar sin perder el historial.');
    await client.query("DELETE FROM session WHERE sess->'usuario'->>'id'=$1", [id]);
    await client.query('DELETE FROM usuarios WHERE id=$1', [id]);
    await client.query('COMMIT');
    req.session.mensaje = { tipo: 'exito', texto: `Se eliminó la cuenta de ${target.rows[0].nombre}.` };
    res.redirect('/admin/usuarios');
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    if (e.message.includes('último administrador') || e.message.includes('pedidos asociados')) {
      req.session.mensaje = { tipo: 'error', texto: e.message };
      return res.redirect('/admin/usuarios');
    }
    next(e);
  } finally { client?.release(); }
});

router.get('/pedidos', async (req, res, next) => {
  const estado = String(req.query.estado || '');
  const buscar = String(req.query.buscar || '').trim().slice(0, 120);
  const permitidos = Object.keys(ETIQUETAS);
  if (estado && !permitidos.includes(estado)) return res.status(400).render('error', { titulo: 'Filtro no válido', mensaje: 'El estado indicado no es válido.' });
  try {
    const { rows } = await pool.query(`SELECT p.id,p.estado,p.total,p.creado_en,u.nombre AS cliente,u.correo
      FROM pedidos p JOIN usuarios u ON u.id=p.usuario_id
      WHERE ($1='' OR p.estado::text=$1) AND ($2='' OR u.nombre ILIKE '%' || $2 || '%' OR u.correo ILIKE '%' || $2 || '%')
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
