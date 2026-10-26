import writeXlsxFile from 'write-excel-file/node';

export const TIPO_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Celda = string | number | Date | null;

/**
 * Arma un .xlsx de una sola hoja: encabezados en negrita y fijos al hacer scroll.
 * Las fechas (Date) salen como dd/mm/aaaa.
 */
export async function crearXlsx(
  encabezados: string[],
  filas: Celda[][],
  anchos: number[] = [],
): Promise<Buffer> {
  const datos = [
    encabezados.map((value) => ({ value, fontWeight: 'bold' as const })),
    ...filas.map((fila) =>
      fila.map((valor) =>
        valor instanceof Date ? { value: valor, format: 'dd/mm/yyyy' } : valor,
      ),
    ),
  ];
  return writeXlsxFile(datos, {
    stickyRowsCount: 1,
    columns: encabezados.map((_, i) => ({ width: anchos[i] ?? 20 })),
  }).toBuffer();
}

/** Fecha de hoy como aaaa-mm-dd en horario de Buenos Aires, para nombres de archivo. */
export function hoyParaArchivo(): string {
  return new Date().toLocaleDateString('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/** Texto apto para un nombre de archivo (sin tildes, espacios ni símbolos): "Etapa 2026" → "etapa-2026". */
export function nombreParaArchivo(texto: string): string {
  const limpio = texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return limpio || 'etapa';
}
