import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ILike,
  Repository,
  type FindOptionsOrder,
  type FindOptionsWhere,
} from 'typeorm';
import { crearXlsx } from '../common/excel.js';
import {
  escaparLike,
  paginar,
  type ListadoQueryDto,
  type Paginado,
} from '../common/listado.js';
import { contar, esViolacionDeUnico } from '../common/nombres.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import type { GuardarEscuelaDto } from './dto/escuela.dto.js';
import { Escuela } from './entities/escuela.entity.js';

export interface EscuelaDto {
  id: number;
  cueanexo: string;
  nombre: string;
  comuna: number | null;
  descripcion: string | null;
  calle: string;
  altura: number;
  codigoPostal: string;
  /** Participa de una etapa publicada: solo entonces se le pueden asignar libros. */
  participaEnEtapaActiva: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpcionEscuelaDto {
  id: number;
  nombre: string;
  cueanexo: string;
  comuna: number | null;
}

@Injectable()
export class EscuelasService {
  constructor(
    @InjectRepository(Escuela) private readonly escuelas: Repository<Escuela>,
    @InjectRepository(Pedido) private readonly pedidos: Repository<Pedido>,
  ) {}

  async listar(query: ListadoQueryDto): Promise<Paginado<EscuelaDto>> {
    const [filas, total] = await this.escuelas.findAndCount({
      where: filtroDeBusqueda(query.search),
      order: { id: 'ASC' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    });
    const activas = await this.conEtapaActiva(filas.map((e) => e.id));
    return paginar(
      filas.map((e) => aDto(e, activas.has(e.id))),
      total,
      query,
    );
  }

  /** Todas las escuelas con lo mínimo para elegirlas, ordenadas por comuna y nombre. */
  async opciones(): Promise<OpcionEscuelaDto[]> {
    return this.escuelas.find({
      select: { id: true, nombre: true, cueanexo: true, comuna: true },
      order: POR_COMUNA_Y_NOMBRE,
    });
  }

  /** Excel con las escuelas que coinciden con la búsqueda, ordenadas por comuna y nombre. */
  async exportar(search?: string): Promise<Buffer> {
    const filas = await this.escuelas.find({
      where: filtroDeBusqueda(search),
      order: POR_COMUNA_Y_NOMBRE,
    });
    return crearXlsx(
      [
        'Nombre',
        'CUE/Anexo',
        'Comuna',
        'Calle',
        'Número',
        'Código Postal',
        'Fecha de Alta',
      ],
      filas.map((e) => [
        e.nombre,
        e.cueanexo,
        e.comuna,
        e.calle,
        e.altura,
        e.codigoPostal,
        e.createdAt,
      ]),
      [50, 14, 10, 30, 10, 14, 14],
    );
  }

  async crear(datos: GuardarEscuelaDto): Promise<EscuelaDto> {
    await this.verificarCueLibre(datos.cueanexo);
    const creada = await this.guardar(
      this.escuelas.create(valoresEditables(datos)),
    );
    return aDto(creada, false);
  }

  async actualizar(id: number, datos: GuardarEscuelaDto): Promise<EscuelaDto> {
    const escuela = await this.buscar(id);
    await this.verificarCueLibre(datos.cueanexo, id);
    Object.assign(escuela, valoresEditables(datos));
    const guardada = await this.guardar(escuela);
    const activas = await this.conEtapaActiva([id]);
    return aDto(guardada, activas.has(id));
  }

  /** Borrado lógico. No se permite si la escuela tiene pedidos vigentes. */
  async eliminar(id: number): Promise<void> {
    const escuela = await this.buscar(id);
    const enPedidos = await this.pedidos.countBy({ escuelaId: id });
    if (enPedidos) {
      throw new ConflictException(
        `No se puede eliminar "${escuela.nombre}": tiene ${contar(enPedidos, 'pedido', 'pedidos')} de libros.`,
      );
    }
    await this.escuelas.softRemove(escuela);
  }

  private async buscar(id: number): Promise<Escuela> {
    const escuela = await this.escuelas.findOneBy({ id });
    if (!escuela) throw new NotFoundException('La escuela no existe.');
    return escuela;
  }

  /** Ids (de los recibidos) que participan de al menos una etapa publicada y no borrada. */
  private async conEtapaActiva(ids: number[]): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const filas: { id: number }[] = await this.escuelas.query(
      `SELECT DISTINCT ee.escuela_id AS id
         FROM etapa_escuela ee
         INNER JOIN etapas et ON et.id = ee.etapa_id
        WHERE et.visible = true
          AND et.deleted_at IS NULL
          AND ee.escuela_id = ANY($1)`,
      [ids],
    );
    return new Set(filas.map((f) => f.id));
  }

  private async verificarCueLibre(cueanexo: string, idActual?: number) {
    const existente = await this.escuelas.findOneBy({ cueanexo });
    if (existente && existente.id !== idActual) throw cueRepetido();
  }

  /** Cubre la carrera entre dos altas simultáneas del mismo CUE. */
  private async guardar(escuela: Escuela): Promise<Escuela> {
    try {
      return await this.escuelas.save(escuela);
    } catch (error) {
      if (esViolacionDeUnico(error)) throw cueRepetido();
      throw error;
    }
  }
}

/** Las escuelas sin comuna (migradas y todavía no cargadas) van al final. */
const POR_COMUNA_Y_NOMBRE: FindOptionsOrder<Escuela> = {
  comuna: { direction: 'ASC', nulls: 'LAST' },
  nombre: 'ASC',
};

/** Como en el original, se busca en el nombre y en el CUE/Anexo. */
function filtroDeBusqueda(
  search?: string,
): FindOptionsWhere<Escuela> | FindOptionsWhere<Escuela>[] {
  if (!search) return {};
  const patron = ILike(`%${escaparLike(search)}%`);
  return [{ nombre: patron }, { cueanexo: patron }];
}

function valoresEditables(datos: GuardarEscuelaDto) {
  return {
    cueanexo: datos.cueanexo,
    nombre: datos.nombre,
    comuna: datos.comuna,
    descripcion: datos.descripcion ?? null,
    calle: datos.calle,
    altura: datos.altura,
    codigoPostal: datos.codigoPostal,
  };
}

function cueRepetido() {
  return new ConflictException('Ya existe una escuela con ese CUE/Anexo.');
}

function aDto(e: Escuela, participaEnEtapaActiva: boolean): EscuelaDto {
  return {
    id: e.id,
    cueanexo: e.cueanexo,
    nombre: e.nombre,
    comuna: e.comuna,
    descripcion: e.descripcion,
    calle: e.calle,
    altura: e.altura,
    codigoPostal: e.codigoPostal,
    participaEnEtapaActiva,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
