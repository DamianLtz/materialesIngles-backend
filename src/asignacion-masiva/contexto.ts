import { In, type EntityManager } from 'typeorm';
import { Libro } from '../catalogos/entities/libro.entity.js';
import { Escuela } from '../escuelas/entities/escuela.entity.js';
import { Oferta } from '../etapas/entities/oferta.entity.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import { Reclamo } from '../reclamos/entities/reclamo.entity.js';
import type { FilaImportada } from './lector-excel.js';
import type { ContextoValidacion } from './validador.js';

/**
 * Carga de una sola vez lo que hace falta para validar las filas (escuelas, libros,
 * ofertas de la etapa y pedidos vigentes), en vez de consultar fila por fila.
 */
export async function cargarContexto(
  manager: EntityManager,
  etapaId: number,
  filas: Pick<FilaImportada, 'cueanexo' | 'isbn'>[],
): Promise<ContextoValidacion> {
  const cues = [...new Set(filas.map((f) => f.cueanexo).filter(Boolean))];
  const isbns = [...new Set(filas.map((f) => f.isbn).filter(Boolean))];

  const [escuelas, libros, ofertas, enEtapa] = await Promise.all([
    cues.length
      ? manager.find(Escuela, { where: { cueanexo: In(cues) } })
      : Promise.resolve([]),
    isbns.length
      ? manager.find(Libro, { where: { isbn: In(isbns) } })
      : Promise.resolve([]),
    manager.find(Oferta, {
      where: { etapaId },
      relations: { grado: true, catalogo: true },
    }),
    manager.query<{ escuela_id: number }[]>(
      'SELECT escuela_id FROM etapa_escuela WHERE etapa_id = $1',
      [etapaId],
    ),
  ]);

  const ctx: ContextoValidacion = {
    escuelasPorCue: new Map(
      escuelas.map((e) => [e.cueanexo, { id: e.id, nombre: e.nombre }]),
    ),
    escuelasDeLaEtapa: new Set(enEtapa.map((f) => f.escuela_id)),
    librosPorIsbn: new Map(),
    ofertas: new Map(
      ofertas.map((o) => [
        `${o.gradoId}-${o.catalogoId}`,
        {
          id: o.id,
          gradoNombre: o.grado.nombre,
          catalogoNombre: o.catalogo.nombre,
          cantidadMaxima: o.cantidadMaxima,
        },
      ]),
    ),
    pedidos: new Map(),
  };
  for (const l of libros) {
    const lista = ctx.librosPorIsbn.get(l.isbn) ?? [];
    lista.push({
      id: l.id,
      titulo: l.titulo,
      gradoId: l.gradoId,
      catalogoId: l.catalogoId,
    });
    ctx.librosPorIsbn.set(l.isbn, lista);
  }

  // Pedidos vigentes de esas escuelas en las ofertas de la etapa, con sus reclamos
  const escuelaIds = escuelas.map((e) => e.id);
  const ofertaIds = ofertas.map((o) => o.id);
  if (escuelaIds.length && ofertaIds.length) {
    const pedidos = (
      await manager.find(Pedido, {
        where: { escuelaId: In(escuelaIds), ofertaId: In(ofertaIds) },
        relations: { libro: true },
        withDeleted: true, // el libro puede estar deshabilitado; los pedidos borrados se descartan abajo
      })
    ).filter((p) => p.deletedAt === null);
    const reclamos = pedidos.length
      ? await manager
          .createQueryBuilder(Reclamo, 'r')
          .select('r.pedido_id', 'pedidoId')
          .addSelect('COUNT(*)::int', 'cantidad')
          .where('r.pedido_id IN (:...ids)', { ids: pedidos.map((p) => p.id) })
          .groupBy('r.pedido_id')
          .getRawMany<{ pedidoId: number; cantidad: number }>()
      : [];
    const porPedido = new Map(reclamos.map((r) => [r.pedidoId, r.cantidad]));
    for (const p of pedidos) {
      ctx.pedidos.set(`${p.escuelaId}-${p.ofertaId}`, {
        id: p.id,
        libroId: p.libroId,
        libroTitulo: p.libro.titulo,
        cantidad: p.cantidad,
        reclamos: porPedido.get(p.id) ?? 0,
      });
    }
  }
  return ctx;
}
