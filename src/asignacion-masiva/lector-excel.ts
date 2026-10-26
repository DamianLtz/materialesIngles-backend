import { BadRequestException } from '@nestjs/common';
import { readSheet } from 'read-excel-file/node';

/** Una fila de datos del Excel, ya normalizada. Es lo mismo que vuelve a mandar el front al guardar. */
export interface FilaImportada {
  /** Número de fila en el Excel (la 1 es el encabezado). */
  fila: number;
  cueanexo: string;
  isbn: string;
  /** Lo que había en la celda de cantidad; se interpreta al validar. */
  cantidad: string;
  /** Opcional: sirve de control contra el grado del libro. */
  grado: string;
}

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_FILAS = 5000;

/** Encabezados aceptados (se comparan sin mayúsculas, tildes, espacios ni símbolos). */
const ALIAS: Record<string, 'cueanexo' | 'isbn' | 'cantidad' | 'grado'> = {
  cueanexo: 'cueanexo',
  cue: 'cueanexo',
  isbn: 'isbn',
  cantidad: 'cantidad',
  grado: 'grado',
};
const OBLIGATORIAS = ['cueanexo', 'isbn', 'cantidad'] as const;
const NOMBRE_COLUMNA = {
  cueanexo: 'cueanexo',
  isbn: 'isbn',
  cantidad: 'cantidad',
};

/** Minúsculas, sin tildes y solo letras y números: "CUE / Anexo" → "cueanexo". */
export const normalizarTexto = (valor: string): string =>
  valor
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Una celda como texto: los enteros sin ".0", sin espacios en los bordes. */
function aTexto(celda: unknown): string {
  if (celda === null || celda === undefined) return '';
  if (typeof celda === 'number')
    return Number.isFinite(celda) ? String(celda) : '';
  // Fechas, booleanos y demás no son datos válidos en estas columnas
  return typeof celda === 'string' ? celda.trim() : '';
}

/**
 * Lee la primera hoja del .xlsx y devuelve las filas de datos. Rechaza (400) lo que no es
 * un .xlsx, lo que pasa de 5 MB o de 5000 filas, y los archivos sin las columnas
 * obligatorias nombrando las que faltan. Las filas totalmente vacías se ignoran.
 */
export async function leerFilas(buffer: Buffer): Promise<FilaImportada[]> {
  if (buffer.length > MAX_BYTES) {
    throw new BadRequestException('El archivo supera los 5 MB permitidos.');
  }
  // Un .xlsx es un ZIP: empieza con "PK"
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new BadRequestException('El archivo no es un Excel (.xlsx) válido.');
  }

  let hoja: unknown[][];
  try {
    hoja = (await readSheet(buffer)) as unknown[][];
  } catch {
    throw new BadRequestException('El archivo no es un Excel (.xlsx) válido.');
  }
  if (hoja.length === 0) {
    throw new BadRequestException('El archivo está vacío.');
  }

  // Posición de cada columna según su encabezado
  const columnas: Partial<
    Record<'cueanexo' | 'isbn' | 'cantidad' | 'grado', number>
  > = {};
  hoja[0].forEach((encabezado, i) => {
    const clave = ALIAS[normalizarTexto(aTexto(encabezado))];
    if (clave && columnas[clave] === undefined) columnas[clave] = i;
  });
  const faltan = OBLIGATORIAS.filter((c) => columnas[c] === undefined);
  if (faltan.length) {
    throw new BadRequestException(
      `Faltan columnas: ${faltan.map((c) => NOMBRE_COLUMNA[c]).join(', ')}.`,
    );
  }

  const celda = (fila: unknown[], columna?: number) =>
    columna === undefined ? '' : aTexto(fila[columna]);

  const filas: FilaImportada[] = [];
  hoja.slice(1).forEach((datos, i) => {
    const fila: FilaImportada = {
      fila: i + 2,
      cueanexo: celda(datos, columnas.cueanexo),
      // El ISBN se escribe a veces con guiones o espacios: se comparan sin ellos
      isbn: celda(datos, columnas.isbn).replace(/[\s-]/g, ''),
      cantidad: celda(datos, columnas.cantidad),
      grado: celda(datos, columnas.grado),
    };
    if (fila.cueanexo || fila.isbn || fila.cantidad || fila.grado) {
      filas.push(fila);
    }
  });

  if (filas.length === 0) {
    throw new BadRequestException('El archivo no tiene filas para importar.');
  }
  if (filas.length > MAX_FILAS) {
    throw new BadRequestException(
      `El archivo tiene ${filas.length} filas: el máximo es ${MAX_FILAS}. Dividilo en varios.`,
    );
  }
  return filas;
}
