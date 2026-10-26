import { Column, Entity, Index } from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';

/** Motivo de reclamo: faltante, rotura, etc. (claim_types en el original). */
@Entity('tipos_reclamo')
@Index('uq_tipos_reclamo_nombre', ['nombre'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class TipoReclamo extends EntidadBase {
  @Column({ type: 'varchar' })
  nombre: string;

  /** Explica a la escuela cuándo corresponde este tipo de reclamo. */
  @Column({ type: 'text', nullable: true })
  leyenda: string | null;
}
