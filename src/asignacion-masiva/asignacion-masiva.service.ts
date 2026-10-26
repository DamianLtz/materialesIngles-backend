import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager } from 'typeorm';
import { crearXlsx } from '../common/excel.js';
import { Etapa } from '../etapas/entities/etapa.entity.js';
import { aplicarAccion } from '../pedidos/aplicar-accion.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import { cargarContexto } from './contexto.js';
import type {
  FilaGuardarDto,
  SyncMasivoDto,
} from './dto/asignacion-masiva.dto.js';
import { leerFilas, type FilaImportada } from './lector-excel.js';
import { validarFilas, type FilaValidada } from './validador.js';

export interface ResumenFilas {
  total: number;
  nuevas: number;
  actualizan: number;
  reemplazan: number;
  sinCambios: number;
  errores: number;
}

export interface VistaPrevia {
  etapa: { id: number; nombre: string };
  filas: FilaValidada[];
  resumen: ResumenFilas;
}

export interface ResultadoGuardado {
  nuevas: number;
  actualizadas: number;
  reemplazadas: number;
  sinCambios: number;
  /** Filas que no se importaron por tener errores. */
  omitidas: number;
  errores: {
    fila: number;
    cueanexo: string;
    isbn: string;
    errores: string[];
  }[];
}

const ENCABEZADOS = ['cueanexo', 'isbn', 'cantidad', 'grado'];

@Injectable()
export class AsignacionMasivaService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** La etapa publicada, o null si no hay ninguna. */
  async etapa(): Promise<{ id: number; nombre: string } | null> {
    const etapa = await this.dataSource.manager.findOneBy(Etapa, {
      visible: true,
    });
    return etapa ? { id: etapa.id, nombre: etapa.nombre } : null;
  }

  /** Lee y valida el archivo sin guardar nada: muestra qué pasaría con cada fila. */
  async parse(buffer: Buffer): Promise<VistaPrevia> {
    const etapa = await this.etapaPublicada(this.dataSource.manager);
    const importadas = await leerFilas(buffer);
    const ctx = await cargarContexto(
      this.dataSource.manager,
      etapa.id,
      importadas,
    );
    const { filas } = validarFilas(importadas, ctx);
    return {
      etapa: { id: etapa.id, nombre: etapa.nombre },
      filas,
      resumen: resumir(filas),
    };
  }

  /**
   * Guarda las filas. NO confía en lo que mandó el navegador: vuelve a validarlo todo contra
   * la base, dentro de la transacción, y aplica solo las filas válidas (las demás se omiten).
   * Nunca borra físicamente: reemplazar un libro es un borrado lógico más un pedido nuevo.
   */
  async save(entradas: FilaGuardarDto[]): Promise<ResultadoGuardado> {
    const importadas = entradas.map(aImportada);
    return this.dataSource.transaction(async (manager) => {
      const etapa = await this.etapaPublicada(manager);
      const ctx = await cargarContexto(manager, etapa.id, importadas);
      const { filas, resueltas } = validarFilas(importadas, ctx);

      const aModificar = resueltas.flatMap((r) =>
        r &&
        (r.accion === 'actualizar' || r.accion === 'reemplazar') &&
        r.existenteId
          ? [r.existenteId]
          : [],
      );
      const existentes = new Map(
        (aModificar.length
          ? await manager.find(Pedido, { where: { id: In(aModificar) } })
          : []
        ).map((p) => [p.id, p]),
      );

      for (const r of resueltas) {
        if (!r) continue;
        await aplicarAccion(manager, r.accion, {
          existente: r.existenteId ? existentes.get(r.existenteId) : undefined,
          escuelaId: r.escuelaId,
          ofertaId: r.ofertaId,
          libroId: r.libroId,
          cantidad: r.cantidad,
        });
      }

      const resumen = resumir(filas);
      return {
        nuevas: resumen.nuevas,
        actualizadas: resumen.actualizan,
        reemplazadas: resumen.reemplazan,
        sinCambios: resumen.sinCambios,
        omitidas: resumen.errores,
        errores: filas
          .filter((f) => f.estado === 'error')
          .map(({ fila, cueanexo, isbn, errores }) => ({
            fila,
            cueanexo,
            isbn,
            errores,
          })),
      };
    });
  }

  /** Un mismo libro y cantidad para varias escuelas (mismas validaciones y reemplazo que `save`). */
  sync(dto: SyncMasivoDto): Promise<ResultadoGuardado> {
    return this.save(
      dto.cueanexos.map((cueanexo, i) => ({
        fila: i + 1,
        cueanexo,
        isbn: dto.isbn.replace(/[\s-]/g, ''),
        cantidad: dto.cantidad,
      })),
    );
  }

  /** Plantilla vacía: encabezados y dos filas de ejemplo (CUE e ISBN como texto). */
  plantilla(): Promise<Buffer> {
    return crearXlsx(
      ENCABEZADOS,
      [
        ['20000200', '9789504669548', 20, '2do Grado'],
        ['20000800', '9789876154635', 40, null],
      ],
      [14, 18, 10, 18],
    );
  }

  /** Los pedidos vigentes de la etapa publicada en el formato de la plantilla, para editar y volver a subir. */
  async actuales(): Promise<{ archivo: Buffer; etapaNombre: string }> {
    const etapa = await this.etapaPublicada(this.dataSource.manager);
    const filas = await this.dataSource
      .createQueryBuilder()
      .select('e.cueanexo', 'cueanexo')
      .addSelect('l.isbn', 'isbn')
      .addSelect('p.cantidad', 'cantidad')
      .addSelect('g.nombre', 'grado')
      .from(Pedido, 'p')
      .withDeleted() // el libro puede estar deshabilitado: igual hay que exportarlo
      .innerJoin('p.escuela', 'e')
      .innerJoin('p.oferta', 'o')
      .innerJoin('o.grado', 'g')
      .innerJoin('p.libro', 'l')
      .where('p.deleted_at IS NULL')
      .andWhere('o.deleted_at IS NULL')
      .andWhere('o.etapa_id = :etapaId', { etapaId: etapa.id })
      .orderBy('e.comuna', 'ASC', 'NULLS LAST')
      .addOrderBy('e.nombre', 'ASC')
      .addOrderBy('g.nombre', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .getRawMany<{
        cueanexo: string;
        isbn: string;
        cantidad: number;
        grado: string;
      }>();
    const archivo = await crearXlsx(
      ENCABEZADOS,
      filas.map((f) => [f.cueanexo, f.isbn, f.cantidad, f.grado]),
      [14, 18, 10, 18],
    );
    return { archivo, etapaNombre: etapa.nombre };
  }

  private async etapaPublicada(manager: EntityManager): Promise<Etapa> {
    const etapa = await manager.findOneBy(Etapa, { visible: true });
    if (!etapa) {
      throw new ConflictException(
        'No hay una etapa publicada: la asignación masiva trabaja sobre la etapa publicada.',
      );
    }
    return etapa;
  }
}

const aImportada = (f: FilaGuardarDto, i: number): FilaImportada => ({
  fila: f.fila ?? i + 2,
  cueanexo: f.cueanexo,
  isbn: f.isbn.replace(/[\s-]/g, ''),
  cantidad: f.cantidad,
  grado: f.grado ?? '',
});

function resumir(filas: FilaValidada[]): ResumenFilas {
  const cuenta = (estado: FilaValidada['estado']) =>
    filas.filter((f) => f.estado === estado).length;
  return {
    total: filas.length,
    nuevas: cuenta('nueva'),
    actualizan: cuenta('actualiza'),
    reemplazan: cuenta('reemplaza'),
    sinCambios: cuenta('sin_cambios'),
    errores: cuenta('error'),
  };
}
