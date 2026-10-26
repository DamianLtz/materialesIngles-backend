# Migración de datos a producción (MySQL → Postgres)

Paso único para llevar los datos del sistema original (Laravel, MySQL) a la base de esta app (Postgres).
Se hace **una sola vez**, el día del pase a producción.

> **El dump definitivo ya existe:** el sistema original está apagado (se dio de baja de forma preventiva) y nadie puede
> cargar datos nuevos, así que el dump tomado el **23/10/2026** tiene todo. Guardarlo en un lugar seguro, fuera de los
> repos (hoy está en `materialesInglesv2/datos/leer_para_crecer.sql`), y **saltear los pasos 1 y 2**: empezar en el paso 3.
> Solo hace falta un dump nuevo si el sistema viejo vuelve a estar en uso antes del pase.

El script es `src/migracion-datos/` (`transformar.ts` tiene las reglas, `migrar.ts` hace la carga).
Fue probado el 23/10/2026 con el dump real de ese día: ver "Resultado de referencia" al final.

---

## Qué hace y qué no

- Copia escuelas, etapas, ofertas, asignaciones de escuelas a etapas, pedidos, reclamos, tipos de reclamo, libros, catálogos, grados y usuarios.
  Conserva los **ids**, los **timestamps** (el original guardaba en UTC) y los **borrados lógicos**.
- Todo va en **una transacción**: si algo falla, la base destino queda como estaba.
- **Se niega a correr si el destino tiene datos** en cualquiera de esas tablas. Nunca mezcla.
- Al terminar reajusta las secuencias de ids y controla, tabla por tabla, que lo cargado coincida con lo esperado. Si no coincide, deshace todo.
- `--simular` hace todo y al final deshace: sirve para ver el reporte sin escribir nada.

**No se migran:** `claims_backup` (copia manual vieja; todas sus filas están en `claims`), las tablas propias de Laravel
(`sessions`, `migrations`, `password_resets`, `failed_jobs`, `personal_access_tokens`) ni las de permisos (de esas solo se lee el rol de cada usuario).

### Reglas de traducción (acordadas el 23/10/2026)

| Tema | Regla |
|---|---|
| Roles | `Super Admin` → `super_admin`, `Admin` → `admin`, `Usuario` → `operador`. Un usuario **vigente** sin rol o con un rol desconocido **frena** la migración. |
| Pedidos repetidos | Si una escuela tiene más de un pedido vigente para la misma oferta, queda el de **id menor** y el resto se borra lógicamente con la fecha de la migración. |
| Cantidad máxima de ofertas | La **mayor entre 100 y lo más alto pedido** en esa oferta (el original la dejaba en 1 sin controlarla). |
| Etapas borradas | Sus ofertas y pedidos que seguían vigentes se borran con la fecha de la etapa, y los reclamos vigentes de esos pedidos también. |
| Historial | Pedidos con libro borrado, reclamos con tipo borrado y reclamos que ya colgaban de un pedido borrado quedan como están. |
| Usuarios | Email en minúsculas, `google_id` se conserva (entran directo con Google), `version_sesion` en 0, sin avatar. |
| Estados de reclamo | Se copian tal cual; un estado desconocido **frena** la migración. |

---

## Antes del día del pase

1. Confirmar que el sistema viejo **sigue apagado** (si volvió a usarse, lo cargado después del 23/10/2026 no está en el dump: tomar uno nuevo con los pasos 1 y 2).
2. Tener **la app nueva desplegada** con su base Postgres creada y **las migraciones de esquema aplicadas** (`npm run migration:run` o `node` sobre `dist/database/data-source.js`), sin datos.
3. Tener **Docker** en la máquina desde donde se va a correr (para el MySQL temporal).
4. Recomendado: hacer antes un **ensayo completo** con un dump reciente sobre una base de prueba (ver paso 5 con `--simular` y luego sin él contra una base aparte).

---

## Paso a paso

### 1. Generar el dump en el servidor viejo (solo si hace falta uno nuevo)

Por SSH en el servidor del sistema original (los datos de conexión están en el `.env` de la app: `grep ^DB_ .env`):

```bash
mysqldump --single-transaction --default-character-set=utf8mb4 --no-tablespaces \
  -u USUARIO -p NOMBRE_BD > ~/leer_para_crecer-AAAA-MM-DD.sql
```

- `--single-transaction`: foto consistente sin bloquear la app.
- `utf8mb4`: que no se rompan tildes ni ñ.
- Guardarlo en el **home** del usuario, no dentro de la carpeta de la app (tiene datos reales).

### 2. Traerlo a la máquina que va a migrar (solo si hace falta uno nuevo)

Desde PowerShell (crear antes la carpeta; scp no la crea, y **sin barra al final** antes de la comilla):

```powershell
New-Item -ItemType Directory -Force "C:\ruta\datos"
scp usuario@SERVIDOR:/home/usuario/leer_para_crecer-AAAA-MM-DD.sql "C:\ruta\datos\leer_para_crecer.sql"
```

Después **borrarlo del servidor**: `rm ~/leer_para_crecer-AAAA-MM-DD.sql`. La carpeta `datos` no va en ningún repo.

### 3. Cargar el dump en un MySQL temporal

```bash
docker run -d --name migracion-mysql-tmp -e MYSQL_ROOT_PASSWORD=CLAVE_TEMPORAL -e MYSQL_DATABASE=origen \
  -p 127.0.0.1:3317:3306 mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

Esperar a que termine de iniciar (en `docker logs migracion-mysql-tmp` aparece `ready for connections ... port: 3306`; el primer arranque tarda), y cargar:

```bash
docker exec -i migracion-mysql-tmp mysql -uroot -pCLAVE_TEMPORAL --default-character-set=utf8mb4 origen < datos/leer_para_crecer.sql
```

Si ya existía de un ensayo, borrarlo antes: `docker rm -f migracion-mysql-tmp`.

### 4. Configurar el destino

El script toma el destino de las variables `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`
(las del entorno pisan las del `.env`). Lo primero que imprime es `Destino: host:puerto/base`: **verificar que sea la de producción**.

El origen va en `MIGRACION_MYSQL_URL`:

```powershell
$env:MIGRACION_MYSQL_URL = 'mysql://root:CLAVE_TEMPORAL@127.0.0.1:3317/origen'
```

### 5. Simular y migrar

Desde la carpeta `back` (con `npm run build` hecho, o usar `npm run migrar-datos`, que compila y corre):

```powershell
node dist/migracion-datos/migrar.js --simular   # reporte completo, no guarda nada
node dist/migracion-datos/migrar.js             # migración real
```

La salida muestra cuántas filas se cargaron por tabla, cuántas quedaron vigentes y los ajustes de las reglas.
Tiene que terminar en **"Migración guardada."**. Si termina con
"Hay datos que no se pueden migrar sin una decisión", lista cada caso (rol desconocido, estado de reclamo raro, etc.):
no forzar nada, decidir la regla y ajustar `transformar.ts` (con su test).

### 6. Verificar

- Comparar los conteos con los del ensayo y con los del sistema viejo.
- Entrar con Google con un usuario `super_admin` y revisar: tablero de la etapa publicada, listados de escuelas, pedidos y reclamos, y bajar un Excel.
- Controles rápidos en SQL:

```sql
SELECT COUNT(*) FROM pedidos WHERE deleted_at IS NULL;
SELECT rol, COUNT(*) FROM usuarios WHERE deleted_at IS NULL GROUP BY rol;
SELECT nombre, visible FROM etapas WHERE deleted_at IS NULL ORDER BY id;
```

### 7. Limpiar

```bash
docker rm -f migracion-mysql-tmp
```

Borrar el dump de la máquina local cuando ya no haga falta (tiene datos personales: nombres y emails de usuarios).

---

## Si sale mal

- **Falló a mitad de camino:** no hay que hacer nada; la transacción se deshizo y el destino quedó vacío. Corregir y volver a correr.
- **Terminó pero hay que repetirla** (por ejemplo, con un dump más nuevo): el script no carga sobre datos existentes. Vaciar las tablas de datos
  (el esquema y la tabla `migrations` de TypeORM quedan intactos) y correr de nuevo:

  ```sql
  TRUNCATE grados, catalogos, libros, escuelas, etapas, ofertas, etapa_escuela,
           pedidos, tipos_reclamo, reclamos, usuarios RESTART IDENTITY CASCADE;
  ```

  **Esto borra definitivamente todo lo cargado**, incluido lo que se haya hecho en la app nueva después de migrar. Hacer un `pg_dump` antes.
- **Sesiones abiertas:** después de vaciar y volver a migrar, quien tenía sesión debe cerrar y volver a entrar (las cookies viejas apuntan a ids de antes y se rechazan).

---

## Resultado de referencia (ensayo del 23/10/2026)

Dump de producción de ese día, cargado en una base de prueba y luego en la de desarrollo:

| Tabla | Filas | Vigentes |
|---|---:|---:|
| grados | 7 | 7 |
| catalogos | 3 | 1 |
| libros | 93 | 17 |
| escuelas | 468 | 437 |
| etapas | 11 | 5 |
| ofertas | 52 | 28 |
| etapa_escuela | 2.690 | 2.690 |
| pedidos | 18.055 | 11.895 |
| tipos_reclamo | 5 | 3 |
| reclamos | 8.315 | 4.542 |
| usuarios | 14 | 5 |

Ajustes: 50 pedidos repetidos borrados, 18 ofertas y 5.197 pedidos de etapas borradas, 53 reclamos de esos pedidos, 52 ofertas con cantidad máxima ajustada.
Se comprobó que todos los textos (md5 de nombres de escuelas, etapas, libros, usuarios) son idénticos al origen, igual que la suma de cantidades, las fechas, los horarios y las secuencias.
Como el sistema viejo está apagado, la migración de producción con el mismo dump tiene que dar **exactamente estos números**. Si da otros, revisar antes de seguir.
