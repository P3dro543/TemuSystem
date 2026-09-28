-- Ejecutar una sola vez en el SQL Editor de Neon, después del esquema base.
BEGIN;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS recuperaciones_contrasena (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS recuperaciones_usuario_idx ON recuperaciones_contrasena(usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS recuperaciones_expira_idx ON recuperaciones_contrasena(expira_en);

CREATE TABLE IF NOT EXISTS auditoria (
  id BIGSERIAL PRIMARY KEY,
  actor_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  actor_nombre VARCHAR(100),
  accion VARCHAR(60) NOT NULL,
  entidad VARCHAR(40) NOT NULL,
  entidad_id VARCHAR(80),
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auditoria_fecha_idx ON auditoria(creado_en DESC);
CREATE INDEX IF NOT EXISTS auditoria_actor_fecha_idx ON auditoria(actor_usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS auditoria_entidad_idx ON auditoria(entidad, entidad_id);

COMMIT;
