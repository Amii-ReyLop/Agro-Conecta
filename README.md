# Agro-Conecta — Fase 2: Security by Design

## Medidas incorporadas

1. **Hash de contraseñas:** bcrypt con factor de trabajo 12.
2. **Validación de entradas:** express-validator en registro e inicio de sesión, más validaciones de negocio existentes en rutas de productos, pedidos, perfil y reseñas.
3. **Consultas seguras:** Mongoose construye consultas mediante objetos y los identificadores se validan; no se construyen sentencias SQL concatenando texto. La protección contra NoSQL injection debe verificarse con pruebas.
4. **CSRF:** csurf mediante cookie de secreto y encabezado `X-CSRF-Token` en operaciones POST, PUT, PATCH y DELETE.
5. **Cabeceras HTTP:** Helmet con CSP, X-Content-Type-Options, X-Frame-Options y otras cabeceras. HSTS se activa cuando `NODE_ENV=production` y la aplicación se sirve por HTTPS.
6. **RBAC:** middleware de autenticación y autorización por roles; el registro público no permite crear administradores.
7. **Cookie de sesión:** JWT en cookie `HttpOnly` y `SameSite=Strict`; `Secure` se activa en producción HTTPS.
8. **Rate limiting:** máximo cinco intentos fallidos por IP en una ventana de quince minutos en `/api/auth/login`.

## Instalación

1. Abre una terminal dentro de `Backend`.
2. Ejecuta `npm install`.
3. Copia `.env.example` como `.env`.
4. Configura `MONGO_URI` y genera `JWT_SECRET` con:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. En desarrollo local usa `NODE_ENV=development`.
6. Ejecuta `npm start` y abre `http://localhost:3000`.

No abras el frontend con Live Server en otro origen para la demostración inicial; usa el mismo servidor Express en `http://localhost:3000`. Si se despliega en otro dominio, configura `CORS_ORIGIN` con el origen exacto y utiliza HTTPS.

## Pruebas de demostración

- `curl -I http://localhost:3000` — revisar cabeceras (HSTS solo aparecerá en producción HTTPS).
- `curl -i http://localhost:3000/api/health` — comprobar disponibilidad de API.
- Iniciar sesión y revisar DevTools → Application → Cookies: `agroconecta_session` debe mostrar HttpOnly y SameSite=Strict. En producción HTTPS también Secure.
- Enviar seis intentos de inicio de sesión fallidos desde la misma IP dentro de quince minutos: el sexto debe recibir HTTP 429.
- Intentar un POST sin `X-CSRF-Token`: debe recibir HTTP 403.
- Iniciar sesión como comprador y solicitar una ruta exclusiva de administrador: debe recibir HTTP 403.
- Registrar una cuenta y revisar MongoDB: `passwordHash` debe contener un hash bcrypt, nunca la contraseña original.

## Limitaciones y notas

- `Secure` no puede probarse correctamente en HTTP local; debe demostrarse en un despliegue HTTPS.
- El proyecto usa MongoDB/Mongoose, no SQL. Por eso el control equivalente es impedir operadores/objetos no confiables en filtros y mantener consultas construidas por el servidor; no se debe afirmar que se ejecutó una prueba SQLi contra una base de datos SQL.
- `csurf` está obsoleto en su mantenimiento upstream; se conserva aquí porque la guía de la asignatura lo solicita expresamente. Para producción se recomienda migrar a una alternativa CSRF mantenida tras validar compatibilidad.
- La implementación debe someterse a pruebas funcionales y de seguridad antes de considerarse aprobada.

## Mejoras funcionales adicionales

- **Foto de perfil:** el usuario autenticado puede subir o reemplazar su fotografía desde Mi Perfil. El backend limita la subida a un archivo de hasta 5 MB y admite JPG, PNG, WEBP y GIF. La ruta es `POST /api/users/me/photo` y utiliza la sesión autenticada y la protección CSRF existente.
- **Historial de compras:** el comprador consulta sus pedidos en el apartado de pedidos/historial, usando `GET /api/orders/mine`. Se muestran fecha, productos, dirección, método de pago, total y estado. No se crea un registro duplicado: se aprovecha el historial persistido en MongoDB.
- **Administrador:** el proyecto incluye `Backend/createAdmin.js`. Desde la carpeta Backend se puede crear o promover una cuenta con `node createAdmin.js correo@dominio.com "Nombre del administrador" "UnaClaveLargaYUnica"`. La contraseña se almacena con bcrypt (12 rondas). No publicar ni compartir la contraseña; se recomienda una clave larga y exclusiva. El script actualiza la cuenta si el correo ya existe.
- **Métodos de pago disponibles para registrar en el pedido:** tarjeta, PSE, Efecty, pago contra entrega, Nequi, Daviplata, transferencia bancaria y efectivo presencial. Estas opciones registran la preferencia del comprador; no procesan cobros ni conectan con pasarelas bancarias. Para recibir pagos reales se requiere integrar y probar el proveedor correspondiente.
