async function registrarAuditoria(db, { actorId = null, accion, entidad, entidadId = null, detalles = {} }) {
  await db.query(`INSERT INTO auditoria
    (actor_usuario_id, actor_nombre, accion, entidad, entidad_id, detalles)
    VALUES ($1, (SELECT nombre FROM usuarios WHERE id=$1), $2, $3, $4, $5::jsonb)`,
  [actorId, accion, entidad, entidadId == null ? null : String(entidadId), JSON.stringify(detalles)]);
}

module.exports = { registrarAuditoria };
