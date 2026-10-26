import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { contar, esViolacionDeUnico, nombreIgualA } from '../common/nombres.js';
import { Oferta } from '../etapas/entities/oferta.entity.js';
import type { GuardarCatalogoDto } from './dto/guardar-catalogo.dto.js';
import { Catalogo } from './entities/catalogo.entity.js';
import { Libro } from './entities/libro.entity.js';

export interface CatalogoDto {
  id: number;
  nombre: string;
  cantidadLibros: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CatalogosService {
  constructor(
    @InjectRepository(Catalogo)
    private readonly catalogos: Repository<Catalogo>,
    @InjectRepository(Libro) private readonly libros: Repository<Libro>,
    @InjectRepository(Oferta) private readonly ofertas: Repository<Oferta>,
  ) {}

  /** Todos los catálogos, sin paginar: son pocos y la pantalla los muestra como tarjetas. */
  async listar(): Promise<CatalogoDto[]> {
    const [catalogos, conteos] = await Promise.all([
      this.catalogos.find({ order: { nombre: 'ASC' } }),
      this.libros
        .createQueryBuilder('l')
        .select('l.catalogoId', 'catalogoId')
        .addSelect('COUNT(*)', 'total')
        .groupBy('l.catalogoId')
        .getRawMany<{ catalogoId: number; total: string }>(),
    ]);
    const porCatalogo = new Map(
      conteos.map((c) => [c.catalogoId, Number(c.total)]),
    );
    return catalogos.map((c) => aDto(c, porCatalogo.get(c.id) ?? 0));
  }

  async obtener(id: number): Promise<CatalogoDto> {
    const catalogo = await this.buscar(id);
    return aDto(catalogo, await this.libros.countBy({ catalogoId: id }));
  }

  async crear({ nombre }: GuardarCatalogoDto): Promise<CatalogoDto> {
    await this.verificarNombreLibre(nombre);
    const creado = await this.guardar(this.catalogos.create({ nombre }));
    return aDto(creado, 0);
  }

  async actualizar(
    id: number,
    { nombre }: GuardarCatalogoDto,
  ): Promise<CatalogoDto> {
    const catalogo = await this.buscar(id);
    await this.verificarNombreLibre(nombre, id);
    catalogo.nombre = nombre;
    const guardado = await this.guardar(catalogo);
    return aDto(guardado, await this.libros.countBy({ catalogoId: id }));
  }

  /**
   * Borrado lógico. No se permite si hay libros u ofertas vigentes: el aviso del
   * original decía que borraba los libros también, pero los dejaba huérfanos.
   */
  async eliminar(id: number): Promise<void> {
    const catalogo = await this.buscar(id);
    const [enLibros, enOfertas] = await Promise.all([
      this.libros.countBy({ catalogoId: id }),
      this.ofertas.countBy({ catalogoId: id }),
    ]);
    if (enLibros || enOfertas) {
      const usos = [
        enLibros && contar(enLibros, 'libro', 'libros'),
        enOfertas && contar(enOfertas, 'oferta', 'ofertas'),
      ].filter(Boolean);
      throw new ConflictException(
        `No se puede eliminar "${catalogo.nombre}": tiene ${usos.join(' y ')}. Eliminá o reasigná esos datos primero.`,
      );
    }
    await this.catalogos.softRemove(catalogo);
  }

  private async buscar(id: number): Promise<Catalogo> {
    const catalogo = await this.catalogos.findOneBy({ id });
    if (!catalogo) throw new NotFoundException('El catálogo no existe.');
    return catalogo;
  }

  private async verificarNombreLibre(nombre: string, idActual?: number) {
    const existente = await this.catalogos.findOne({
      where: { nombre: nombreIgualA(nombre) },
    });
    if (existente && existente.id !== idActual) throw nombreRepetido();
  }

  private async guardar(catalogo: Catalogo): Promise<Catalogo> {
    try {
      return await this.catalogos.save(catalogo);
    } catch (error) {
      if (esViolacionDeUnico(error)) throw nombreRepetido();
      throw error;
    }
  }
}

function nombreRepetido() {
  return new ConflictException('Ya existe un catálogo con ese nombre.');
}

function aDto(
  { id, nombre, createdAt, updatedAt }: Catalogo,
  cantidadLibros: number,
): CatalogoDto {
  return { id, nombre, cantidadLibros, createdAt, updatedAt };
}
