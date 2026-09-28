-- Ejecutar una sola vez en Neon antes de desplegar la versión con aceptación de privacidad.
-- Es idempotente y se puede volver a ejecutar sin afectar los datos existentes.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS privacidad_aceptada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS privacidad_version VARCHAR(20);
