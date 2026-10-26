import {
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
import { contar, esViolacionDeUnico, nombreIgualA } from '../common/nombres.js';
import type { GuardarTipoReclamoDto } from './dto/guardar-tipo-reclamo.dto.js';
import { Reclamo } from './entities/reclamo.entity.js';
import { TipoReclamo } from './entities/tipo-reclamo.entity.js';

export interface TipoReclamoDto {
  id: number;
  nombre: string;
  leyenda: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class TiposReclamoService {
  constructor(
    @InjectRepository(TipoReclamo)
    private readonly tipos: Repository<TipoReclamo>,
    @InjectRepository(Reclamo) private readonly reclamos: Repository<Reclamo>,
  ) {}

  async listar(query: ListadoQueryDto): Promise<Paginado<TipoReclamoDto>> {
    // Se busca en el nombre y en la leyenda, como en el original
    const patron = query.search && ILike(`%${escaparLike(query.search)}%`);
    const [filas, total] = await this.tipos.findAndCount({
      where: patron ? [{ nombre: patron }, { leyenda: patron }] : {},
      order: { id: 'ASC' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    });
    return paginar(filas.map(aDto), total, query);
  }

  async crear(datos: GuardarTipoReclamoDto): Promise<TipoReclamoDto> {
    await this.verificarNombreLibre(datos.nombre);
    return aDto(
      await this.guardar(
        this.tipos.create({
          nombre: datos.nombre,
          leyenda: datos.leyenda ?? null,
        }),
      ),
    );
  }

  async actualizar(
    id: number,
    datos: GuardarTipoReclamoDto,
  ): Promise<TipoReclamoDto> {
    const tipo = await this.buscar(id);
    await this.verificarNombreLibre(datos.nombre, id);
    tipo.nombre = datos.nombre;
    tipo.leyenda = datos.leyenda ?? null;
    return aDto(await this.guardar(tipo));
  }

  /** Borrado lógico. No se permite si hay reclamos vigentes de este tipo. */
  async eliminar(id: number): Promise<void> {
    const tipo = await this.buscar(id);
    const enReclamos = await this.reclamos.countBy({ tipoReclamoId: id });
    if (enReclamos) {
      throw new ConflictException(
        `No se puede eliminar "${tipo.nombre}": está en uso en ${contar(enReclamos, 'reclamo', 'reclamos')}.`,
      );
    }
    await this.tipos.softRemove(tipo);
  }

  private async buscar(id: number): Promise<TipoReclamo> {
    const tipo = await this.tipos.findOneBy({ id });
    if (!tipo) throw new NotFoundException('El tipo de reclamo no existe.');
    return tipo;
  }

  private async verificarNombreLibre(nombre: string, idActual?: number) {
    const existente = await this.tipos.findOne({
      where: { nombre: nombreIgualA(nombre) },
    });
    if (existente && existente.id !== idActual) throw nombreRepetido();
  }

  private async guardar(tipo: TipoReclamo): Promise<TipoReclamo> {
    try {
      return await this.tipos.save(tipo);
    } catch (error) {
      if (esViolacionDeUnico(error)) throw nombreRepetido();
      throw error;
    }
  }
}

function nombreRepetido() {
  return new ConflictException('Ya existe un tipo de reclamo con ese nombre.');
}

function aDto({
  id,
  nombre,
  leyenda,
  createdAt,
  updatedAt,
}: TipoReclamo): TipoReclamoDto {
  return { id, nombre, leyenda, createdAt, updatedAt };
}
