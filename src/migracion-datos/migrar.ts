/**
 * Migración de datos del sistema original (MySQL) a esta base (Postgres). Se corre una vez:
 *
 *   MIGRACION_MYSQL_URL=mysql://usuario:clave@host:3306/base npm run migrar-datos [-- --simular]
 *
 * - El destino es la base de las variables DB_* (las del entorno pisan las de .env) y tiene
 *   que tener el esquema al día (`npm run migration:run`) y estar VACÍA: si alguna tabla tiene
 *   filas, no se toca nada.
 * - Todo va en una sola transacción: si algo falla, el destino queda como estaba.
 * - `--simular` hace todo y al final deshace (sirve para ver el reporte sin escribir).
 * Las reglas de traducción están en transformar.ts.
 */
import mysql from 'mysql2/promise';
import pg from 'pg';
import {
  ErrorDeDatos,
  TABLAS_DESTINO,
  transformar,
  type Fila,
  type Origen,
} from './transformar.js';

// Las variables ya definidas en el entorno tienen prioridad sobre las del archivo
try {
  process.loadEnvFile('.env');
} catch {
  // sin .env: todo tiene que venir del entorno
}

function leerEnv(clave: string): string {
  const valor = process.env[clave];
  if (!valor) throw new Error(`Falta la variable de entorno ${clave}`);
  return valor;
}

const SIMULAR = process.argv.includes('--simular');
/** Postgres admite hasta 65535 parámetros por consulta. */
const MAX_PARAMETROS = 60000;

async function leerOrigen(url: string): Promise<Origen> {
  // dateStrings: las fechas llegan como texto, sin conversiones de zona de JavaScript
  const conexion = await mysql.createConnection({
    uri: url,
    dateStrings: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  });
  try {
    // Laravel guardaba los timestamps en UTC: se leen en UTC
    await conexion.query("SET time_zone = '+00:00'");
    const leer = async <T>(sql: string): Promise<T[]> => {
      const [filas] = await conexion.query(sql);
      return filas as T[];
    };
    const tiempos = 'created_at, updated_at, deleted_at';
    return {
      grados: await leer(`SELECT id, name, ${tiempos} FROM option_types`),
      catalogos: await leer(`SELECT id, name, ${tiempos} FROM book_types`),
      libros: await leer(
        `SELECT id, isbn_number, option_type_id, book_type_id, publisher, title, ${tiempos} FROM books`,
      ),
      escuelas: await leer(
        `SELECT id, cueanexo, name, description, street, street_number, postal_code, ${tiempos} FROM schools`,
      ),
      etapas: await leer(
        `SELECT id, name, start, \`end\`, legend, claim_start, claim_end, claim_legend, view, ${tiempos} FROM orders`,
      ),
      ofertas: await leer(
        `SELECT id, order_id, option_type_id, book_type_id, max_quantity, ${tiempos} FROM options`,
      ),
      asignaciones: await leer(
        'SELECT order_id, school_id FROM order_school ORDER BY id',
      ),
      pedidos: await leer(
        `SELECT id, school_id, option_id, book_id, quantity, ${tiempos} FROM order_requests`,
      ),
      tiposReclamo: await leer(
        `SELECT id, name, legend, ${tiempos} FROM claim_types`,
      ),
      reclamos: await leer(
        `SELECT id, order_request_id, claim_type_id, quantity, file_path, status, ${tiempos} FROM claims`,
      ),
      usuarios: await leer(
        `SELECT id, name, email, google_id, active, ${tiempos} FROM users`,
      ),
      rolesUsuario: await leer(
        `SELECT m.model_id, r.name AS rol FROM model_has_roles m
         JOIN roles r ON r.id = m.role_id WHERE m.model_type LIKE '%User'`,
      ),
    };
  } finally {
    await conexion.end();
  }
}

/** INSERT de varias filas por consulta, en tandas que no pasen el límite de parámetros. */
async function insertar(cliente: pg.PoolClient, tabla: string, filas: Fila[]) {
  if (filas.length === 0) return;
  const columnas = Object.keys(filas[0]);
  const porTanda = Math.floor(MAX_PARAMETROS / columnas.length);
  for (let i = 0; i < filas.length; i += porTanda) {
    const tanda = filas.slice(i, i + porTanda);
    const valores: unknown[] = [];
    const tuplas = tanda.map((fila) => {
      const marcas = columnas.map((c) => {
        valores.push(fila[c]);
        return `$${valores.length}`;
      });
      return `(${marcas.join(', ')})`;
    });
    await cliente.query(
      `INSERT INTO "${tabla}" (${columnas.map((c) => `"${c}"`).join(', ')}) VALUES ${tuplas.join(', ')}`,
      valores,
    );
  }
}

async function main() {
  const urlOrigen = leerEnv('MIGRACION_MYSQL_URL');
  const destino = new pg.Pool({
    host: leerEnv('DB_HOST'),
    port: Number(leerEnv('DB_PORT')),
    database: leerEnv('DB_DATABASE'),
    user: leerEnv('DB_USERNAME'),
    password: leerEnv('DB_PASSWORD'),
  });
  console.log(
    `Destino: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}${SIMULAR ? ' (simulación: no se guarda nada)' : ''}`,
  );

  const cliente = await destino.connect();
  try {
    // 1. El destino tiene que estar vacío (nunca mezclar con datos existentes)
    const conDatos: string[] = [];
    for (const tabla of TABLAS_DESTINO) {
      const { rows } = await cliente.query<{ hay: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM "${tabla}") AS hay`,
      );
      if (rows[0].hay) conDatos.push(tabla);
    }
    if (conDatos.length > 0) {
      throw new Error(
        `El destino no está vacío (tablas con filas: ${conDatos.join(', ')}). No se tocó nada.`,
      );
    }

    // 2. Leer y traducir
    console.log('Leyendo el origen…');
    const origen = await leerOrigen(urlOrigen);
    const ahora = new Date().toISOString();
    const { filas, resumen } = transformar(origen, ahora);

    // 3. Escribir todo en una transacción
    await cliente.query('BEGIN');
    for (const tabla of TABLAS_DESTINO) {
      process.stdout.write(`  ${tabla}… `);
      await insertar(cliente, tabla, filas[tabla]);
      console.log(filas[tabla].length);
    }

    // 4. Los ids se copiaron tal cual: las secuencias siguen desde el mayor
    for (const tabla of TABLAS_DESTINO) {
      if (tabla === 'etapa_escuela') continue;
      await cliente.query(
        `SELECT setval(pg_get_serial_sequence('"${tabla}"', 'id'),
                (SELECT COALESCE(MAX(id), 0) + 1 FROM "${tabla}"), false)`,
      );
    }

    // 5. Controlar: lo que quedó en cada tabla tiene que coincidir con lo que se mandó
    console.log('\nTabla            filas  vigentes');
    let diferencias = 0;
    for (const tabla of TABLAS_DESTINO) {
      const conBorrado = tabla !== 'etapa_escuela';
      const { rows } = await cliente.query<{ total: number; vigentes: number }>(
        `SELECT COUNT(*)::int AS total,
                ${conBorrado ? 'COUNT(*) FILTER (WHERE deleted_at IS NULL)::int' : 'COUNT(*)::int'} AS vigentes
         FROM "${tabla}"`,
      );
      const esperado = filas[tabla].length;
      const vigentesEsperados = filas[tabla].filter(
        (f) => !conBorrado || f.deleted_at === null,
      ).length;
      const ok =
        rows[0].total === esperado && rows[0].vigentes === vigentesEsperados;
      if (!ok) diferencias++;
      console.log(
        `${tabla.padEnd(16)} ${String(rows[0].total).padStart(5)}  ${String(rows[0].vigentes).padStart(8)}${ok ? '' : `   ≠ esperado ${esperado} / ${vigentesEsperados}`}`,
      );
    }
    console.log('\nAjustes (reglas acordadas):');
    console.log(
      `  pedidos repetidos borrados ............ ${resumen.pedidosDuplicadosBorrados}`,
    );
    console.log(
      `  ofertas borradas con su etapa ......... ${resumen.ofertasBorradasPorEtapa}`,
    );
    console.log(
      `  pedidos borrados con su etapa ......... ${resumen.pedidosBorradosPorEtapa}`,
    );
    console.log(
      `  reclamos borrados con su pedido ....... ${resumen.reclamosBorradosPorPedido}`,
    );
    console.log(
      `  ofertas con cantidad máxima ajustada .. ${resumen.ofertasConCantidadAjustada}`,
    );

    if (diferencias > 0) {
      throw new Error(`${diferencias} tabla(s) no coinciden. Se deshizo todo.`);
    }
    if (SIMULAR) {
      await cliente.query('ROLLBACK');
      console.log(
        '\nSimulación correcta: se deshizo todo, el destino sigue vacío.',
      );
    } else {
      await cliente.query('COMMIT');
      console.log('\nMigración guardada.');
    }
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    cliente.release();
    await destino.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ErrorDeDatos) {
    console.error(
      `\nHay datos que no se pueden migrar sin una decisión:\n${error.message}`,
    );
  } else {
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
  process.exitCode = 1;
});
