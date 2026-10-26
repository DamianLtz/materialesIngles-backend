import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions.js';
import { ENTIDADES } from './entidades.js';

/**
 * Conexión compartida entre la app (ConfigService) y el CLI de migraciones (process.env).
 */
export function opcionesPostgres(
  leer: (clave: string) => string,
): PostgresDataSourceOptions {
  return {
    type: 'postgres',
    host: leer('DB_HOST'),
    port: Number(leer('DB_PORT')),
    database: leer('DB_DATABASE'),
    username: leer('DB_USERNAME'),
    password: leer('DB_PASSWORD'),
    entities: ENTIDADES,
    // El esquema se maneja solo con migraciones, nunca con synchronize
    synchronize: false,
  };
}
