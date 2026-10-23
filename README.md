# Barbogasto

Aplicación web móvil para compartir los gastos de un único grupo. Cada gasto se reparte a partes iguales o por productos, y los saldos se calculan siempre a partir de los gastos y de los pagos anotados.

## Qué está implementado

- Cuenta con email y contraseña, sesión en cookie y una única comunidad, Barbogastos: quien se registra entra en ella directamente.
- Invitaciones de un solo uso, válidas 7 días.
- Gastos manuales y lectura de tickets con Gemini. La foto no se guarda.
- Reparto a partes iguales o por líneas, con impuestos proporcionales o manuales.
- Saldos en céntimos, transferencias sugeridas y pagos reales.
- Editar o borrar un gasto pide confirmación si ya hay pagos de esas personas. Los pagos no se borran y los saldos se recalculan.
- PWA instalable, en español y con euros.
- Recordatorio el último día del mes, dentro de la app y por Web Push si la persona lo activa.

## Arquitectura

El frontend (React, TypeScript, Vite) y la API (Pages Functions) viven en este repositorio y se despliegan juntos en Cloudflare Pages. La base de datos es D1.

Pages Functions no puede ejecutar Cron Triggers. El recordatorio push usa un Worker mínimo, `barbogasto-reminder`, con la misma base D1. Se despierta a las 07:00 UTC los días 28 a 31 y solo envía si, en la zona del grupo (Europa/Madrid por defecto), ese día es el último del mes. No hace falta ningún otro servicio.

## Ejecutar en local

Hacen falta Node 22 o superior y dos terminales.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev:api
```

En otra terminal:

```bash
npm run dev
```

Abre http://127.0.0.1:5173. La API local escucha en el puerto 8788 y Vite le reenvía `/api`.

La primera cuenta crea la comunidad. Las siguientes se unen a ella al registrarse, sin invitación: ven todos los gastos ya apuntados y pueden añadir los suyos. Los enlaces de invitación de Ajustes siguen funcionando, pero ya no hacen falta.

## Variables y secretos

| Nombre | Dónde | Uso |
| --- | --- | --- |
| `GEMINI_API_KEY` | Secreto de Pages | Lectura de tickets. Si falta, el alta manual sigue funcionando. |
| `GEMINI_MODEL` | Variable, por defecto `gemini-3.5-flash-lite` | Modelo de visión. Tiene cuota gratuita en el plan Free de Gemini; las imágenes cuentan como tokens de entrada. |
| `VAPID_PUBLIC_KEY` | Variable de Pages y del Worker | Clave pública Web Push. |
| `VAPID_PRIVATE_KEY` | Secreto de Pages y del Worker | Clave privada Web Push. |
| `VAPID_SUBJECT` | Variable, un `mailto:` | Contacto exigido por el protocolo push. |
| `CRON_SECRET` | Secreto de Pages y del Worker | Protege el disparo manual del recordatorio. |

Genera el par VAPID con `npm run vapid` y copia los valores en `.dev.vars` para local. No subas `.dev.vars`.

En producción:

```bash
npx wrangler pages secret put GEMINI_API_KEY
npx wrangler pages secret put VAPID_PUBLIC_KEY
npx wrangler pages secret put VAPID_PRIVATE_KEY
npx wrangler pages secret put CRON_SECRET
npx wrangler secret put VAPID_PUBLIC_KEY -c cron/wrangler.toml
npx wrangler secret put VAPID_PRIVATE_KEY -c cron/wrangler.toml
npx wrangler secret put CRON_SECRET -c cron/wrangler.toml
```

`VAPID_SUBJECT` y `GEMINI_MODEL` están en `wrangler.toml`. Cámbialos antes de desplegar.

## Base de datos

```bash
npx wrangler d1 create barbogasto
```

Copia el `database_id` en `wrangler.toml` y en `cron/wrangler.toml`.

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

Las migraciones están en `migrations/`. Los importes son céntimos enteros. No hay columnas para fotografías.

## Despliegue

Cada push a `main` en GitHub ejecuta `.github/workflows/deploy.yml`: pruebas, base D1, Pages y el Worker del recordatorio. La primera vez, si el `database_id` sigue siendo el de ceros, el flujo crea la base en Europa occidental y guarda el identificador en el repositorio.

En el repositorio de GitHub, en Settings → Secrets and variables → Actions, crea:

| Secreto | Obligatorio | Uso |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Sí | Token con permiso de edición en Workers, Pages y D1. |
| `CLOUDFLARE_ACCOUNT_ID` | Sí | Identificador de la cuenta, visible en el panel de Cloudflare. |
| `GEMINI_API_KEY` | No | Lectura de tickets. |
| `VAPID_PUBLIC_KEY` | No | Push. Se genera con `npm run vapid`. |
| `VAPID_PRIVATE_KEY` | No | Push. |
| `CRON_SECRET` | No | Disparo manual del recordatorio. |

Cambia `VAPID_SUBJECT` en los dos `wrangler.toml` por un `mailto:` real antes del primer push que quieras publicar.

Para publicar a mano, sin GitHub:

```bash
npm test
npm run deploy
npm run deploy:cron
```

`npm run deploy` construye el frontend y publica Pages. `npm run deploy:cron` publica el Worker del recordatorio. Las Functions se toman de `functions/`.

Para probar el recordatorio sin esperar a fin de mes:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/internal/monthly-reminder?force=1
```

`force=1` ignora el día, pero no vuelve a enviar a quien ya tiene un envío correcto ese mes.

## Servicios externos

- **Gemini**, en [Google AI Studio](https://aistudio.google.com/apikey). El modelo por defecto es `gemini-3.5-flash-lite`, económico y con entrada de imagen. En la cuota gratuita Google puede usar el contenido para mejorar sus productos. En la de pago no lo usa para entrenar, pero registra peticiones y respuestas hasta 55 días por seguridad. La foto se manda con `generateContent`, no con la File API, y no se guarda en Barbogasto.
- **Web Push** del navegador. En iPhone hace falta iOS 16.4 o posterior, añadir la app a la pantalla de inicio y conceder el permiso.

## Cálculo del dinero

El saldo de una persona es lo que ha pagado en gastos, menos su parte, más los pagos reales que ha hecho, menos los que ha recibido. Un saldo positivo significa que debe recibir dinero.

Los céntimos que sobran al dividir se asignan, en orden de identificador, a las primeras personas. La misma regla se usa en el reparto proporcional. Las transferencias sugeridas liquidan esos saldos y no crean ni destruyen dinero. Una sugerencia no es un pago: el pago solo existe cuando alguien lo anota.

## Límites conocidos

- Un solo grupo y una sola moneda, el euro. Un ticket en otra moneda hay que pasarlo a euros a mano.
- La contraseña usa 12.000 iteraciones de PBKDF2 para caber en los 10 ms de CPU del plan gratuito de Workers. Conviene una contraseña larga. En el plan de pago se puede subir esa constante.
- El plan gratuito también limita el recordatorio push. Un grupo pequeño suele entrar; si Cloudflare corta la invocación, el aviso de dentro de la app sigue funcionando.
- Hay como máximo 30 lecturas de ticket por persona y día, y 150 por grupo.
- Las imágenes HEIC que el navegador no pueda recomprimir se envían tal cual si pesan menos de 4 MB.
- No hay modo oscuro ni varias monedas.
