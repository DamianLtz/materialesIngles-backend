import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { opcionesPostgres } from './opciones-postgres.js';

// DataSource solo para el CLI de TypeORM (migraciones). La app usa TypeOrmModule.
if (existsSync('.env')) process.loadEnvFile('.env');

function leerEnv(clave: string): string {
  const valor = process.env[clave];
  if (valor === undefined)
    throw new Error(`Falta la variable de entorno ${clave}`);
  return valor;
}

export default new DataSource({
  ...opcionesPostgres(leerEnv),
  migrations: [join(import.meta.dirname, 'migrations/*.js')],
});
