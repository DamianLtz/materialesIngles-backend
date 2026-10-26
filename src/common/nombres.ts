import { Raw } from 'typeorm';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Condición `where` para buscar por `nombre` sin distinguir mayúsculas. Los nombres
 * son únicos así (como en el original, que usaba MySQL), pero el índice de Postgres
 * sí distingue; por eso se verifica en el servicio antes de guardar.
 */
export const nombreIgualA = (nombre: string) =>
  Raw((columna) => `LOWER(${columna}) = LOWER(:nombre)`, { nombre });

/** Detecta la violación de un índice único (dos altas simultáneas del mismo nombre). */
export function esViolacionDeUnico(error: unknown): boolean {
  return (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION;
}

/** "1 libro" / "3 libros": para los mensajes de "está en uso en ...". */
export function contar(cantidad: number, singular: string, plural: string) {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}
