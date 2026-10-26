import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';
import { Grado } from '../../grados/entities/grado.entity.js';
import { Catalogo } from './catalogo.entity.js';

@Entity('libros')
// Los libros ofrecidos en una oferta se filtran siempre por grado + catálogo
@Index('ix_libros_catalogo_grado', ['catalogoId', 'gradoId'])
// La asignación masiva busca libros por ISBN
@Index('ix_libros_isbn', ['isbn'])
export class Libro extends EntidadBase {
  @Column({ type: 'varchar' })
  isbn: string;

  @Column({ type: 'varchar' })
  titulo: string;

  @Column({ type: 'varchar' })
  editorial: string;

  @Column({ name: 'grado_id', type: 'int' })
  gradoId: number;

  @ManyToOne(() => Grado)
  @JoinColumn({ name: 'grado_id' })
  grado: Relation<Grado>;

  @Column({ name: 'catalogo_id', type: 'int' })
  catalogoId: number;

  @ManyToOne(() => Catalogo, (catalogo) => catalogo.libros)
  @JoinColumn({ name: 'catalogo_id' })
  catalogo: Relation<Catalogo>;
}
