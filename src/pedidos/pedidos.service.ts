import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, In, Repository, type EntityManager } from 'typeorm';
import { Libro } from '../catalogos/entities/libro.entity.js';
import { crearXlsx } from '../common/excel.js';
import { escaparLike, paginar, type Paginado } from '../common/listado.js';
import { contar } from '../common/nombres.js';
import { Escuela } from '../escuelas/entities/escuela.entity.js';
import { Etapa } from '../etapas/entities/etapa.entity.js';
import { Oferta } from '../etapas/entities/oferta.entity.js';
import { Reclamo } from '../reclamos/entities/reclamo.entity.js';
import type {
  CambioPedidoDto,
  ListadoPedidosQueryDto,
} from './dto/pedido.dto.js';
import { aplicarAccion } from './aplicar-accion.js';
import { Pedido } from './entities/pedido.entity.js';
import { decidirAccion, type PedidoActual } from './reemplazo.js';

export interface PedidoListadoDto {
  id: number;
  escuela: { id: number; nombre: string; cueanexo: string };
  grado: string;
  catalogo: string;
  libro: { titulo: string; isbn: string; borrado: boolean };
  cantidad: number;
  createdAt: Date;
}

export interface EtapaFiltroDto {
  id: number;
  nombre: string;
  visible: boolean;
}

export interface OfertaDeEscuelaDto {
  id: number;
  gradoNombre: string;
  catalogoNombre: string;
  cantidadMaxima: number;
  pedido: {
    id: number;
    libro: {
      id: number;
      titulo: string;
      isbn: string;
      editorial: string;
      borrado: boolean;
    };
    cantidad: number;
    reclamos: number;
  } | null;
}

export interface PedidosDeEscuelaDto {
  escuela: { id: number; nombre: string; cueanexo: string };
  /** La etapa publicada en la que participa la escuela, o null si no hay. */
  etapa: { id: number; nombre: string } | null;
  ofertas: OfertaDeEscuelaDto[];
}

export interface ResultadoSincronizacion {
  creados: number;
  actualizados: number;
  reemplazados: number;
  quitados: number;
}

export interface LibroBuscadoDto {
  id: number;
  titulo: string;
  isbn: string;
  editorial: string;
}

/** Fila cruda de la consulta del listado (los alias llegan en minúsculas con comillas). */
interface FilaListado {
  id: number;
  escuelaId: number;
  escuelaNombre: string;
  cueanexo: string;
  grado: string;
  catalogo: string;
  libroTitulo: string;
  libroIsbn: string;
  libroBorrado: Date | null;
  cantidad: number;
  createdAt: Date;
}

const MAX_LIBROS_BUSQUEDA = 20;

@Injectable()
export class PedidosService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Pedido) private readonly pedidos: Repository<Pedido>,
    @InjectRepository(Etapa) private readonly etapas: Repository<Etapa>,
    @InjectRepository(Oferta) private readonly ofertas: Repository<Oferta>,
    @InjectRepository(Escuela) private readonly escuelas: Repository<Escuela>,
    @InjectRepository(Libro) private readonly libros: Repository<Libro>,
    @InjectRepository(Reclamo) private readonly reclamos: Repository<Reclamo>,
  ) {}

  /** Etapas para el filtro del listado: la publicada primero. */
  async etapasParaFiltro(): Promise<EtapaFiltroDto[]> {
    const filas = await this.etapas.find({
      select: { id: true, nombre: true, visible: true },
      order: { visible: 'DESC', id: 'DESC' },
    });
    return filas.map(({ id, nombre, visible }) => ({ id, nombre, visible }));
  }

  /** Por defecto la etapa publicada; si no hay, la de inicio más reciente. */
  private async etapaPorDefecto(): Promise<number | null> {
    const publicada = await this.etapas.findOneBy({ visible: true });
    if (publicada) return publicada.id;
    const [ultima] = await this.etapas.find({
      order: { fechaInicio: { direction: 'DESC', nulls: 'LAST' }, id: 'DESC' },
      take: 1,
    });
    return ultima?.id ?? null;
  }

  /** Pedidos vigentes de una etapa con la escuela, la oferta y el libro (aunque esté deshabilitado). */
  private consultaPedidos(etapaId: number) {
    return this.pedidos
      .createQueryBuilder('p')
      .withDeleted() // el libro puede estar deshabilitado: igual hay que mostrarlo
      .innerJoin('p.escuela', 'e')
      .innerJoin('p.oferta', 'o')
      .innerJoin('o.grado', 'g')
      .innerJoin('o.catalogo', 'c')
      .innerJoin('p.libro', 'l')
      .where('p.deleted_at IS NULL')
      .andWhere('o.deleted_at IS NULL')
      .andWhere('o.etapa_id = :etapaId', { etapaId });
  }

  async listar(
    query: ListadoPedidosQueryDto,
  ): Promise<Paginado<PedidoListadoDto> & { etapaId: number | null }> {
    const etapaId = query.etapaId ?? (await this.etapaPorDefecto());
    if (etapaId === null) return { ...paginar([], 0, query), etapaId: null };

    const consulta = this.consultaPedidos(etapaId);
    if (query.search) {
      consulta.andWhere(
        '(e.nombre ILIKE :texto OR e.cueanexo ILIKE :texto OR l.titulo ILIKE :texto OR l.isbn ILIKE :texto)',
        { texto: `%${escaparLike(query.search)}%` },
      );
    }
    const total = await consulta.getCount();
    const filas = await consulta
      .select('p.id', 'id')
      .addSelect('e.id', 'escuelaId')
      .addSelect('e.nombre', 'escuelaNombre')
      .addSelect('e.cueanexo', 'cueanexo')
      .addSelect('g.nombre', 'grado')
      .addSelect('c.nombre', 'catalogo')
      .addSelect('l.titulo', 'libroTitulo')
      .addSelect('l.isbn', 'libroIsbn')
      .addSelect('l.deleted_at', 'libroBorrado')
      .addSelect('p.cantidad', 'cantidad')
      .addSelect('p.created_at', 'createdAt')
      .orderBy('p.created_at', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .offset((query.page - 1) * query.perPage)
      .limit(query.perPage)
      .getRawMany<FilaListado>();

    const data = filas.map((f) => ({
      id: f.id,
      escuela: {
        id: f.escuelaId,
        nombre: f.escuelaNombre,
        cueanexo: f.cueanexo,
      },
      grado: f.grado,
      catalogo: f.catalogo,
      libro: {
        titulo: f.libroTitulo,
        isbn: f.libroIsbn,
        borrado: f.libroBorrado !== null,
      },
      cantidad: f.cantidad,
      createdAt: f.createdAt,
    }));
    return { ...paginar(data, total, query), etapaId };
  }

  /** Borrado lógico. No se permite si el pedido tiene reclamos (quedarían colgando). */
  async eliminar(id: number): Promise<void> {
    const pedido = await this.pedidos.findOneBy({ id });
    if (!pedido) throw new NotFoundException('El pedido no existe.');
    const reclamos = await this.reclamos.countBy({ pedidoId: id });
    if (reclamos) {
      throw new ConflictException(
        `No se puede eliminar el pedido: tiene ${contar(reclamos, 'reclamo', 'reclamos')}.`,
      );
    }
    await this.pedidos.softRemove(pedido);
  }

  /** Excel con los pedidos vigentes de la etapa, por comuna, escuela y grado. */
  async exportar(
    etapaId: number,
  ): Promise<{ archivo: Buffer; etapaNombre: string }> {
    const etapa = await this.etapas.findOneBy({ id: etapaId });
    if (!etapa) throw new NotFoundException('La etapa no existe.');
    const filas = await this.consultaPedidos(etapaId)
      .select('e.cueanexo', 'cueanexo')
      .addSelect('e.nombre', 'escuela')
      .addSelect('e.comuna', 'comuna')
      .addSelect('e.descripcion', 'dependencia')
      .addSelect('e.calle', 'calle')
      .addSelect('e.altura', 'altura')
      .addSelect('e.codigo_postal', 'codigoPostal')
      .addSelect('l.isbn', 'isbn')
      .addSelect('g.nombre', 'grado')
      .addSelect('c.nombre', 'catalogo')
      .addSelect('l.editorial', 'editorial')
      .addSelect('l.titulo', 'titulo')
      .addSelect('p.cantidad', 'cantidad')
      .orderBy('e.comuna', 'ASC', 'NULLS LAST')
      .addOrderBy('e.nombre', 'ASC')
      .addOrderBy('g.nombre', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .getRawMany<{
        cueanexo: string;
        escuela: string;
        comuna: number | null;
        dependencia: string | null;
        calle: string;
        altura: number;
        codigoPostal: string;
        isbn: string;
        grado: string;
        catalogo: string;
        editorial: string;
        titulo: string;
        cantidad: number;
      }>();
    const archivo = await crearXlsx(
      [
        'Etapa',
        'CUE Anexo',
        'Escuela',
        'Comuna',
        'Dependencia Funcional',
        'Calle',
        'Altura',
        'Código Postal',
        'ISBN',
        'Grado',
        'Catálogo',
        'Editorial',
        'Título',
        'Cantidad',
      ],
      filas.map((f) => [
        etapa.nombre,
        f.cueanexo,
        f.escuela,
        f.comuna,
        f.dependencia,
        f.calle,
        f.altura,
        f.codigoPostal,
        f.isbn,
        f.grado,
        f.catalogo,
        f.editorial,
        f.titulo,
        f.cantidad,
      ]),
      [24, 14, 44, 10, 28, 28, 8, 12, 16, 14, 16, 24, 44, 10],
    );
    return { archivo, etapaNombre: etapa.nombre };
  }

  /** Lo que ve el gestor de libros de una escuela: las ofertas de la etapa publicada y su pedido. */
  async deEscuela(escuelaId: number): Promise<PedidosDeEscuelaDto> {
    const escuela = await this.buscarEscuela(escuelaId);
    const salida = {
      escuela: {
        id: escuela.id,
        nombre: escuela.nombre,
        cueanexo: escuela.cueanexo,
      },
    };
    const etapa = await this.etapaPublicadaDeEscuela(
      this.dataSource.manager,
      escuelaId,
    );
    if (!etapa) return { ...salida, etapa: null, ofertas: [] };

    const ofertas = await this.ofertas.find({
      where: { etapaId: etapa.id },
      relations: { grado: true, catalogo: true },
      order: { id: 'ASC' },
    });
    const pedidos = ofertas.length
      ? await this.pedidos.find({
          where: { escuelaId, ofertaId: In(ofertas.map((o) => o.id)) },
          relations: { libro: true },
          withDeleted: true, // incluye libros deshabilitados; los pedidos borrados se filtran abajo
        })
      : [];
    const vigentes = pedidos.filter((p) => p.deletedAt === null);
    const reclamos = await this.contarReclamos(
      this.dataSource.manager,
      vigentes.map((p) => p.id),
    );
    const porOferta = new Map(vigentes.map((p) => [p.ofertaId, p]));

    return {
      ...salida,
      etapa: { id: etapa.id, nombre: etapa.nombre },
      ofertas: ofertas.map((o) => {
        const p = porOferta.get(o.id);
        return {
          id: o.id,
          gradoNombre: o.grado.nombre,
          catalogoNombre: o.catalogo.nombre,
          cantidadMaxima: o.cantidadMaxima,
          pedido: p
            ? {
                id: p.id,
                libro: {
                  id: p.libro.id,
                  titulo: p.libro.titulo,
                  isbn: p.libro.isbn,
                  editorial: p.libro.editorial,
                  borrado: p.libro.deletedAt !== null,
                },
                cantidad: p.cantidad,
                reclamos: reclamos.get(p.id) ?? 0,
              }
            : null,
        };
      }),
    };
  }

  /**
   * Aplica los cambios de libros de una escuela sobre la etapa publicada, todos o ninguno.
   * Valida todo antes de escribir y junta los errores (400) y los bloqueos por reclamos (409).
   */
  async sincronizar(
    escuelaId: number,
    cambios: CambioPedidoDto[],
  ): Promise<ResultadoSincronizacion> {
    return this.dataSource.transaction(async (manager) => {
      await this.buscarEscuela(escuelaId);
      const etapa = await this.etapaPublicadaDeEscuela(manager, escuelaId);
      if (!etapa) {
        throw new ConflictException(
          'La escuela no participa de ninguna etapa publicada.',
        );
      }

      const errores: string[] = [];
      const ofertaIds = cambios.map((c) => c.ofertaId);
      if (new Set(ofertaIds).size !== ofertaIds.length) {
        throw new BadRequestException(
          'No se puede repetir una oferta en el mismo guardado.',
        );
      }
      const ofertas = new Map(
        (
          await manager.find(Oferta, {
            where: { id: In(ofertaIds), etapaId: etapa.id },
            relations: { grado: true, catalogo: true },
          })
        ).map((o) => [o.id, o]),
      );
      const libroIds = cambios.flatMap((c) =>
        c.libroId === null ? [] : [c.libroId],
      );
      const libros = new Map(
        (libroIds.length
          ? await manager.find(Libro, { where: { id: In(libroIds) } })
          : []
        ).map((l) => [l.id, l]),
      );

      for (const cambio of cambios) {
        const oferta = ofertas.get(cambio.ofertaId);
        if (!oferta) {
          errores.push(
            `La oferta ${cambio.ofertaId} no pertenece a la etapa publicada.`,
          );
          continue;
        }
        if (cambio.libroId === null) continue;
        const nombre = `${oferta.grado.nombre} – ${oferta.catalogo.nombre}`;
        const libro = libros.get(cambio.libroId);
        if (!libro) {
          errores.push(`${nombre}: el libro no existe o está deshabilitado.`);
        } else if (
          libro.gradoId !== oferta.gradoId ||
          libro.catalogoId !== oferta.catalogoId
        ) {
          errores.push(
            `${nombre}: "${libro.titulo}" no corresponde a ese grado y catálogo.`,
          );
        }
        const cantidad = cambio.cantidad ?? 0;
        if (cantidad > oferta.cantidadMaxima) {
          errores.push(
            `${nombre}: la cantidad máxima es ${oferta.cantidadMaxima}.`,
          );
        }
      }
      if (errores.length) throw new BadRequestException(errores);

      const existentes = new Map(
        (
          await manager.find(Pedido, {
            where: { escuelaId, ofertaId: In(ofertaIds) },
          })
        ).map((p) => [p.ofertaId, p]),
      );
      const reclamos = await this.contarReclamos(
        manager,
        [...existentes.values()].map((p) => p.id),
      );

      const acciones = cambios.map((cambio) => {
        const existente = existentes.get(cambio.ofertaId);
        const actual: PedidoActual | undefined = existente && {
          id: existente.id,
          libroId: existente.libroId,
          cantidad: existente.cantidad,
          reclamos: reclamos.get(existente.id) ?? 0,
        };
        const deseado =
          cambio.libroId === null
            ? null
            : { libroId: cambio.libroId, cantidad: cambio.cantidad ?? 1 };
        return {
          cambio,
          existente,
          deseado,
          accion: decidirAccion(actual, deseado),
        };
      });

      const bloqueos = acciones.flatMap(({ cambio, accion }) => {
        if (accion.tipo !== 'bloqueado') return [];
        const oferta = ofertas.get(cambio.ofertaId)!;
        const nombre = `${oferta.grado.nombre} – ${oferta.catalogo.nombre}`;
        const n = reclamos.get(existentes.get(cambio.ofertaId)!.id) ?? 0;
        return [
          `No se puede ${accion.motivo === 'quitar' ? 'quitar el pedido' : 'cambiar el libro'} de "${nombre}": tiene ${contar(n, 'reclamo', 'reclamos')}.`,
        ];
      });
      if (bloqueos.length) throw new ConflictException(bloqueos.join(' '));

      const resultado: ResultadoSincronizacion = {
        creados: 0,
        actualizados: 0,
        reemplazados: 0,
        quitados: 0,
      };
      const contador = {
        quitar: 'quitados',
        actualizar: 'actualizados',
        reemplazar: 'reemplazados',
        crear: 'creados',
      } as const;
      for (const { cambio, existente, deseado, accion } of acciones) {
        await aplicarAccion(manager, accion.tipo, {
          existente,
          escuelaId,
          ofertaId: cambio.ofertaId,
          libroId: deseado?.libroId,
          cantidad: deseado?.cantidad,
        });
        if (accion.tipo in contador) {
          resultado[contador[accion.tipo as keyof typeof contador]] += 1;
        }
      }
      return resultado;
    });
  }

  /** Libros del grado y catálogo de la oferta, para elegir uno (hasta 20). */
  async buscarLibros(
    ofertaId: number,
    search?: string,
  ): Promise<LibroBuscadoDto[]> {
    const oferta = await this.ofertas.findOneBy({ id: ofertaId });
    if (!oferta) throw new NotFoundException('La oferta no existe.');
    const base = { gradoId: oferta.gradoId, catalogoId: oferta.catalogoId };
    const patron = search && ILike(`%${escaparLike(search)}%`);
    const libros = await this.libros.find({
      where: patron
        ? [
            { ...base, titulo: patron },
            { ...base, isbn: patron },
            { ...base, editorial: patron },
          ]
        : base,
      order: { titulo: 'ASC', id: 'ASC' },
      take: MAX_LIBROS_BUSQUEDA,
    });
    return libros.map(({ id, titulo, isbn, editorial }) => ({
      id,
      titulo,
      isbn,
      editorial,
    }));
  }

  private async buscarEscuela(id: number): Promise<Escuela> {
    const escuela = await this.escuelas.findOneBy({ id });
    if (!escuela) throw new NotFoundException('La escuela no existe.');
    return escuela;
  }

  /** La etapa publicada, solo si la escuela participa de ella. */
  private async etapaPublicadaDeEscuela(
    manager: EntityManager,
    escuelaId: number,
  ): Promise<Etapa | null> {
    const etapa = await manager.findOneBy(Etapa, { visible: true });
    if (!etapa) return null;
    const filas: unknown[] = await manager.query(
      'SELECT 1 FROM etapa_escuela WHERE etapa_id = $1 AND escuela_id = $2',
      [etapa.id, escuelaId],
    );
    return filas.length ? etapa : null;
  }

  /** Reclamos vigentes de cada pedido. */
  private async contarReclamos(
    manager: EntityManager,
    pedidoIds: number[],
  ): Promise<Map<number, number>> {
    if (!pedidoIds.length) return new Map();
    const filas = await manager
      .createQueryBuilder(Reclamo, 'r')
      .select('r.pedido_id', 'pedidoId')
      .addSelect('COUNT(*)::int', 'cantidad')
      .where('r.pedido_id IN (:...pedidoIds)', { pedidoIds })
      .groupBy('r.pedido_id')
      .getRawMany<{ pedidoId: number; cantidad: number }>();
    return new Map(filas.map((f) => [f.pedidoId, f.cantidad]));
  }
}
