CREATE TABLE IF NOT EXISTS usuarios (
  id BIGSERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(254) NOT NULL,
  telefono VARCHAR(40),
  contrasena_hash TEXT NOT NULL,
  rol VARCHAR(10) NOT NULL CHECK (rol IN ('admin', 'cliente')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_lower_unique ON usuarios (LOWER(correo));

CREATE TABLE IF NOT EXISTS pedidos (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
  estado VARCHAR(12) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'cotizado', 'aceptado', 'rechazado', 'comprado', 'entregado')),
  envio NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (envio >= 0),
  comision NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (comision >= 0),
  total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cotizado_en TIMESTAMPTZ,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pedidos_usuario_creado_idx ON pedidos(usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS pedidos_estado_creado_idx ON pedidos(estado, creado_en DESC);

CREATE TABLE IF NOT EXISTS articulos (
  id BIGSERIAL PRIMARY KEY,
  pedido_id BIGINT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  link TEXT NOT NULL,
  nota VARCHAR(500),
  cantidad INTEGER NOT NULL CHECK (cantidad >= 1),
  precio_unitario NUMERIC(12,2) CHECK (precio_unitario IS NULL OR precio_unitario >= 0),
  subtotal NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);
CREATE INDEX IF NOT EXISTS articulos_pedido_idx ON articulos(pedido_id);

-- Tabla requerida por connect-pg-simple / express-session.
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session(expire);
