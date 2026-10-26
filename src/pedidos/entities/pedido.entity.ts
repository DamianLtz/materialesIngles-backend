import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';
import { Libro } from '../../catalogos/entities/libro.entity.js';
import { Escuela } from '../../escuelas/entities/escuela.entity.js';
import { Oferta } from '../../etapas/entities/oferta.entity.js';

/** Libro y cantidad que una escuela eligió para una oferta (order_requests en el original). */
@Entity('pedidos')
// Una escuela tiene un solo pedido vigente por oferta: elegir otro libro reemplaza el anterior
@Index('uq_pedidos_escuela_oferta', ['escuelaId', 'ofertaId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('ix_pedidos_oferta', ['ofertaId'])
export class Pedido extends EntidadBase {
  @Column({ name: 'escuela_id', type: 'int' })
  escuelaId: number;

  @ManyToOne(() => Escuela)
  @JoinColumn({ name: 'escuela_id' })
  escuela: Relation<Escuela>;

  @Column({ name: 'oferta_id', type: 'int' })
  ofertaId: number;

  @ManyToOne(() => Oferta)
  @JoinColumn({ name: 'oferta_id' })
  oferta: Relation<Oferta>;

  @Column({ name: 'libro_id', type: 'int' })
  libroId: number;

  @ManyToOne(() => Libro)
  @JoinColumn({ name: 'libro_id' })
  libro: Relation<Libro>;

  @Column({ type: 'int' })
  cantidad: number;
}
