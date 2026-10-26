import type { EntityManager } from 'typeorm';
import { Pedido } from './entities/pedido.entity.js';
import type { Accion } from './reemplazo.js';

interface Datos {
  /** El pedido vigente de la escuela en la oferta, si lo hay. */
  existente?: Pedido;
  escuelaId: number;
  ofertaId: number;
  /** El libro y la cantidad que se quieren dejar (no hace falta para quitar). */
  libroId?: number;
  cantidad?: number;
}

/**
 * Ejecuta lo que decidió `decidirAccion` sobre el pedido de una escuela en una oferta.
 * Siempre borrado lógico: nunca se borra físicamente un pedido. Lo usan "Asignar libros"
 * por escuela y la asignación masiva, así las dos reemplazan igual.
 */
export async function aplicarAccion(
  manager: EntityManager,
  accion: Accion['tipo'],
  { existente, escuelaId, ofertaId, libroId, cantidad }: Datos,
): Promise<void> {
  switch (accion) {
    case 'quitar':
      await manager.softRemove(existente!);
      return;
    case 'actualizar':
      existente!.cantidad = cantidad!;
      await manager.save(existente!);
      return;
    case 'reemplazar':
      // Primero el borrado: el índice único permite un solo pedido vigente por escuela y oferta
      await manager.softRemove(existente!);
      await manager.save(
        manager.create(Pedido, { escuelaId, ofertaId, libroId, cantidad }),
      );
      return;
    case 'crear':
      await manager.save(
        manager.create(Pedido, { escuelaId, ofertaId, libroId, cantidad }),
      );
      return;
    default:
      return; // 'nada' y 'bloqueado' no escriben
  }
}
