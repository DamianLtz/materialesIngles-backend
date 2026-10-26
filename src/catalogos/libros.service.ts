import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  escaparLike,
  paginar,
  type ListadoQueryDto,
  type Paginado,
} from '../common/listado.js';
import { contar } from '../common/nombres.js';
import { Grado } from '../grados/entities/grado.entity.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import type { ActualizarLibroDto, CrearLibroDto } from './dto/libro.dto.js';
import { Catalogo } from './entities/catalogo.entity.js';
import { Libro } from './entities/libro.entity.js';

export interface LibroDto {
  id: number;
  isbn: string;
  titulo: string;
  editorial: string;
  catalogoId: number;
  grado: { id: number; nombre: string };
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class LibrosService {
  constructor(
    @InjectRepository(Libro) private readonly libros: Repository<Libro>,
    @InjectRepository(Catalogo)
    private readonly catalogos: Repository<Catalogo>,
    @InjectRepository(Grado) private readonly grados: Repository<Grado>,
    @InjectRepository(Pedido) private readonly pedidos: Repository<Pedido>,
  ) {}

  /** Libros de un catálogo; la búsqueda mira título, ISBN y editorial. */
  async listar(
    catalogoId: number,
    query: ListadoQueryDto,
  ): Promise<Paginado<LibroDto>> {
    if (!(await this.catalogos.existsBy({ id: catalogoId }))) {
      throw new NotFoundException('El catálogo no existe.');
    }
    const patron = query.search && ILike(`%${escaparLike(query.search)}%`);
    const [filas, total] = await this.libros.findAndCount({
      where: patron
        ? [
            { catalogoId, titulo: patron },
            { catalogoId, isbn: patron },
            { catalogoId, editorial: patron },
          ]
        : { catalogoId },
      relations: { grado: true },
      order: { id: 'ASC' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    });
    return paginar(filas.map(aDto), total, query);
  }

  async crear(datos: CrearLibroDto): Promise<LibroDto> {
    if (!(await this.catalogos.existsBy({ id: datos.catalogoId }))) {
      throw new BadRequestException('El catálogo seleccionado no existe.');
    }
    await this.verificarGrado(datos.gradoId);
    const libro = await this.libros.save(
      this.libros.create({
        catalogoId: datos.catalogoId,
        gradoId: datos.gradoId,
        titulo: datos.titulo,
        isbn: datos.isbn,
        editorial: datos.editorial,
      }),
    );
    return aDto(await this.cargar(libro.id));
  }

  async actualizar(id: number, datos: ActualizarLibroDto): Promise<LibroDto> {
    const libro = await this.libros.findOneBy({ id });
    if (!libro) throw new NotFoundException('El libro no existe.');
    await this.verificarGrado(datos.gradoId);
    Object.assign(libro, {
      titulo: datos.titulo,
      isbn: datos.isbn,
      editorial: datos.editorial,
      gradoId: datos.gradoId,
    });
    await this.libros.save(libro);
    return aDto(await this.cargar(id));
  }

  /** Borrado lógico. No se permite si alguna escuela lo tiene en un pedido vigente. */
  async eliminar(id: number): Promise<void> {
    const libro = await this.libros.findOneBy({ id });
    if (!libro) throw new NotFoundException('El libro no existe.');
    const enPedidos = await this.pedidos.countBy({ libroId: id });
    if (enPedidos) {
      throw new ConflictException(
        `No se puede eliminar "${libro.titulo}": está en ${contar(enPedidos, 'pedido', 'pedidos')} de escuelas.`,
      );
    }
    await this.libros.softRemove(libro);
  }

  private async verificarGrado(gradoId: number) {
    if (!(await this.grados.existsBy({ id: gradoId }))) {
      throw new BadRequestException('El grado seleccionado no existe.');
    }
  }

  private cargar(id: number): Promise<Libro> {
    return this.libros.findOneOrFail({
      where: { id },
      relations: { grado: true },
    });
  }
}

function aDto(libro: Libro): LibroDto {
  return {
    id: libro.id,
    isbn: libro.isbn,
    titulo: libro.titulo,
    editorial: libro.editorial,
    catalogoId: libro.catalogoId,
    grado: { id: libro.grado.id, nombre: libro.grado.nombre },
    createdAt: libro.createdAt,
    updatedAt: libro.updatedAt,
  };
}
