# Pedidos Temu

Aplicación en español para registrar pedidos de clientes, cotizarlos y enviar el desglose por correo. Usa Node.js 20+, Express, EJS, PostgreSQL/Neon y Gmail SMTP. Vercel detecta `server.js` como punto de entrada de Express; la misma app también puede ejecutarse localmente.

## 1. Crear la base de datos en Neon

1. Crea una cuenta en [Neon](https://neon.tech/) y crea un proyecto PostgreSQL.
2. En el panel del proyecto, copia la cadena de conexión **pooled** (host con `-pooler` si Neon lo muestra). Se usará como `DATABASE_URL`; conserva `sslmode=require`.
3. Abre el SQL Editor de Neon, copia el contenido completo de [`db/schema.sql`](db/schema.sql) y ejecútalo una vez. Crea las tablas `usuarios`, `pedidos`, `articulos` y `session`, además de sus índices.

## 2. Preparar Gmail

Activa la verificación en dos pasos de la cuenta Gmail que enviará los mensajes y crea una contraseña de aplicación desde la configuración de seguridad de Google. Google muestra una clave de aplicación; se guarda sin espacios como `GMAIL_APP_PASSWORD`. No uses la contraseña normal de Gmail.

## 3. Configurar y ejecutar localmente

1. Copia `.env.example` a `.env`.
2. Completa `DATABASE_URL`, `SESSION_SECRET`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` y el símbolo deseado en `CURRENCY_SYMBOL`. Usa una cadena aleatoria larga para `SESSION_SECRET`. En local, `BASE_URL=http://localhost:3000`.
3. Instala Node.js 20 o posterior.
4. Desde la carpeta del proyecto ejecuta:

   ```bash
   npm install
   npm run dev
   ```

5. Abre [http://localhost:3000](http://localhost:3000). Para arrancar sin recarga automática usa `npm start`.

## 4. Crear la cuenta administradora

Con la aplicación configurada y las tablas creadas, ejecuta `npm run crear-admin`. El asistente pide nombre, correo y contraseña (mínimo 12 caracteres). El rol admin solo se asigna con este comando; el registro web siempre crea clientes.

## 5. Probar el flujo completo

1. Registra un cliente desde `/registro` e inicia sesión.
2. Crea un pedido en **Nuevo pedido**, agrega uno o más enlaces válidos de Temu y envíalo.
3. Cierra sesión e inicia como admin; abre el pedido desde `/admin/pedidos`.
4. Asigna precio unitario a cada producto y, si corresponde, envío y comisión. Guarda la cotización.
5. Confirma que el cliente recibe el correo con sus artículos, subtotales y total; si hay un fallo de Gmail, la cotización queda guardada y puedes usar **Reenviar correo de cotización**.
6. Vuelve al cliente, abre el pedido y acepta o rechaza la cotización. Si acepta, el admin puede marcarlo comprado y luego entregado.

## 6. Desplegar en Vercel

1. Sube este proyecto a un repositorio Git e impórtalo desde Vercel. No requiere comando de build; Vercel detecta la app Express exportada desde `server.js` y sirve los recursos de `public/` como archivos estáticos.
2. En **Settings → Environment Variables**, agrega estas variables al entorno de producción:
   - `NODE_ENV=production`
   - `DATABASE_URL` (cadena pooled de Neon con `sslmode=require`)
   - `SESSION_SECRET` (secreto aleatorio largo y único)
   - `BASE_URL=https://tu-dominio.vercel.app` (usa tu dominio final, sin `/` al final)
   - `GMAIL_USER`, `GMAIL_APP_PASSWORD` y `CURRENCY_SYMBOL`
3. Ejecuta el contenido de `db/schema.sql` en Neon si aún no lo hiciste y crea el administrador con `npm run crear-admin`, usando el mismo `.env`/`DATABASE_URL` de producción. No hagas el registro admin desde la web.
4. Despliega y abre el dominio asignado. En dominios propios, configura el dominio en Vercel y actualiza `BASE_URL` al dominio HTTPS definitivo.

Las sesiones se almacenan en PostgreSQL, por lo que sobreviven entre invocaciones de las funciones. La aplicación reutiliza el pool de conexiones de Neon y está configurada con un máximo de cinco conexiones por instancia. El entorno gratuito de Vercel tiene límites de duración y recursos; el envío SMTP depende de que Gmail permita la conexión desde el entorno desplegado.

## Variables de entorno

Consulta `.env.example`. Nunca publiques `.env`, contraseñas de aplicación ni secretos en Git.

## Suposiciones y mejoras futuras

- El script SQL no venía incluido en el texto recibido: `db/schema.sql` se creó desde cero siguiendo los nombres de tablas, columnas y estados especificados.
- `subtotal` se calcula en PostgreSQL como columna generada; antes de una cotización, el precio unitario y el subtotal permanecen sin definir.
- Se admite cualquier URL HTTP o HTTPS introducida por el cliente, tal como indica la validación del requisito; el administrador puede abrir cada enlace para revisar el producto.
- Futuras mejoras posibles: pagos en línea, notificaciones por WhatsApp y reportes. No están implementadas.
