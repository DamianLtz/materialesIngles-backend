import { Column, Entity, Index, OneToMany, type Relation } from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';
import { Libro } from './libro.entity.js';

/** Área o catálogo de libros, ej: "Inglés" (book_types en el original). */
@Entity('catalogos')
@Index('uq_catalogos_nombre', ['nombre'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Catalogo extends EntidadBase {
  @Column({ type: 'varchar' })
  nombre: string;

  @OneToMany(() => Libro, (libro) => libro.catalogo)
  libros: Relation<Libro[]>;
}
