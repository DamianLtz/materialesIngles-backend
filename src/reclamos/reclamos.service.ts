import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { crearXlsx } from '../common/excel.js';
import { hoyEnArgentina, periodoAbierto } from '../common/fechas.js';
import { escaparLike, paginar, type Paginado } from '../common/listado.js';
import { Etapa } from '../etapas/entities/etapa.entity.js';
import type {
  CambiarEstadoDto,
  ListadoReclamosQueryDto,
} from './dto/reclamo.dto.js';
import { EstadoReclamo, Reclamo } from './entities/reclamo.entity.js';

export interface ReclamoListadoDto {
  id: number;
  /** "Lote" del original: el id del pedido sobre el que se reclama. */
  pedidoId: number;
  escuela: { id: number; nombre: string; cueanexo: string };
  grado: string;
  catalogo: string;
  libro: { titulo: string; isbn: string };
  tipo: string;
  cantidad: number | null;
  estado: EstadoReclamo;
  createdAt: Date;
}

export interface EtapaFiltroDto {
  id: number;
  nombre: string;
  visible: boolean;
}

/** Fecha y orden de lo que decide la etapa por defecto (ver `etapaPorDefecto`). */
export interface EtapaConFechas {
  id: number;
  fechaInicio: string | null;
  reclamoInicio: string | null;
  reclamoFin: string | null;
}

/** Etiquetas del Excel (la base guarda el valor en minúsculas con guion bajo). */
const ETIQUETA_ESTADO: Record<EstadoReclamo, string> = {
  [EstadoReclamo.Pendiente]: 'Pendiente',
  [EstadoReclamo.EnProceso]: 'En proceso',
  [EstadoReclamo.Resuelto]: 'Resuelto',
  [EstadoReclamo.Rechazado]: 'Rechazado',
  [EstadoReclamo.Historico]: 'Histórico',
};

/** aaaa-mm-dd se compara como texto: equivale a compararlas como fechas. */
const masReciente = (a: string | null, b: string | null) =>
  (b ?? '').localeCompare(a ?? '');

/**
 * Etapa que muestra el listado cuando no se pide una:
 * 1. la que tiene el período de reclamo abierto hoy (la de inicio de reclamo más reciente);
 * 2. si no, la del último período de reclamo ya cerrado;
 * 3. si no, la de inicio de selección más reciente.
 * Los períodos futuros se ignoran. "Hoy" es el de Argentina, no el del servidor (UTC).
 */
export function etapaPorDefecto(
  etapas: EtapaConFechas[],
  hoy: string,
): number | null {
  const abierta = etapas
    .filter((e) => periodoAbierto(e.reclamoInicio, e.reclamoFin, hoy))
    .sort((a, b) => masReciente(a.reclamoInicio, b.reclamoInicio))[0];
  if (abierta) return abierta.id;

  const cerrada = etapas
    .filter((e) => e.reclamoFin !== null && e.reclamoFin < hoy)
    .sort(
      (a, b) =>
        masReciente(a.reclamoFin, b.reclamoFin) ||
        masReciente(a.reclamoInicio, b.reclamoInicio),
    )[0];
  if (cerrada) return cerrada.id;

  const reciente = [...etapas].sort(
    (a, b) => masReciente(a.fechaInicio, b.fechaInicio) || b.id - a.id,
  )[0];
  return reciente?.id ?? null;
}

@Injectable()
export class ReclamosService {
  constructor(
    @InjectRepository(Reclamo) private readonly reclamos: Repository<Reclamo>,
    @InjectRepository(Etapa) private readonly etapas: Repository<Etapa>,
  ) {}

  /** Etapas para el filtro del listado: la publicada primero. */
  async etapasParaFiltro(): Promise<EtapaFiltroDto[]> {
    const filas = await this.etapas.find({
      select: { id: true, nombre: true, visible: true },
      order: { visible: 'DESC', id: 'DESC' },
    });
    return filas.map(({ id, nombre, visible }) => ({ id, nombre, visible }));
  }

  /** Reclamos vigentes de una etapa con la escuela, la oferta, el libro y el tipo. */
  private consulta(etapaId: number) {
    return this.reclamos
      .createQueryBuilder('r')
      .withDeleted() // el libro o el tipo pueden estar deshabilitados: igual hay que mostrarlos
      .innerJoin('r.pedido', 'p')
      .innerJoin('p.escuela', 'e')
      .innerJoin('p.oferta', 'o')
      .innerJoin('o.grado', 'g')
      .innerJoin('o.catalogo', 'c')
      .innerJoin('p.libro', 'l')
      .innerJoin('r.tipoReclamo', 't')
      .where('r.deleted_at IS NULL')
      .andWhere('p.deleted_at IS NULL')
      .andWhere('o.deleted_at IS NULL')
      .andWhere('o.etapa_id = :etapaId', { etapaId });
  }

  async listar(
    query: ListadoReclamosQueryDto,
  ): Promise<Paginado<ReclamoListadoDto> & { etapaId: number | null }> {
    const etapaId = query.etapaId ?? (await this.resolverEtapa());
    if (etapaId === null) return { ...paginar([], 0, query), etapaId: null };

    const consulta = this.consulta(etapaId);
    if (query.estado) {
      consulta.andWhere('r.estado = :estado', { estado: query.estado });
    }
    if (query.search) {
      consulta.andWhere(
        '(e.nombre ILIKE :texto OR e.cueanexo ILIKE :texto OR l.titulo ILIKE :texto OR l.isbn ILIKE :texto)',
        { texto: `%${escaparLike(query.search)}%` },
      );
    }
    const total = await consulta.getCount();
    const filas = await consulta
      .select('r.id', 'id')
      .addSelect('p.id', 'pedidoId')
      .addSelect('e.id', 'escuelaId')
      .addSelect('e.nombre', 'escuelaNombre')
      .addSelect('e.cueanexo', 'cueanexo')
      .addSelect('g.nombre', 'grado')
      .addSelect('c.nombre', 'catalogo')
      .addSelect('l.titulo', 'libroTitulo')
      .addSelect('l.isbn', 'libroIsbn')
      .addSelect('t.nombre', 'tipo')
      .addSelect('r.cantidad', 'cantidad')
      .addSelect('r.estado', 'estado')
      .addSelect('r.created_at', 'createdAt')
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .offset((query.page - 1) * query.perPage)
      .limit(query.perPage)
      .getRawMany<{
        id: number;
        pedidoId: number;
        escuelaId: number;
        escuelaNombre: string;
        cueanexo: string;
        grado: string;
        catalogo: string;
        libroTitulo: string;
        libroIsbn: string;
        tipo: string;
        cantidad: number | null;
        estado: EstadoReclamo;
        createdAt: Date;
      }>();

    const data = filas.map((f) => ({
      id: f.id,
      pedidoId: f.pedidoId,
      escuela: {
        id: f.escuelaId,
        nombre: f.escuelaNombre,
        cueanexo: f.cueanexo,
      },
      grado: f.grado,
      catalogo: f.catalogo,
      libro: { titulo: f.libroTitulo, isbn: f.libroIsbn },
      tipo: f.tipo,
      cantidad: f.cantidad,
      estado: f.estado,
      createdAt: f.createdAt,
    }));
    return { ...paginar(data, total, query), etapaId };
  }

  /** Cambia el estado entre los cuatro editables. Un reclamo archivado ya no se toca. */
  async cambiarEstado(
    id: number,
    { estado }: CambiarEstadoDto,
  ): Promise<{ id: number; estado: EstadoReclamo }> {
    const reclamo = await this.reclamos.findOneBy({ id });
    if (!reclamo) throw new NotFoundException('El reclamo no existe.');
    if (reclamo.estado === EstadoReclamo.Historico) {
      throw new ConflictException(
        'El reclamo está archivado: ya no se puede cambiar su estado.',
      );
    }
    reclamo.estado = estado;
    await this.reclamos.save(reclamo);
    return { id, estado };
  }

  /** Cuántos reclamos se archivarían en la etapa (para el aviso de confirmación). */
  async contarArchivables(
    etapaId: number,
  ): Promise<{ etapa: { id: number; nombre: string }; archivables: number }> {
    const etapa = await this.buscarEtapa(etapaId);
    const archivables = await this.consulta(etapaId)
      .andWhere('r.estado <> :historico', {
        historico: EstadoReclamo.Historico,
      })
      .getCount();
    return { etapa: { id: etapa.id, nombre: etapa.nombre }, archivables };
  }

  /** Pasa a "histórico" todos los reclamos vigentes de la etapa. No se puede deshacer. */
  async archivar(etapaId: number): Promise<{ archivados: number }> {
    await this.buscarEtapa(etapaId);
    const resultado = await this.reclamos
      .createQueryBuilder()
      .update(Reclamo)
      .set({ estado: EstadoReclamo.Historico })
      .where('deleted_at IS NULL')
      .andWhere('estado <> :historico', { historico: EstadoReclamo.Historico })
      .andWhere(
        `pedido_id IN (
           SELECT p.id FROM pedidos p
             INNER JOIN ofertas o ON o.id = p.oferta_id
            WHERE o.etapa_id = :etapaId AND p.deleted_at IS NULL AND o.deleted_at IS NULL)`,
        { etapaId },
      )
      .execute();
    return { archivados: resultado.affected ?? 0 };
  }

  /** Excel con los reclamos vigentes de la etapa, por distrito, escuela y lote. */
  async exportar(
    etapaId: number,
  ): Promise<{ archivo: Buffer; etapaNombre: string }> {
    const etapa = await this.buscarEtapa(etapaId);
    const filas = await this.consulta(etapaId)
      .select('p.id', 'lote')
      .addSelect('e.cueanexo', 'cueanexo')
      .addSelect('e.nombre', 'escuela')
      .addSelect('e.distrito', 'distrito')
      .addSelect('e.descripcion', 'dependencia')
      .addSelect('e.calle', 'calle')
      .addSelect('e.altura', 'altura')
      .addSelect('e.codigo_postal', 'codigoPostal')
      .addSelect('l.isbn', 'isbn')
      .addSelect('g.nombre', 'grado')
      .addSelect('c.nombre', 'catalogo')
      .addSelect('l.editorial', 'editorial')
      .addSelect('l.titulo', 'titulo')
      .addSelect('t.nombre', 'tipo')
      .addSelect('r.cantidad', 'cantidad')
      .addSelect('r.estado', 'estado')
      .addSelect('r.created_at', 'fecha')
      .orderBy('e.distrito', 'ASC')
      .addOrderBy('e.nombre', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .addOrderBy('r.id', 'ASC')
      .getRawMany<{
        lote: number;
        cueanexo: string;
        escuela: string;
        distrito: number;
        dependencia: string | null;
        calle: string;
        altura: number;
        codigoPostal: string;
        isbn: string;
        grado: string;
        catalogo: string;
        editorial: string;
        titulo: string;
        tipo: string;
        cantidad: number | null;
        estado: EstadoReclamo;
        fecha: Date;
      }>();
    const archivo = await crearXlsx(
      [
        'ID Lote',
        'Etapa',
        'CUE Anexo',
        'Escuela',
        'Distrito Escolar',
        'Dependencia Funcional',
        'Calle',
        'Altura',
        'Código Postal',
        'ISBN',
        'Grado',
        'Catálogo',
        'Editorial',
        'Título',
        'Tipo de Reclamo',
        'Cantidad',
        'Estado',
        'Fecha de reclamo',
      ],
      filas.map((f) => [
        f.lote,
        etapa.nombre,
        f.cueanexo,
        f.escuela,
        f.distrito,
        f.dependencia,
        f.calle,
        f.altura,
        f.codigoPostal,
        f.isbn,
        f.grado,
        f.catalogo,
        f.editorial,
        f.titulo,
        f.tipo,
        f.cantidad,
        ETIQUETA_ESTADO[f.estado],
        f.fecha,
      ]),
      [9, 24, 14, 44, 10, 28, 28, 8, 12, 16, 14, 16, 24, 44, 24, 10, 12, 14],
    );
    return { archivo, etapaNombre: etapa.nombre };
  }

  private async resolverEtapa(): Promise<number | null> {
    const etapas = await this.etapas.find({
      select: {
        id: true,
        fechaInicio: true,
        reclamoInicio: true,
        reclamoFin: true,
      },
    });
    return etapaPorDefecto(etapas, hoyEnArgentina());
  }

  private async buscarEtapa(id: number): Promise<Etapa> {
    const etapa = await this.etapas.findOneBy({ id });
    if (!etapa) throw new NotFoundException('La etapa no existe.');
    return etapa;
  }
}
