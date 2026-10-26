const ZONA_ARGENTINA = 'America/Argentina/Buenos_Aires';

// 'en-CA' formatea como aaaa-mm-dd, el mismo formato en que se guardan las fechas (columnas date)
const formatoArgentina = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_ARGENTINA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Fecha de hoy (aaaa-mm-dd) en Argentina. No usar la fecha UTC del servidor: a las 21:00
 * de Buenos Aires ya es "mañana" en UTC y los períodos cambiarían tres horas antes.
 */
export function hoyEnArgentina(ahora: Date = new Date()): string {
  return formatoArgentina.format(ahora);
}

/**
 * Un período (selección o reclamo) está abierto si hoy cae entre inicio y fin, ambos
 * días incluidos. Si falta alguna fecha el período está cerrado (nunca "abierto sin fin").
 * Las fechas aaaa-mm-dd se comparan como texto, que equivale a compararlas como fechas.
 */
export function periodoAbierto(
  inicio: string | null | undefined,
  fin: string | null | undefined,
  hoy: string,
): boolean {
  if (!inicio || !fin) return false;
  return inicio <= hoy && hoy <= fin;
}
