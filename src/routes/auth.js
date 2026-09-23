const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const pool = require('../../db/pool');
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
  if (nombre.length < 2 || nombre.length > 120) error = 'El nombre debe tener entre 2 y 120 caracteres.';
  else if (!correoValido(correo)) error = 'Ingresa un correo válido.';
  else if (telefono.length > 40) error = 'El teléfono debe tener 40 caracteres o menos.';
  else if (pass.length < 8 || pass.length > 72) error = 'La contraseña debe tener entre 8 y 72 caracteres.';
  else if (pass !== confirmar) error = 'Las contraseñas no coinciden.';
  if (error) return res.status(400).render('registro', { error, valores });
  try {
    const hash = await bcrypt.hash(pass, 12);
    await pool.query('INSERT INTO usuarios (nombre, correo, telefono, contrasena_hash, rol) VALUES ($1,$2,$3,$4,$5)', [nombre, correo, telefono || null, hash, 'cliente']);
    req.session.mensaje = { tipo: 'exito', texto: 'Tu cuenta está lista. Inicia sesión.' };
    res.redirect('/login');
  } catch (err) {
    if (err.code === '23505') return res.status(400).render('registro', { error: 'Ya existe una cuenta con ese correo.', valores });
    next(err);
  }
});
router.get('/login', (req, res) => res.render('login', { error: null }));
router.post('/login', limiteAuth, async (req, res, next) => {
  const correo = String(req.body.correo || '').trim().toLowerCase();
  const pass = String(req.body.contrasena || '');
  try {
    const { rows } = await pool.query('SELECT id, nombre, correo, telefono, contrasena_hash, rol FROM usuarios WHERE LOWER(correo) = LOWER($1) LIMIT 1', [correo]);
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
router.post('/logout', (req, res, next) => req.session.destroy(err => {
  if (err) return next(err);
  res.clearCookie('temu.sid');
  res.redirect('/login');
}));
module.exports = router;
