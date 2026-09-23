require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const crypto = require('crypto');
const pool = require('./db/pool');
const authRoutes = require('./src/routes/auth');
const clienteRoutes = require('./src/routes/cliente');
const adminRoutes = require('./src/routes/admin');
const { ETIQUETAS, dinero } = require('./src/services/pedidos');

if (!process.env.SESSION_SECRET) throw new Error('Configura SESSION_SECRET en el archivo .env.');
const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'form-action': ["'self'"] } } }));
app.use(express.urlencoded({ extended: false, limit: '30kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0 }));
app.use(session({
  name: 'temu.sid', secret: process.env.SESSION_SECRET,
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false, pruneSessionInterval: 15 }),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.usuario = req.session.usuario || null;
  res.locals.mensaje = req.session.mensaje || null;
  delete req.session.mensaje;
  res.locals.etiquetasEstado = ETIQUETAS;
  res.locals.dinero = (n) => dinero(n, process.env.CURRENCY_SYMBOL || '$');
  next();
});
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const token = String(req.body._csrf || '');
  const esperado = String(req.session.csrfToken || '');
  if (!token || token.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(esperado))) {
    return res.status(403).render('error', { titulo: 'Solicitud no válida', mensaje: 'Recarga la página e inténtalo otra vez.' });
  }
  next();
});
app.get('/', (req, res) => res.redirect(req.session.usuario ? (req.session.usuario.rol === 'admin' ? '/admin/pedidos' : '/cliente/pedidos') : '/login'));
app.use('/', authRoutes);
app.use('/cliente', clienteRoutes);
app.use('/admin', adminRoutes);
app.use((req, res) => res.status(404).render('error', { titulo: 'Página no encontrada', mensaje: 'No encontramos la página que buscas.' }));
app.use((err, req, res, next) => {
  console.error('Error de aplicación:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { titulo: 'Ocurrió un problema', mensaje: 'No pudimos completar tu solicitud. Inténtalo de nuevo.' });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Pedidos Temu disponible en http://localhost:${port}`));
}
module.exports = app;
