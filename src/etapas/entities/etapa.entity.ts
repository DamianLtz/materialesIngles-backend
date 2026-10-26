import {
  Column,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  OneToMany,
  type Relation,
} from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';
import { Escuela } from '../../escuelas/entities/escuela.entity.js';
import { Oferta } from './oferta.entity.js';

/**
 * Período en que las escuelas habilitadas eligen libros (fecha_inicio/fecha_fin)
 * y luego pueden reclamar (reclamo_inicio/reclamo_fin). Orders en el original.
 */
@Entity('etapas')
@Index('uq_etapas_nombre', ['nombre'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
// Una sola etapa publicada a la vez: la base lo garantiza aunque dos pedidos publiquen en simultáneo
@Index('uq_etapas_visible', ['visible'], {
  unique: true,
  where: '"visible" AND "deleted_at" IS NULL',
})
export class Etapa extends EntidadBase {
  @Column({ type: 'varchar' })
  nombre: string;

  @Column({ name: 'fecha_inicio', type: 'date', nullable: true })
  fechaInicio: string | null;

  @Column({ name: 'fecha_fin', type: 'date', nullable: true })
  fechaFin: string | null;

  @Column({ type: 'text', nullable: true })
  leyenda: string | null;

  @Column({ name: 'reclamo_inicio', type: 'date', nullable: true })
  reclamoInicio: string | null;

  @Column({ name: 'reclamo_fin', type: 'date', nullable: true })
  reclamoFin: string | null;

  @Column({ name: 'reclamo_leyenda', type: 'text', nullable: true })
  reclamoLeyenda: string | null;

  /** Etapa publicada en el front de escuelas (view en el original). */
  @Column({ type: 'boolean', default: false })
  visible: boolean;

  @OneToMany(() => Oferta, (oferta) => oferta.etapa)
  ofertas: Relation<Oferta[]>;

  @ManyToMany(() => Escuela, (escuela) => escuela.etapas)
  @JoinTable({
    name: 'etapa_escuela',
    joinColumn: { name: 'etapa_id' },
    inverseJoinColumn: { name: 'escuela_id' },
  })
  escuelas: Relation<Escuela[]>;
}
