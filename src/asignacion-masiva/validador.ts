import { contar } from '../common/nombres.js';
import {
  decidirAccion,
  type Accion,
  type PedidoActual,
} from '../pedidos/reemplazo.js';
import { normalizarTexto, type FilaImportada } from './lector-excel.js';

/** Una oferta de la etapa (grado × catálogo) con su cantidad máxima. */
export interface OfertaContexto {
  id: number;
  gradoNombre: string;
  catalogoNombre: string;
  cantidadMaxima: number;
}

/** Todo lo que se necesita saber de la base para validar un archivo, cargado de una sola vez. */
export interface ContextoValidacion {
  escuelasPorCue: Map<string, { id: number; nombre: string }>;
  /** Escuelas asignadas a la etapa publicada. */
  escuelasDeLaEtapa: Set<number>;
  librosPorIsbn: Map<
    string,
    { id: number; titulo: string; gradoId: number; catalogoId: number }[]
  >;
  /** Ofertas de la etapa por `gradoId-catalogoId`. */
  ofertas: Map<string, OfertaContexto>;
  /** Pedidos vigentes por `escuelaId-ofertaId`. */
  pedidos: Map<string, PedidoActual & { libroTitulo: string }>;
}

export type EstadoFila =
  'nueva' | 'actualiza' | 'reemplaza' | 'sin_cambios' | 'error';

/** Lo que ve el front de cada fila (sin ids de la base: el guardado vuelve a validar todo). */
export interface FilaValidada {
  fila: number;
  cueanexo: string;
  isbn: string;
  cantidad: number | null;
  /** Lo que decía la celda de cantidad (para mostrar cuando es inválida). */
  cantidadRaw: string;
  escuela: string | null;
  libro: string | null;
  grado: string | null;
  catalogo: string | null;
  cantidadMaxima: number | null;
  estado: EstadoFila;
  errores: string[];
  /** Si reemplaza o actualiza: lo que había. */
  libroAnterior: string | null;
  cantidadAnterior: number | null;
}

/** Lo que el servidor necesita para aplicar una fila válida. Nunca sale del servidor. */
export interface FilaResuelta {
  escuelaId: number;
  ofertaId: number;
  libroId: number;
  cantidad: number;
  accion: Accion['tipo'];
  /** Id del pedido vigente (para actualizar o reemplazar). */
  existenteId: number | null;
}

/** El texto del grado coincide con el nombre ("2do Grado") o es solo su número ("2"). */
export function gradoCoincide(texto: string, nombre: string): boolean {
  const t = normalizarTexto(texto);
  const n = normalizarTexto(nombre);
  if (t === n) return true;
  return /^\d+$/.test(t) && n.startsWith(t) && !/\d/.test(n.charAt(t.length));
}

const nombreOferta = (o: { gradoNombre: string; catalogoNombre: string }) =>
  `${o.gradoNombre} – ${o.catalogoNombre}`;

/**
 * Valida y clasifica cada fila contra el contexto. Una fila acumula todos sus errores.
 * Devuelve, en el mismo orden, la fila para mostrar y, si es válida, lo que hay que aplicar.
 */
export function validarFilas(
  filas: FilaImportada[],
  ctx: ContextoValidacion,
): { filas: FilaValidada[]; resueltas: (FilaResuelta | null)[] } {
  // Primera fila válida de cada escuela y oferta, para detectar repeticiones
  const vistas = new Map<string, number>();
  const salida: FilaValidada[] = [];
  const resueltas: (FilaResuelta | null)[] = [];

  for (const f of filas) {
    const errores: string[] = [];
    const v: FilaValidada = {
      fila: f.fila,
      cueanexo: f.cueanexo,
      isbn: f.isbn,
      cantidad: null,
      cantidadRaw: f.cantidad,
      escuela: null,
      libro: null,
      grado: null,
      catalogo: null,
      cantidadMaxima: null,
      estado: 'error',
      errores,
      libroAnterior: null,
      cantidadAnterior: null,
    };

    // Escuela
    let escuelaId: number | null = null;
    if (!f.cueanexo) {
      errores.push('Falta el CUE/Anexo.');
    } else {
      const escuela = ctx.escuelasPorCue.get(f.cueanexo);
      if (!escuela) {
        errores.push(`CUE/Anexo no encontrado: ${f.cueanexo}.`);
      } else {
        v.escuela = escuela.nombre;
        if (ctx.escuelasDeLaEtapa.has(escuela.id)) escuelaId = escuela.id;
        else errores.push('La escuela no participa de la etapa publicada.');
      }
    }

    // Libro y oferta: el libro ya tiene grado y catálogo, con eso se halla la oferta
    let oferta: OfertaContexto | null = null;
    let libroId: number | null = null;
    if (!f.isbn) {
      errores.push('Falta el ISBN.');
    } else {
      const libros = ctx.librosPorIsbn.get(f.isbn) ?? [];
      if (libros.length === 0) {
        errores.push(`ISBN no encontrado: ${f.isbn}.`);
      } else {
        v.libro = libros[0].titulo;
        const candidatas = new Map<
          number,
          { oferta: OfertaContexto; libroId: number }
        >();
        for (const libro of libros) {
          const o = ctx.ofertas.get(`${libro.gradoId}-${libro.catalogoId}`);
          if (o) candidatas.set(o.id, { oferta: o, libroId: libro.id });
        }
        if (candidatas.size === 0) {
          errores.push(
            `"${libros[0].titulo}" no corresponde a ninguna oferta de la etapa.`,
          );
        } else if (candidatas.size > 1) {
          errores.push(
            `ISBN ambiguo: corresponde a más de una oferta de la etapa (${[...candidatas.values()].map((c) => nombreOferta(c.oferta)).join(', ')}).`,
          );
        } else {
          const [{ oferta: o, libroId: id }] = [...candidatas.values()];
          oferta = o;
          libroId = id;
          v.grado = o.gradoNombre;
          v.catalogo = o.catalogoNombre;
          v.cantidadMaxima = o.cantidadMaxima;
          v.libro = libros.find((l) => l.id === id)!.titulo;
        }
      }
    }

    // Grado (opcional): solo un control contra el grado del libro
    if (oferta && f.grado && !gradoCoincide(f.grado, oferta.gradoNombre)) {
      errores.push(
        `El grado no coincide: el libro es de ${oferta.gradoNombre} y el archivo dice "${f.grado}".`,
      );
    }

    // Cantidad: entero de 1 hasta el máximo de la oferta (sin decimales)
    if (!/^\d+$/.test(f.cantidad) || Number(f.cantidad) < 1) {
      errores.push(
        f.cantidad ? `Cantidad inválida: ${f.cantidad}.` : 'Falta la cantidad.',
      );
    } else {
      v.cantidad = Number(f.cantidad);
      if (oferta && v.cantidad > oferta.cantidadMaxima) {
        errores.push(
          `La cantidad máxima de ${nombreOferta(oferta)} es ${oferta.cantidadMaxima}.`,
        );
      }
    }

    // Repetidas: la misma escuela y oferta ya aparece antes en el archivo
    const clave = escuelaId && oferta ? `${escuelaId}-${oferta.id}` : null;
    if (clave && errores.length === 0) {
      const antes = vistas.get(clave);
      if (antes !== undefined) {
        errores.push(
          `Fila repetida: la misma escuela y oferta ya aparece en la fila ${antes}.`,
        );
      }
    }

    // Qué pasaría con el pedido actual
    if (errores.length === 0 && clave && escuelaId && oferta && libroId) {
      const actual = ctx.pedidos.get(clave);
      const accion = decidirAccion(actual, {
        libroId,
        cantidad: v.cantidad!,
      });
      if (actual) {
        v.libroAnterior = actual.libroTitulo;
        v.cantidadAnterior = actual.cantidad;
      }
      if (accion.tipo === 'bloqueado') {
        errores.push(
          `El pedido actual tiene ${contar(actual!.reclamos, 'reclamo', 'reclamos')}: no se puede cambiar el libro.`,
        );
      } else {
        vistas.set(clave, f.fila);
        v.estado = {
          crear: 'nueva',
          actualizar: 'actualiza',
          reemplazar: 'reemplaza',
          nada: 'sin_cambios',
        }[
          accion.tipo as 'crear' | 'actualizar' | 'reemplazar' | 'nada'
        ] as EstadoFila;
        salida.push(v);
        resueltas.push({
          escuelaId,
          ofertaId: oferta.id,
          libroId,
          cantidad: v.cantidad!,
          accion: accion.tipo,
          existenteId: actual?.id ?? null,
        });
        continue;
      }
    }
    salida.push(v);
    resueltas.push(null);
  }
  return { filas: salida, resueltas };
}
