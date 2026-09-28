const express = require('express');
const pool = require('../../db/pool');
const { requiereLogin, soloAdmin } = require('../middleware/auth');
const { ETIQUETAS, parseDinero, aMonto } = require('../services/pedidos');
const { enviarCotizacion } = require('../services/correo');
const { registrarAuditoria } = require('../services/auditoria');
const router = express.Router();
router.use(requiereLogin, soloAdmin);
const accionesAuditoria = {
  registro: 'Registro de cuenta', pedido_creado: 'Pedido creado', pedido_respondido: 'Cotización respondida',
  cotizacion_guardada: 'Cotización guardada', pedido_estado_actualizado: 'Estado de pedido actualizado',
  cotizacion_correo_enviado: 'Correo de cotización enviado', usuario_actualizado: 'Datos de usuario actualizados',
  usuario_activado: 'Cuenta activada', usuario_desactivado: 'Cuenta desactivada',
  contrasena_cambiada: 'Contraseña cambiada', contrasena_restablecida: 'Contraseña restablecida',
  politica_privacidad_aceptada: 'Política de privacidad aceptada'
};

router.get('/usuarios', async (req, res, next) => {
  const buscar = String(req.query.buscar || '').trim().slice(0, 120);
  const rol = String(req.query.rol || '');
  const activo = String(req.query.activo || '');
  const roles = ['admin', 'cliente'];
  const paginaTexto = String(req.query.pagina || '1');
  if ((rol && !roles.includes(rol)) || !['', 'true', 'false'].includes(activo) || !/^\d{1,7}$/.test(paginaTexto) || Number(paginaTexto) < 1) {
    return res.status(400).render('error', { titulo: 'Filtro no válido', mensaje: 'Revisa la búsqueda y vuelve a intentarlo.' });
  }
  const porPagina = 50;
  try {
    const conteo = await pool.query(`SELECT COUNT(*)::int AS total FROM usuarios u
      WHERE ($1='' OR u.nombre ILIKE '%' || $1 || '%' OR u.correo ILIKE '%' || $1 || '%')
      AND ($2='' OR u.rol::text=$2) AND ($3='' OR u.activo::text=$3)`, [buscar, rol, activo]);
    const total = conteo.rows[0].total;
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const pagina = Math.min(Number(paginaTexto), paginas);
    const { rows } = await pool.query(`SELECT u.id,u.nombre,u.correo,u.telefono,u.rol::text AS rol,u.activo,u.creado_en,
        COUNT(p.id)::int AS cantidad_pedidos
      FROM usuarios u LEFT JOIN pedidos p ON p.usuario_id=u.id
      WHERE ($1='' OR u.nombre ILIKE '%' || $1 || '%' OR u.correo ILIKE '%' || $1 || '%')
      AND ($2='' OR u.rol::text=$2) AND ($3='' OR u.activo::text=$3)
      GROUP BY u.id ORDER BY u.creado_en DESC,u.id DESC LIMIT $4 OFFSET $5`,
    [buscar, rol, activo, porPagina, (pagina - 1) * porPagina]);
    res.render('admin/usuarios', { usuarios: rows, buscar, rol, activo, pagina, paginas, total });
  } catch (e) { next(e); }
});

router.get('/usuarios/:id/editar', async (req, res, next) => {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).render('error', { titulo: 'Usuario no encontrado', mensaje: 'No encontramos esa cuenta.' });
  try {
    const { rows } = await pool.query(`SELECT id,nombre,correo,telefono,rol::text AS rol,activo
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
    const actual = await client.query('SELECT id,nombre,correo,telefono,rol::text AS rol,activo FROM usuarios WHERE id=$1 FOR UPDATE', [cuenta.id]);
    if (!actual.rowCount) {
      await client.query('ROLLBACK');
      req.session.mensaje = { tipo: 'error', texto: 'No encontramos esa cuenta.' };
      return res.redirect('/admin/usuarios');
    }
    const rolActual = actual.rows[0].rol;
    const esCuentaActual = String(req.session.usuario.id) === String(cuenta.id);
    if (esCuentaActual && rolActual !== cuenta.rol) throw new Error('No puedes cambiar tu propio rol. Otro administrador puede hacerlo.');
    if (actual.rows[0].activo && rolActual === 'admin' && cuenta.rol === 'cliente') {
      const admins = await client.query("SELECT id FROM usuarios WHERE rol::text='admin' AND activo=TRUE ORDER BY id FOR UPDATE");
      if (admins.rowCount <= 1) throw new Error('No se puede cambiar el rol del último administrador activo.');
    }
    const repetido = await client.query('SELECT 1 FROM usuarios WHERE LOWER(correo)=LOWER($1) AND id<>$2 LIMIT 1', [cuenta.correo, cuenta.id]);
    if (repetido.rowCount) throw new Error('Ya existe otra cuenta con ese correo.');
    await client.query('UPDATE usuarios SET nombre=$1,correo=$2,telefono=$3,rol=$4 WHERE id=$5', [cuenta.nombre, cuenta.correo, cuenta.telefono || null, cuenta.rol, cuenta.id]);
    const antes = actual.rows[0];
    const cambios = {};
    for (const campo of ['nombre', 'correo', 'telefono', 'rol']) if (String(antes[campo] || '') !== String(cuenta[campo] || '')) cambios[campo] = { antes: antes[campo] || null, despues: cuenta[campo] || null };
    await registrarAuditoria(client, { actorId: req.session.usuario.id, accion: 'usuario_actualizado', entidad: 'usuario', entidadId: cuenta.id, detalles: { cambios } });
    if (rolActual !== cuenta.rol) await client.query("DELETE FROM session WHERE sess->'usuario'->>'id'=$1", [cuenta.id]);
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

router.post('/usuarios/:id/estado', async (req, res, next) => {
  if (!/^\d{1,18}$/.test(req.params.id)) {
    req.session.mensaje = { tipo: 'error', texto: 'La cuenta indicada no es válida.' };
    return res.redirect('/admin/usuarios');
  }
  const id = String(req.params.id);
  if (String(req.session.usuario.id) === id) {
    req.session.mensaje = { tipo: 'error', texto: 'No puedes desactivar la cuenta con la que tienes iniciada esta sesión.' };
    return res.redirect('/admin/usuarios');
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const target = await client.query('SELECT id,nombre,rol::text AS rol,activo FROM usuarios WHERE id=$1 FOR UPDATE', [id]);
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      req.session.mensaje = { tipo: 'error', texto: 'No encontramos esa cuenta.' };
      return res.redirect('/admin/usuarios');
    }
    const nuevoActivo = String(req.body.activo || '') === 'true';
    if (String(req.body.activo || '') !== 'true' && String(req.body.activo || '') !== 'false') throw new Error('El estado de la cuenta no es válido.');
    if (target.rows[0].activo === nuevoActivo) {
      await client.query('ROLLBACK');
      req.session.mensaje = { tipo: 'info', texto: `La cuenta de ${target.rows[0].nombre} ya estaba ${nuevoActivo ? 'activa' : 'desactivada'}.` };
      return res.redirect('/admin/usuarios');
    }
    if (!nuevoActivo && target.rows[0].rol === 'admin' && target.rows[0].activo) {
      const admins = await client.query("SELECT id FROM usuarios WHERE rol::text='admin' AND activo=TRUE ORDER BY id FOR UPDATE");
      if (admins.rowCount <= 1) throw new Error('No se puede desactivar el último administrador activo.');
    }
    await client.query('UPDATE usuarios SET activo=$1 WHERE id=$2', [nuevoActivo, id]);
    if (!nuevoActivo) await client.query("DELETE FROM session WHERE sess->'usuario'->>'id'=$1", [id]);
    await registrarAuditoria(client, { actorId: req.session.usuario.id, accion: nuevoActivo ? 'usuario_activado' : 'usuario_desactivado', entidad: 'usuario', entidadId: id, detalles: { activo: nuevoActivo } });
    await client.query('COMMIT');
    req.session.mensaje = { tipo: 'exito', texto: `La cuenta de ${target.rows[0].nombre} quedó ${nuevoActivo ? 'activada' : 'desactivada'}.` };
    res.redirect('/admin/usuarios');
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    if (e.message.includes('último administrador') || e.message.includes('estado de la cuenta')) {
      req.session.mensaje = { tipo: 'error', texto: e.message };
      return res.redirect('/admin/usuarios');
    }
    next(e);
  } finally { client?.release(); }
});

router.get('/auditoria', async (req, res, next) => {
  const accion = String(req.query.accion || '').slice(0, 60);
  const desde = String(req.query.desde || '');
  const hasta = String(req.query.hasta || '');
  const paginaTexto = String(req.query.pagina || '1');
  const fechaValida = v => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v);
  if (!fechaValida(desde) || !fechaValida(hasta) || (desde && hasta && desde > hasta) || !/^\d{1,7}$/.test(paginaTexto) || Number(paginaTexto) < 1) {
    return res.status(400).render('error', { titulo: 'Filtro no válido', mensaje: 'Revisa las fechas e inténtalo de nuevo.' });
  }
  const porPagina = 50;
  try {
    const parametros = [accion, desde, hasta];
    const filtro = `WHERE ($1='' OR a.accion=$1)
      AND ($2='' OR a.creado_en >= ($2::date AT TIME ZONE 'America/Costa_Rica'))
      AND ($3='' OR a.creado_en < (($3::date + 1) AT TIME ZONE 'America/Costa_Rica'))`;
    const conteo = await pool.query(`SELECT COUNT(*)::int AS total FROM auditoria a ${filtro}`, parametros);
    const total = conteo.rows[0].total;
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const pagina = Math.min(Number(paginaTexto), paginas);
    const { rows } = await pool.query(`SELECT a.id,a.actor_nombre,COALESCE(a.actor_nombre,u.nombre,'Cuenta eliminada') AS actor,
        u.correo AS actor_correo,a.accion,a.entidad,a.entidad_id,a.detalles,a.creado_en
      FROM auditoria a LEFT JOIN usuarios u ON u.id=a.actor_usuario_id ${filtro}
      ORDER BY a.creado_en DESC,a.id DESC LIMIT $4 OFFSET $5`, [...parametros, porPagina, (pagina - 1) * porPagina]);
    const acciones = await pool.query('SELECT DISTINCT accion FROM auditoria ORDER BY accion');
    res.render('admin/auditoria', { registros: rows, accion, desde, hasta, pagina, paginas, total, acciones: acciones.rows.map(r => r.accion), etiquetasAuditoria: accionesAuditoria });
  } catch (e) { next(e); }
});

router.get('/pedidos', async (req, res, next) => {
  const estado = String(req.query.estado || '');
  const buscar = String(req.query.buscar || '').trim().slice(0, 120);
  const desde = String(req.query.desde || '');
  const hasta = String(req.query.hasta || '');
  const paginaTexto = String(req.query.pagina || '1');
  const permitidos = Object.keys(ETIQUETAS);
  const fechaValida = v => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v);
  if ((estado && !permitidos.includes(estado)) || !fechaValida(desde) || !fechaValida(hasta) || (desde && hasta && desde > hasta) || !/^\d{1,7}$/.test(paginaTexto) || Number(paginaTexto) < 1) {
    return res.status(400).render('error', { titulo: 'Filtro no válido', mensaje: 'Revisa el estado, las fechas y vuelve a intentarlo.' });
  }
  const porPagina = 50;
  try {
    const parametros = [estado, buscar, desde, hasta];
    const filtro = `WHERE ($1='' OR p.estado::text=$1)
      AND ($2='' OR u.nombre ILIKE '%' || $2 || '%' OR u.correo ILIKE '%' || $2 || '%')
      AND ($3='' OR p.creado_en >= ($3::date AT TIME ZONE 'America/Costa_Rica'))
      AND ($4='' OR p.creado_en < (($4::date + 1) AT TIME ZONE 'America/Costa_Rica'))`;
    const conteo = await pool.query(`SELECT COUNT(*)::int AS total FROM pedidos p JOIN usuarios u ON u.id=p.usuario_id ${filtro}`, parametros);
    const total = conteo.rows[0].total;
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const pagina = Math.min(Number(paginaTexto), paginas);
    const { rows } = await pool.query(`SELECT p.id,p.estado::text AS estado,p.total,p.creado_en,u.nombre AS cliente,u.correo
      FROM pedidos p JOIN usuarios u ON u.id=p.usuario_id
      ${filtro} ORDER BY p.creado_en DESC LIMIT $5 OFFSET $6`, [...parametros, porPagina, (pagina - 1) * porPagina]);
    res.render('admin/pedidos', { pedidos: rows, estado, buscar, desde, hasta, pagina, paginas, total });
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
    await registrarAuditoria(client, { actorId: req.session.usuario.id, accion: 'cotizacion_guardada', entidad: 'pedido', entidadId: pedido.id, detalles: { envio: aMonto(envioCents), comision: aMonto(comisionCents), total: aMonto(totalCents), articulos: artFinal.rows.map(a => ({ id: a.id, cantidad: a.cantidad, precio_unitario: a.precio_unitario, subtotal: a.subtotal })) } });
    await client.query('COMMIT');
    client.release();
    client = null;
    try {
      await enviarCotizacion({ cliente: pedido, pedido: upd.rows[0], articulos: artFinal.rows });
      try { await registrarAuditoria(pool, { actorId: req.session.usuario.id, accion: 'cotizacion_correo_enviado', entidad: 'pedido', entidadId: pedido.id }); }
      catch (auditError) { console.error('No se pudo registrar el envío de cotización:', auditError.message); }
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
    try { await registrarAuditoria(pool, { actorId: req.session.usuario.id, accion: 'cotizacion_correo_enviado', entidad: 'pedido', entidadId: datos.pedido.id, detalles: { reenviado: true } }); }
    catch (auditError) { console.error('No se pudo registrar el reenvío de cotización:', auditError.message); }
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
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const r = await client.query('UPDATE pedidos SET estado=$1,actualizado_en=NOW() WHERE id=$2 AND estado=$3 RETURNING id', [nuevo, req.params.id, anterior]);
    if (r.rowCount) await registrarAuditoria(client, { actorId: req.session.usuario.id, accion: 'pedido_estado_actualizado', entidad: 'pedido', entidadId: req.params.id, detalles: { estado_anterior: anterior, estado_nuevo: nuevo } });
    await client.query('COMMIT');
    req.session.mensaje = { tipo: r.rowCount ? 'exito' : 'error', texto: r.rowCount ? `El pedido pasó a ${ETIQUETAS[nuevo].toLowerCase()}.` : 'El estado actual del pedido no permite ese cambio.' };
    res.redirect(`/admin/pedidos/${encodeURIComponent(req.params.id)}`);
  } catch (e) { if (client) { try { await client.query('ROLLBACK'); } catch {} } next(e); }
  finally { client?.release(); }
});
module.exports = router;
