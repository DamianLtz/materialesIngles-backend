import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';
import { Catalogo } from '../../catalogos/entities/catalogo.entity.js';
import { Grado } from '../../grados/entities/grado.entity.js';
import { Etapa } from './etapa.entity.js';

/**
 * Lo que una etapa ofrece por grado: "en esta etapa, para 1er grado de Inglés,
 * la escuela elige un libro". Los pedidos se registran contra una oferta.
 * Options en el original.
 */
@Entity('ofertas')
@Index('ix_ofertas_etapa', ['etapaId'])
// Un mismo grado y catálogo no se ofrece dos veces en la misma etapa
@Index(
  'uq_ofertas_etapa_grado_catalogo',
  ['etapaId', 'gradoId', 'catalogoId'],
  {
    unique: true,
    where: '"deleted_at" IS NULL',
  },
)
export class Oferta extends EntidadBase {
  @Column({ name: 'etapa_id', type: 'int' })
  etapaId: number;

  @ManyToOne(() => Etapa, (etapa) => etapa.ofertas)
  @JoinColumn({ name: 'etapa_id' })
  etapa: Relation<Etapa>;

  @Column({ name: 'grado_id', type: 'int' })
  gradoId: number;

  @ManyToOne(() => Grado)
  @JoinColumn({ name: 'grado_id' })
  grado: Relation<Grado>;

  @Column({ name: 'catalogo_id', type: 'int' })
  catalogoId: number;

  @ManyToOne(() => Catalogo)
  @JoinColumn({ name: 'catalogo_id' })
  catalogo: Relation<Catalogo>;

  @Column({ name: 'cantidad_maxima', type: 'int' })
  cantidadMaxima: number;
}
