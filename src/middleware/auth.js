function requiereLogin(req, res, next) {
  if (!req.session.usuario) {
    req.session.mensaje = { tipo: 'error', texto: 'Inicia sesión para continuar.' };
    return res.redirect('/login');
  }
  next();
}
function soloAdmin(req, res, next) {
  if (req.session.usuario?.rol !== 'admin') return res.status(403).render('error', { titulo: 'Acceso denegado', mensaje: 'No tienes permiso para ver esta página.' });
  next();
}
function soloCliente(req, res, next) {
  if (req.session.usuario?.rol !== 'cliente') return res.status(403).render('error', { titulo: 'Acceso denegado', mensaje: 'No tienes permiso para ver esta página.' });
  next();
}
module.exports = { requiereLogin, soloAdmin, soloCliente };
