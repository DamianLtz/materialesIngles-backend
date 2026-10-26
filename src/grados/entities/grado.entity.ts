import { Column, Entity, Index } from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';

/** Grado escolar: "1er Grado", "2do Grado", etc. (option_types en el original). */
@Entity('grados')
@Index('uq_grados_nombre', ['nombre'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Grado extends EntidadBase {
  @Column({ type: 'varchar' })
  nombre: string;
}
