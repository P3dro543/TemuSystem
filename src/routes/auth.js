const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const pool = require('../../db/pool');
const { requiereLogin } = require('../middleware/auth');
const { registrarAuditoria } = require('../services/auditoria');
const { enviarRestablecimiento } = require('../services/correo');
const router = express.Router();
const limiteAuth = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' });
const correoValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

router.get('/registro', (req, res) => res.render('registro', { error: null, valores: {} }));
router.post('/registro', limiteAuth, async (req, res, next) => {
  const nombre = String(req.body.nombre || '').trim();
  const correo = String(req.body.correo || '').trim().toLowerCase();
  const telefono = String(req.body.telefono || '').trim();
  const pass = String(req.body.contrasena || '');
  const confirmar = String(req.body.confirmar || '');
  const valores = { nombre, correo, telefono };
  let error;
  if (nombre.length < 2 || nombre.length > 100) error = 'El nombre debe tener entre 2 y 100 caracteres.';
  else if (!correoValido(correo)) error = 'Ingresa un correo válido.';
  else if (telefono.length > 30) error = 'El teléfono debe tener 30 caracteres o menos.';
  else if (pass.length < 8 || pass.length > 72) error = 'La contraseña debe tener entre 8 y 72 caracteres.';
  else if (pass !== confirmar) error = 'Las contraseñas no coinciden.';
  if (error) return res.status(400).render('registro', { error, valores });
  let client;
  try {
    const hash = await bcrypt.hash(pass, 12);
    client = await pool.connect();
    await client.query('BEGIN');
    const insertado = await client.query('INSERT INTO usuarios (nombre, correo, telefono, contrasena_hash, rol) VALUES ($1,$2,$3,$4,$5) RETURNING id', [nombre, correo, telefono || null, hash, 'cliente']);
    await registrarAuditoria(client, { actorId: insertado.rows[0].id, accion: 'registro', entidad: 'usuario', entidadId: insertado.rows[0].id });
    await client.query('COMMIT');
    req.session.mensaje = { tipo: 'exito', texto: 'Tu cuenta está lista. Inicia sesión.' };
    res.redirect('/login');
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    if (err.code === '23505') return res.status(400).render('registro', { error: 'Ya existe una cuenta con ese correo.', valores });
    next(err);
  } finally { client?.release(); }
});
router.get('/login', (req, res) => res.render('login', { error: null }));
router.post('/login', limiteAuth, async (req, res, next) => {
  const correo = String(req.body.correo || '').trim().toLowerCase();
  const pass = String(req.body.contrasena || '');
  try {
    const { rows } = await pool.query('SELECT id, nombre, correo, telefono, contrasena_hash, rol FROM usuarios WHERE LOWER(correo) = LOWER($1) AND activo=TRUE LIMIT 1', [correo]);
    const user = rows[0];
    // La comparación también se ejecuta para un correo inexistente para reducir diferencias de tiempo.
    const hash = user?.contrasena_hash || '$2b$12$C6UzMDM.H6dfI/f/IKcEe.4o8LjIP0sJpC8QKKb1DKHq5rHYZvtKC';
    const ok = await bcrypt.compare(pass.slice(0, 72), hash);
    if (!user || !ok) return res.status(401).render('login', { error: 'Correo o contraseña incorrectos.' });
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.usuario = { id: user.id, nombre: user.nombre, correo: user.correo, telefono: user.telefono, rol: user.rol };
    res.redirect(user.rol === 'admin' ? '/admin/pedidos' : '/cliente/pedidos');
  } catch (err) { next(err); }
});

const mensajeRecuperacion = 'Si el correo corresponde a una cuenta activa, recibirás un enlace para restablecer tu contraseña.';
router.get('/recuperar-contrasena', (req, res) => res.render('recuperar-contrasena', { error: null }));
router.post('/recuperar-contrasena', limiteAuth, async (req, res, next) => {
  const correo = String(req.body.correo || '').trim().toLowerCase();
  try {
    if (correoValido(correo)) {
      const result = await pool.query('SELECT id,nombre,correo FROM usuarios WHERE LOWER(correo)=LOWER($1) AND activo=TRUE LIMIT 1', [correo]);
      const usuario = result.rows[0];
      if (usuario) {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('UPDATE recuperaciones_contrasena SET usado_en=NOW() WHERE usuario_id=$1 AND usado_en IS NULL', [usuario.id]);
          await client.query('INSERT INTO recuperaciones_contrasena (usuario_id,token_hash,expira_en) VALUES ($1,$2,NOW()+INTERVAL \'30 minutes\')', [usuario.id, tokenHash]);
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
        finally { client.release(); }
        try { await enviarRestablecimiento({ usuario, token }); }
        catch (e) { console.error('No se pudo enviar correo de recuperación:', e.message); }
      }
    }
    req.session.mensaje = { tipo: 'info', texto: mensajeRecuperacion };
    res.redirect('/login');
  } catch (e) { next(e); }
});

router.get('/restablecer-contrasena/:token', async (req, res, next) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).render('error', { titulo: 'Enlace no válido', mensaje: 'Solicita un enlace nuevo para cambiar tu contraseña.' });
  try {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const r = await pool.query(`SELECT r.id FROM recuperaciones_contrasena r JOIN usuarios u ON u.id=r.usuario_id
      WHERE r.token_hash=$1 AND r.usado_en IS NULL AND r.expira_en>NOW() AND u.activo=TRUE LIMIT 1`, [hash]);
    if (!r.rowCount) return res.status(400).render('error', { titulo: 'Enlace vencido', mensaje: 'Este enlace ya se usó o venció. Solicita uno nuevo para cambiar tu contraseña.' });
    res.render('restablecer-contrasena', { token, error: null });
  } catch (e) { next(e); }
});

router.post('/restablecer-contrasena/:token', limiteAuth, async (req, res, next) => {
  const token = String(req.params.token || '');
  const nueva = String(req.body.contrasena || '');
  const confirmar = String(req.body.confirmar || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).render('error', { titulo: 'Enlace no válido', mensaje: 'Solicita un enlace nuevo para cambiar tu contraseña.' });
  let error = nueva.length < 8 || nueva.length > 72 ? 'La contraseña debe tener entre 8 y 72 caracteres.' : nueva !== confirmar ? 'Las contraseñas no coinciden.' : null;
  if (error) return res.status(400).render('restablecer-contrasena', { token, error });
  let client;
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const nuevaHash = await bcrypt.hash(nueva, 12);
    client = await pool.connect();
    await client.query('BEGIN');
    const recuperacion = await client.query(`SELECT r.id,r.usuario_id FROM recuperaciones_contrasena r
      JOIN usuarios u ON u.id=r.usuario_id
      WHERE r.token_hash=$1 AND r.usado_en IS NULL AND r.expira_en>NOW() AND u.activo=TRUE
      FOR UPDATE OF r,u`, [tokenHash]);
    if (!recuperacion.rowCount) throw new Error('El enlace ya se usó o venció. Solicita uno nuevo.');
    const usuarioId = recuperacion.rows[0].usuario_id;
    await client.query('UPDATE usuarios SET contrasena_hash=$1 WHERE id=$2', [nuevaHash, usuarioId]);
    await client.query('UPDATE recuperaciones_contrasena SET usado_en=NOW() WHERE usuario_id=$1 AND usado_en IS NULL', [usuarioId]);
    await client.query("DELETE FROM session WHERE sess->'usuario'->>'id'=$1", [String(usuarioId)]);
    await registrarAuditoria(client, { actorId: usuarioId, accion: 'contrasena_restablecida', entidad: 'usuario', entidadId: usuarioId });
    await client.query('COMMIT');
    await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
    req.session.mensaje = { tipo: 'exito', texto: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
    res.redirect('/login');
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    if (e.message.includes('enlace ya se usó')) return res.status(400).render('restablecer-contrasena', { token, error: e.message });
    next(e);
  } finally { client?.release(); }
});

router.get('/cuenta/contrasena', requiereLogin, (req, res) => res.render('cambiar-contrasena', { error: null }));
router.post('/cuenta/contrasena', requiereLogin, limiteAuth, async (req, res, next) => {
  const actualPass = String(req.body.contrasena_actual || '');
  const nueva = String(req.body.contrasena || '');
  const confirmar = String(req.body.confirmar || '');
  let error = nueva.length < 8 || nueva.length > 72 ? 'La contraseña nueva debe tener entre 8 y 72 caracteres.' : nueva !== confirmar ? 'Las contraseñas nuevas no coinciden.' : null;
  if (error) return res.status(400).render('cambiar-contrasena', { error });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const r = await client.query('SELECT contrasena_hash FROM usuarios WHERE id=$1 AND activo=TRUE FOR UPDATE', [req.session.usuario.id]);
    if (!r.rowCount || !await bcrypt.compare(actualPass.slice(0, 72), r.rows[0].contrasena_hash)) {
      await client.query('ROLLBACK');
      return res.status(400).render('cambiar-contrasena', { error: 'La contraseña actual es incorrecta.' });
    }
    const hash = await bcrypt.hash(nueva, 12);
    await client.query('UPDATE usuarios SET contrasena_hash=$1 WHERE id=$2', [hash, req.session.usuario.id]);
    await client.query("DELETE FROM session WHERE sess->'usuario'->>'id'=$1 AND sid<>$2", [String(req.session.usuario.id), req.sessionID]);
    await client.query('UPDATE recuperaciones_contrasena SET usado_en=NOW() WHERE usuario_id=$1 AND usado_en IS NULL', [req.session.usuario.id]);
    await registrarAuditoria(client, { actorId: req.session.usuario.id, accion: 'contrasena_cambiada', entidad: 'usuario', entidadId: req.session.usuario.id });
    await client.query('COMMIT');
    req.session.mensaje = { tipo: 'exito', texto: 'Tu contraseña se cambió correctamente.' };
    res.redirect(req.session.usuario.rol === 'admin' ? '/admin/pedidos' : '/cliente/pedidos');
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    next(e);
  } finally { client?.release(); }
});

router.post('/logout', (req, res, next) => req.session.destroy(err => {
  if (err) return next(err);
  res.clearCookie('temu.sid');
  res.redirect('/login');
}));
module.exports = router;
