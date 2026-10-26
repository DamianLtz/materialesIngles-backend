import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';
import { Pedido } from '../../pedidos/entities/pedido.entity.js';
import { TipoReclamo } from './tipo-reclamo.entity.js';

export enum EstadoReclamo {
  Pendiente = 'pendiente',
  EnProceso = 'en_proceso',
  Resuelto = 'resuelto',
  Rechazado = 'rechazado',
  Historico = 'historico',
}

/** Reclamo de una escuela sobre un pedido ya entregado (claims en el original). */
@Entity('reclamos')
@Index('ix_reclamos_pedido', ['pedidoId'])
@Index('ix_reclamos_estado', ['estado'])
// Un pedido tiene un solo reclamo vigente por tipo (el sitio público reemplaza, no duplica)
@Index('uq_reclamos_pedido_tipo', ['pedidoId', 'tipoReclamoId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Reclamo extends EntidadBase {
  @Column({ name: 'pedido_id', type: 'int' })
  pedidoId: number;

  @ManyToOne(() => Pedido)
  @JoinColumn({ name: 'pedido_id' })
  pedido: Relation<Pedido>;

  @Column({ name: 'tipo_reclamo_id', type: 'int' })
  tipoReclamoId: number;

  @ManyToOne(() => TipoReclamo)
  @JoinColumn({ name: 'tipo_reclamo_id' })
  tipoReclamo: Relation<TipoReclamo>;

  @Column({ type: 'int', nullable: true })
  cantidad: number | null;

  /**
   * Sin uso: los adjuntos se siguen mandando por mail con el número de lote (decisión del
   * 22/10/2026). Se conserva para las rutas que vengan de la migración de datos de MySQL.
   */
  @Column({ type: 'varchar', nullable: true })
  archivo: string | null;

  @Column({
    type: 'enum',
    enum: EstadoReclamo,
    enumName: 'estado_reclamo',
    default: EstadoReclamo.Pendiente,
  })
  estado: EstadoReclamo;
}
