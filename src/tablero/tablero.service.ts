import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { crearXlsx } from '../common/excel.js';
import { hoyEnArgentina } from '../common/fechas.js';
import {
  clasificarEscuela,
  etapaInicial,
  momentoEtapa,
  porcentaje,
  topConOtros,
  type Momento,
  type PuntoGrafico,
} from './calculo.js';

export interface EtapaTableroDto {
  id: number;
  nombre: string;
  visible: boolean;
}

export interface ResumenTableroDto {
  etapa: {
    id: number;
    nombre: string;
    visible: boolean;
    fechaInicio: string | null;
    fechaFin: string | null;
    reclamoInicio: string | null;
    reclamoFin: string | null;
  };
  momento: Momento;
  proximaFecha: string | null;
  metricas: {
    escuelas: number;
    ofertas: number;
    pedidosEsperados: number;
    pedidos: number;
    ejemplares: number;
    porcentaje: number;
    escuelasCompletas: number;
    escuelasParciales: number;
    escuelasSinPedidos: number;
    reclamos: {
      total: number;
      pendiente: number;
      enProceso: number;
      resuelto: number;
      rechazado: number;
      historico: number;
    };
  };
  graficos: {
    porGrado: PuntoGrafico[];
    porCatalogo: PuntoGrafico[];
    porEditorial: PuntoGrafico[];
    porDistrito: PuntoGrafico[];
    reclamosPorTipo: { label: string; cantidad: number }[];
  };
}

interface EtapaFila {
  id: number;
  nombre: string;
  visible: boolean;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  reclamo_inicio: string | null;
  reclamo_fin: string | null;
}

const MAX_EDITORIALES = 8;
const MAX_TIPOS_RECLAMO = 5;

/** Pedidos vigentes de la etapa (`$1`) hechos por escuelas asignadas a ella. */
const PEDIDOS_DE_LA_ETAPA = `
  FROM pedidos p
  JOIN ofertas o ON o.id = p.oferta_id AND o.deleted_at IS NULL AND o.etapa_id = $1
  JOIN etapa_escuela ee ON ee.etapa_id = o.etapa_id AND ee.escuela_id = p.escuela_id
  JOIN escuelas e ON e.id = p.escuela_id AND e.deleted_at IS NULL`;

/** Reclamos vigentes de la etapa (`$1`), como los lista el módulo de reclamos. */
const RECLAMOS_DE_LA_ETAPA = `
  FROM reclamos r
  JOIN pedidos p ON p.id = r.pedido_id AND p.deleted_at IS NULL
  JOIN ofertas o ON o.id = p.oferta_id AND o.deleted_at IS NULL AND o.etapa_id = $1`;

const porNombre = (a: PuntoGrafico, b: PuntoGrafico) =>
  a.label.localeCompare(b.label, 'es', { numeric: true });

/**
 * Todo sale de consultas agrupadas en SQL (nada de cargar colecciones en memoria). Siempre
 * sobre registros no borrados y solo escuelas asignadas a la etapa (`etapa_escuela`).
 */
@Injectable()
export class TableroService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Etapas para el selector: la publicada primero. */
  etapas(): Promise<EtapaTableroDto[]> {
    return this.dataSource.query<EtapaTableroDto[]>(
      `SELECT id, nombre, visible FROM etapas
       WHERE deleted_at IS NULL ORDER BY visible DESC, id DESC`,
    );
  }

  private async buscarEtapa(etapaId: number): Promise<EtapaFila> {
    const filas = await this.dataSource.query<EtapaFila[]>(
      `SELECT id, nombre, visible, fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin,
              reclamo_inicio::text AS reclamo_inicio, reclamo_fin::text AS reclamo_fin
       FROM etapas WHERE id = $1 AND deleted_at IS NULL`,
      [etapaId],
    );
    if (!filas[0]) throw new NotFoundException('La etapa no existe.');
    return filas[0];
  }

  /** Ejemplares y pedidos agrupados por `etiqueta` (una expresión SQL), con joins extra si hacen falta. */
  private async puntos(
    etapaId: number,
    etiqueta: string,
    joins: string,
  ): Promise<PuntoGrafico[]> {
    const filas = await this.dataSource.query<PuntoGrafico[]>(
      `SELECT ${etiqueta} AS label, SUM(p.cantidad)::int AS ejemplares, COUNT(p.id)::int AS pedidos
       ${PEDIDOS_DE_LA_ETAPA}
       ${joins}
       WHERE p.deleted_at IS NULL
       GROUP BY ${etiqueta}`,
      [etapaId],
    );
    return filas.map((f) => ({
      label: f.label,
      ejemplares: f.ejemplares,
      pedidos: f.pedidos,
    }));
  }

  /** Resumen de una etapa; sin `etapaId` usa la publicada (o la de inicio más reciente). Null si no hay etapas. */
  async resumen(etapaId?: number): Promise<ResumenTableroDto | null> {
    let id = etapaId ?? null;
    if (id === null) {
      const todas = await this.dataSource.query<
        { id: number; visible: boolean; fecha_inicio: string | null }[]
      >(
        `SELECT id, visible, fecha_inicio::text AS fecha_inicio FROM etapas WHERE deleted_at IS NULL`,
      );
      id = etapaInicial(
        todas.map((e) => ({
          id: e.id,
          visible: e.visible,
          fechaInicio: e.fecha_inicio,
        })),
      );
      if (id === null) return null;
    }
    const etapa = await this.buscarEtapa(id);
    const { momento, proximaFecha } = momentoEtapa(
      {
        fechaInicio: etapa.fecha_inicio,
        fechaFin: etapa.fecha_fin,
        reclamoInicio: etapa.reclamo_inicio,
        reclamoFin: etapa.reclamo_fin,
      },
      hoyEnArgentina(),
    );

    const [
      totales,
      avance,
      pedidos,
      porEstado,
      porGrado,
      porCatalogo,
      porEditorial,
      porDistrito,
      porTipo,
    ] = await Promise.all([
      this.dataSource.query<{ escuelas: number; ofertas: number }[]>(
        `SELECT
           (SELECT COUNT(*)::int FROM etapa_escuela ee
              JOIN escuelas e ON e.id = ee.escuela_id AND e.deleted_at IS NULL
              WHERE ee.etapa_id = $1) AS escuelas,
           (SELECT COUNT(*)::int FROM ofertas WHERE etapa_id = $1 AND deleted_at IS NULL) AS ofertas`,
        [id],
      ),
      // Cuántas escuelas asignadas tienen pedido en 0, 1, 2… ofertas
      this.dataSource.query<{ con_pedido: number; escuelas: number }[]>(
        `SELECT con_pedido, COUNT(*)::int AS escuelas FROM (
           SELECT e.id, COUNT(p.id)::int AS con_pedido
           FROM etapa_escuela ee
           JOIN escuelas e ON e.id = ee.escuela_id AND e.deleted_at IS NULL
           LEFT JOIN ofertas o ON o.etapa_id = ee.etapa_id AND o.deleted_at IS NULL
           LEFT JOIN pedidos p ON p.oferta_id = o.id AND p.escuela_id = e.id AND p.deleted_at IS NULL
           WHERE ee.etapa_id = $1
           GROUP BY e.id
         ) t GROUP BY con_pedido`,
        [id],
      ),
      this.dataSource.query<{ pedidos: number; ejemplares: number }[]>(
        `SELECT COUNT(p.id)::int AS pedidos, COALESCE(SUM(p.cantidad), 0)::int AS ejemplares
         ${PEDIDOS_DE_LA_ETAPA}
         WHERE p.deleted_at IS NULL`,
        [id],
      ),
      this.dataSource.query<{ estado: string; cantidad: number }[]>(
        `SELECT r.estado::text AS estado, COUNT(*)::int AS cantidad
         ${RECLAMOS_DE_LA_ETAPA}
         WHERE r.deleted_at IS NULL
         GROUP BY r.estado`,
        [id],
      ),
      this.puntos(id, 'g.nombre', 'JOIN grados g ON g.id = o.grado_id'),
      this.puntos(id, 'c.nombre', 'JOIN catalogos c ON c.id = o.catalogo_id'),
      this.puntos(id, 'l.editorial', 'JOIN libros l ON l.id = p.libro_id'),
      this.puntos(id, "'Distrito ' || e.distrito", ''),
      this.dataSource.query<{ label: string; cantidad: number }[]>(
        `SELECT t.nombre AS label, COUNT(*)::int AS cantidad
         ${RECLAMOS_DE_LA_ETAPA}
         JOIN tipos_reclamo t ON t.id = r.tipo_reclamo_id
         WHERE r.deleted_at IS NULL
         GROUP BY t.nombre`,
        [id],
      ),
    ]);

    const { escuelas, ofertas } = totales[0];
    let completas = 0;
    let parciales = 0;
    let sinPedidos = 0;
    for (const fila of avance) {
      const clase = clasificarEscuela(fila.con_pedido, ofertas);
      if (clase === 'completa') completas += fila.escuelas;
      else if (clase === 'parcial') parciales += fila.escuelas;
      else sinPedidos += fila.escuelas;
    }

    const reclamos = {
      total: 0,
      pendiente: 0,
      enProceso: 0,
      resuelto: 0,
      rechazado: 0,
      historico: 0,
    };
    for (const { estado, cantidad } of porEstado) {
      reclamos.total += cantidad;
      if (estado === 'pendiente') reclamos.pendiente = cantidad;
      else if (estado === 'en_proceso') reclamos.enProceso = cantidad;
      else if (estado === 'resuelto') reclamos.resuelto = cantidad;
      else if (estado === 'rechazado') reclamos.rechazado = cantidad;
      else if (estado === 'historico') reclamos.historico = cantidad;
    }

    const esperados = escuelas * ofertas;
    const tipos = topConOtros(
      porTipo.map((t) => ({
        label: t.label,
        ejemplares: t.cantidad,
        pedidos: t.cantidad,
      })),
      MAX_TIPOS_RECLAMO,
    ).map((t) => ({ label: t.label, cantidad: t.ejemplares }));

    return {
      etapa: {
        id: etapa.id,
        nombre: etapa.nombre,
        visible: etapa.visible,
        fechaInicio: etapa.fecha_inicio,
        fechaFin: etapa.fecha_fin,
        reclamoInicio: etapa.reclamo_inicio,
        reclamoFin: etapa.reclamo_fin,
      },
      momento,
      proximaFecha,
      metricas: {
        escuelas,
        ofertas,
        pedidosEsperados: esperados,
        pedidos: pedidos[0].pedidos,
        ejemplares: pedidos[0].ejemplares,
        porcentaje: porcentaje(pedidos[0].pedidos, esperados),
        escuelasCompletas: completas,
        escuelasParciales: parciales,
        escuelasSinPedidos: sinPedidos,
        reclamos,
      },
      graficos: {
        porGrado: porGrado.sort(porNombre),
        porCatalogo: porCatalogo.sort(porNombre),
        porEditorial: topConOtros(porEditorial, MAX_EDITORIALES),
        porDistrito: porDistrito.sort(porNombre),
        reclamosPorTipo: tipos,
      },
    };
  }

  /** Excel de escuelas asignadas que no completaron la selección, con lo que les falta. */
  async exportarPendientes(
    etapaId: number,
  ): Promise<{ archivo: Buffer; etapaNombre: string }> {
    const etapa = await this.buscarEtapa(etapaId);
    const filas = await this.dataSource.query<
      {
        distrito: number;
        cueanexo: string;
        escuela: string;
        con_pedido: number;
        totales: number;
        faltan: string | null;
      }[]
    >(
      `SELECT e.distrito, e.cueanexo, e.nombre AS escuela,
              COUNT(*) FILTER (WHERE p.id IS NOT NULL)::int AS con_pedido,
              COUNT(o.id)::int AS totales,
              string_agg(g.nombre || ' – ' || c.nombre, ', ' ORDER BY g.nombre, c.nombre)
                FILTER (WHERE p.id IS NULL) AS faltan
       FROM etapa_escuela ee
       JOIN escuelas e ON e.id = ee.escuela_id AND e.deleted_at IS NULL
       JOIN ofertas o ON o.etapa_id = ee.etapa_id AND o.deleted_at IS NULL
       JOIN grados g ON g.id = o.grado_id
       JOIN catalogos c ON c.id = o.catalogo_id
       LEFT JOIN pedidos p ON p.oferta_id = o.id AND p.escuela_id = e.id AND p.deleted_at IS NULL
       WHERE ee.etapa_id = $1
       GROUP BY e.id
       HAVING COUNT(*) FILTER (WHERE p.id IS NULL) > 0
       ORDER BY e.distrito, e.nombre`,
      [etapaId],
    );
    const archivo = await crearXlsx(
      [
        'Distrito',
        'CUE/Anexo',
        'Escuela',
        'Estado',
        'Ofertas con pedido',
        'Ofertas totales',
        'Faltan',
      ],
      filas.map((f) => [
        f.distrito,
        f.cueanexo,
        f.escuela,
        f.con_pedido === 0 ? 'Sin pedidos' : 'Parcial',
        f.con_pedido,
        f.totales,
        f.faltan ?? '',
      ]),
      [10, 16, 40, 14, 18, 16, 60],
    );
    return { archivo, etapaNombre: etapa.nombre };
  }
}
