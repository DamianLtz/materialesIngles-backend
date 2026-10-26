/** Lo que ya existe de un pedido (escuela + oferta). */
export interface PedidoActual {
  id: number;
  libroId: number;
  cantidad: number;
  /** Reclamos vigentes sobre este pedido. */
  reclamos: number;
}

/** Lo que se quiere dejar: un libro con cantidad, o null para quitar el pedido. */
export type PedidoDeseado = { libroId: number; cantidad: number } | null;

export type Accion =
  | { tipo: 'nada' }
  | { tipo: 'crear' }
  | { tipo: 'actualizar' }
  | { tipo: 'reemplazar' }
  | { tipo: 'quitar' }
  | { tipo: 'bloqueado'; motivo: 'quitar' | 'cambiar-libro' };

/**
 * Qué hacer con el pedido de una escuela en una oferta (regla compartida por la
 * asignación de libros por escuela y por la asignación masiva):
 * - misma cantidad y libro: nada; solo cambia la cantidad: se actualiza la fila (conserva
 *   id y reclamos); cambia el libro: se borra (lógico) el anterior y se crea otro;
 * - quitar o cambiar el libro de un pedido con reclamos está bloqueado (dejaría reclamos
 *   colgando); cambiarle solo la cantidad sí se permite.
 */
export function decidirAccion(
  actual: PedidoActual | undefined,
  deseado: PedidoDeseado,
): Accion {
  if (!deseado) {
    if (!actual) return { tipo: 'nada' };
    return actual.reclamos > 0
      ? { tipo: 'bloqueado', motivo: 'quitar' }
      : { tipo: 'quitar' };
  }
  if (!actual) return { tipo: 'crear' };
  if (actual.libroId === deseado.libroId) {
    return actual.cantidad === deseado.cantidad
      ? { tipo: 'nada' }
      : { tipo: 'actualizar' };
  }
  return actual.reclamos > 0
    ? { tipo: 'bloqueado', motivo: 'cambiar-libro' }
    : { tipo: 'reemplazar' };
}
