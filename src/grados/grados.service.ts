import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Libro } from '../catalogos/entities/libro.entity.js';
import {
  escaparLike,
  paginar,
  type ListadoQueryDto,
  type Paginado,
} from '../common/listado.js';
import { contar, esViolacionDeUnico, nombreIgualA } from '../common/nombres.js';
import { Oferta } from '../etapas/entities/oferta.entity.js';
import type { GuardarGradoDto } from './dto/guardar-grado.dto.js';
import { Grado } from './entities/grado.entity.js';

export interface GradoDto {
  id: number;
  nombre: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class GradosService {
  constructor(
    @InjectRepository(Grado) private readonly grados: Repository<Grado>,
    @InjectRepository(Libro) private readonly libros: Repository<Libro>,
    @InjectRepository(Oferta) private readonly ofertas: Repository<Oferta>,
  ) {}

  async listar(query: ListadoQueryDto): Promise<Paginado<GradoDto>> {
    const [filas, total] = await this.grados.findAndCount({
      where: query.search
        ? { nombre: ILike(`%${escaparLike(query.search)}%`) }
        : {},
      order: { id: 'ASC' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    });
    return paginar(filas.map(aDto), total, query);
  }

  async crear({ nombre }: GuardarGradoDto): Promise<GradoDto> {
    await this.verificarNombreLibre(nombre);
    return aDto(await this.guardar(this.grados.create({ nombre })));
  }

  async actualizar(id: number, { nombre }: GuardarGradoDto): Promise<GradoDto> {
    const grado = await this.buscar(id);
    await this.verificarNombreLibre(nombre, id);
    grado.nombre = nombre;
    return aDto(await this.guardar(grado));
  }

  /** Borrado lógico. No se permite si hay libros u ofertas vigentes que lo usan. */
  async eliminar(id: number): Promise<void> {
    const grado = await this.buscar(id);
    const [enLibros, enOfertas] = await Promise.all([
      this.libros.countBy({ gradoId: id }),
      this.ofertas.countBy({ gradoId: id }),
    ]);
    if (enLibros || enOfertas) {
      const usos = [
        enLibros && contar(enLibros, 'libro', 'libros'),
        enOfertas && contar(enOfertas, 'oferta', 'ofertas'),
      ].filter(Boolean);
      throw new ConflictException(
        `No se puede eliminar "${grado.nombre}": está en uso en ${usos.join(' y ')}.`,
      );
    }
    await this.grados.softRemove(grado);
  }

  private async buscar(id: number): Promise<Grado> {
    const grado = await this.grados.findOneBy({ id });
    if (!grado) throw new NotFoundException('El grado no existe.');
    return grado;
  }

  private async verificarNombreLibre(nombre: string, idActual?: number) {
    const existente = await this.grados.findOne({
      where: { nombre: nombreIgualA(nombre) },
    });
    if (existente && existente.id !== idActual) throw nombreRepetido();
  }

  private async guardar(grado: Grado): Promise<Grado> {
    try {
      return await this.grados.save(grado);
    } catch (error) {
      if (esViolacionDeUnico(error)) throw nombreRepetido();
      throw error;
    }
  }
}

function nombreRepetido() {
  return new ConflictException('Ya existe un grado con ese nombre.');
}

function aDto({ id, nombre, createdAt, updatedAt }: Grado): GradoDto {
  return { id, nombre, createdAt, updatedAt };
}
