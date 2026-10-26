import { Column, Entity, Index, ManyToMany, type Relation } from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';
import { Etapa } from '../../etapas/entities/etapa.entity.js';

@Entity('escuelas')
@Index('uq_escuelas_cueanexo', ['cueanexo'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Escuela extends EntidadBase {
  // Identificador oficial de la escuela; es el que va en la URL pública /{cueanexo}
  @Column({ type: 'varchar' })
  cueanexo: string;

  @Column({ type: 'varchar' })
  nombre: string;

  /** Distrito escolar (disctrict_number en el original). */
  @Column({ type: 'int' })
  distrito: number;

  @Column({ type: 'varchar', nullable: true })
  descripcion: string | null;

  @Column({ type: 'varchar' })
  calle: string;

  @Column({ type: 'int' })
  altura: number;

  @Column({ name: 'codigo_postal', type: 'varchar' })
  codigoPostal: string;

  @ManyToMany(() => Etapa, (etapa) => etapa.escuelas)
  etapas: Relation<Etapa[]>;
}
