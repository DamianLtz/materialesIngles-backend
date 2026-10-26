import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  ILike,
  In,
  Not,
  Repository,
  type EntityManager,
} from 'typeorm';
import { Catalogo } from '../catalogos/entities/catalogo.entity.js';
import {
  escaparLike,
  paginar,
  type ListadoQueryDto,
  type Paginado,
} from '../common/listado.js';
import { contar, esViolacionDeUnico, nombreIgualA } from '../common/nombres.js';
import { Escuela } from '../escuelas/entities/escuela.entity.js';
import { Grado } from '../grados/entities/grado.entity.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import {
  erroresCruzados,
  type GuardarEtapaDto,
  type OfertaDto,
} from './dto/etapa.dto.js';
import { Etapa } from './entities/etapa.entity.js';
import { Oferta } from './entities/oferta.entity.js';

export interface OfertaSalida {
  id: number;
  gradoId: number;
  gradoNombre: string;
  catalogoId: number;
  catalogoNombre: string;
  cantidadMaxima: number;
}

export interface EtapaListadoDto {
  id: number;
  nombre: string;
  fechaInicio: string | null;
  fechaFin: string | null;
  leyenda: string | null;
  reclamoInicio: string | null;
  reclamoFin: string | null;
  reclamoLeyenda: string | null;
  visible: boolean;
  cantidadEscuelas: number;
  ofertas: OfertaSalida[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EtapaDetalleDto extends Omit<
  EtapaListadoDto,
  'cantidadEscuelas' | 'ofertas'
> {
  /** `pedidos`: cuántos pedidos vigentes hay en la oferta (con pedidos no se puede quitar). */
  ofertas: (OfertaSalida & { pedidos: number })[];
  escuelaIds: number[];
  /** Escuelas de la etapa con pedidos: no se pueden quitar. */
  escuelasConPedidos: number[];
}

export interface EscuelaDeEtapaDto {
  id: number;
  nombre: string;
  cueanexo: string;
  comuna: number | null;
}

/** Un pedido vigente, con lo mínimo para decidir si se puede quitar o bajar algo. */
interface PedidoResumido {
  ofertaId: number;
  escuelaId: number;
  cantidad: number;
}

/** Cuántas escuelas con pedidos se nombran en un mensaje antes de decir "y N más". */
const MAX_NOMBRES = 5;
/** Filas por INSERT del pivot etapa_escuela (Postgres admite 65535 parámetros por consulta). */
const LOTE_PIVOT = 2000;

@Injectable()
export class EtapasService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Etapa) private readonly etapas: Repository<Etapa>,
    @InjectRepository(Oferta) private readonly ofertas: Repository<Oferta>,
    @InjectRepository(Escuela) private readonly escuelas: Repository<Escuela>,
    @InjectRepository(Grado) private readonly grados: Repository<Grado>,
    @InjectRepository(Catalogo)
    private readonly catalogos: Repository<Catalogo>,
    @InjectRepository(Pedido) private readonly pedidos: Repository<Pedido>,
  ) {}

  /** Las publicadas primero y después las más nuevas. */
  async listar(query: ListadoQueryDto): Promise<Paginado<EtapaListadoDto>> {
    const [filas, total] = await this.etapas.findAndCount({
      where: query.search
        ? { nombre: ILike(`%${escaparLike(query.search)}%`) }
        : {},
      order: { visible: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    });
    const ids = filas.map((e) => e.id);
    const [cantidades, ofertas] = await Promise.all([
      this.cantidadDeEscuelas(ids),
      this.ofertasConNombres(ids),
    ]);
    return paginar(
      filas.map((e) => ({
        ...camposDeEtapa(e),
        cantidadEscuelas: cantidades.get(e.id) ?? 0,
        ofertas: ofertas.filter((o) => o.etapaId === e.id).map(aOfertaSalida),
      })),
      total,
      query,
    );
  }

  /** Todo lo que necesita el formulario de edición. */
  async obtener(id: number): Promise<EtapaDetalleDto> {
    const etapa = await this.buscar(id);
    const ofertas = await this.ofertasConNombres([id]);
    const [pedidos, escuelaIds] = await Promise.all([
      pedidosDeOfertas(
        this.pedidos.manager,
        ofertas.map((o) => o.id),
      ),
      escuelasDeLaEtapa(this.escuelas.manager, id),
    ]);
    const conPedidos = new Set(pedidos.map((p) => p.escuelaId));
    return {
      ...camposDeEtapa(etapa),
      ofertas: ofertas.map((o) => ({
        ...aOfertaSalida(o),
        pedidos: pedidos.filter((p) => p.ofertaId === o.id).length,
      })),
      escuelaIds,
      escuelasConPedidos: escuelaIds.filter((e) => conPedidos.has(e)),
    };
  }

  /** Escuelas asignadas, para el modal de detalle (se piden recién al abrirlo). */
  async escuelasDe(id: number): Promise<EscuelaDeEtapaDto[]> {
    await this.buscar(id);
    const filas = await this.escuelas
      .createQueryBuilder('e')
      .innerJoin('e.etapas', 'et', 'et.id = :id', { id })
      .orderBy('e.comuna', 'ASC', 'NULLS LAST')
      .addOrderBy('e.nombre', 'ASC')
      .getMany();
    return filas.map(({ id, nombre, cueanexo, comuna }) => ({
      id,
      nombre,
      cueanexo,
      comuna,
    }));
  }

  async crear(dto: GuardarEtapaDto): Promise<EtapaDetalleDto> {
    verificarReglas(dto);
    const id = await this.enTransaccion(async (manager) => {
      await verificarNombreLibre(manager, dto.nombre);
      await verificarExistencia(manager, dto.escuelaIds, dto.ofertas);
      if (dto.visible) await ocultarLasDemas(manager);

      const etapa = await manager.save(
        manager.create(Etapa, { ...valoresDeEtapa(dto) }),
      );
      await manager.save(
        dto.ofertas.map((o) =>
          manager.create(Oferta, valoresDeOferta(o, etapa.id)),
        ),
      );
      await asignarEscuelas(manager, etapa.id, dto.escuelaIds, []);
      return etapa.id;
    });
    return this.obtener(id);
  }

  async actualizar(id: number, dto: GuardarEtapaDto): Promise<EtapaDetalleDto> {
    verificarReglas(dto);
    await this.enTransaccion(async (manager) => {
      const etapa = await manager.findOneBy(Etapa, { id });
      if (!etapa) throw etapaInexistente();
      await verificarNombreLibre(manager, dto.nombre, id);

      const actuales = await manager.findBy(Oferta, { etapaId: id });
      const escuelasActuales = await escuelasDeLaEtapa(manager, id);
      const pedidos = await pedidosDeOfertas(
        manager,
        actuales.map((o) => o.id),
      );

      // Solo lo que el usuario agrega hay que verificar que exista; lo que ya estaba no se toca
      const clave = (o: Pick<OfertaDto, 'gradoId' | 'catalogoId'>) =>
        `${o.gradoId}-${o.catalogoId}`;
      const claveActuales = new Set(actuales.map(clave));
      const nuevasOfertas = dto.ofertas.filter(
        (o) => !claveActuales.has(clave(o)),
      );
      const escuelasNuevas = dto.escuelaIds.filter(
        (e) => !escuelasActuales.includes(e),
      );
      await verificarExistencia(manager, escuelasNuevas, nuevasOfertas);

      const pedidas = new Set(dto.ofertas.map(clave));
      const aQuitar = actuales.filter((o) => !pedidas.has(clave(o)));
      const aActualizar = actuales.filter((o) => pedidas.has(clave(o)));
      const escuelasQuitadas = escuelasActuales.filter(
        (e) => !dto.escuelaIds.includes(e),
      );

      await verificarQuitados(manager, {
        ofertasQuitadas: aQuitar,
        ofertasQueQuedan: aActualizar,
        cantidades: new Map(
          dto.ofertas.map((o) => [clave(o), o.cantidadMaxima]),
        ),
        escuelasQuitadas,
        pedidos,
        clave,
      });

      if (dto.visible) await ocultarLasDemas(manager, id);
      Object.assign(etapa, valoresDeEtapa(dto));
      await manager.save(etapa);

      for (const oferta of aActualizar) {
        const cantidad = dto.ofertas.find(
          (o) => clave(o) === clave(oferta),
        )?.cantidadMaxima;
        if (cantidad !== undefined && cantidad !== oferta.cantidadMaxima) {
          oferta.cantidadMaxima = cantidad;
          await manager.save(oferta);
        }
      }
      if (aQuitar.length) await manager.softRemove(aQuitar);
      await manager.save(
        nuevasOfertas.map((o) =>
          manager.create(Oferta, valoresDeOferta(o, id)),
        ),
      );
      await asignarEscuelas(manager, id, escuelasNuevas, escuelasQuitadas);
    });
    return this.obtener(id);
  }

  /**
   * Publica u oculta. Al publicar se oculta la que estuviera publicada; ocultar puede
   * dejar a las escuelas sin ninguna etapa visible (igual que el original).
   */
  async cambiarVisible(id: number): Promise<{ id: number; visible: boolean }> {
    return this.enTransaccion(async (manager) => {
      const etapa = await manager.findOneBy(Etapa, { id });
      if (!etapa) throw etapaInexistente();
      if (!etapa.visible) await ocultarLasDemas(manager, id);
      etapa.visible = !etapa.visible;
      await manager.save(etapa);
      return { id, visible: etapa.visible };
    });
  }

  /**
   * Borrado lógico de la etapa y sus ofertas. No se permite si alguna escuela ya hizo
   * pedidos (los reclamos cuelgan de los pedidos).
   */
  async eliminar(id: number): Promise<void> {
    const etapa = await this.buscar(id);
    const ofertas = await this.ofertas.findBy({ etapaId: id });
    const enPedidos = ofertas.length
      ? await this.pedidos.countBy({ ofertaId: In(ofertas.map((o) => o.id)) })
      : 0;
    if (enPedidos) {
      throw new ConflictException(
        `No se puede eliminar "${etapa.nombre}": tiene ${contar(enPedidos, 'pedido', 'pedidos')} de libros.`,
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Etapa, id, { visible: false });
      if (ofertas.length) await manager.softRemove(ofertas);
      await manager.softRemove(etapa);
    });
  }

  private async buscar(id: number): Promise<Etapa> {
    const etapa = await this.etapas.findOneBy({ id });
    if (!etapa) throw etapaInexistente();
    return etapa;
  }

  /**
   * Corre la escritura en una transacción y traduce las violaciones de los índices únicos
   * (dos pedidos simultáneos) al mismo error que da la verificación previa.
   */
  private async enTransaccion<T>(
    trabajo: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(trabajo);
    } catch (error) {
      if (esViolacionDeUnico(error)) {
        const { constraint } = error as { constraint?: string };
        if (constraint === 'uq_etapas_visible') {
          throw new ConflictException(
            'Otra etapa se publicó al mismo tiempo. Volvé a intentarlo.',
          );
        }
        if (constraint === 'uq_ofertas_etapa_grado_catalogo') {
          throw new ConflictException(
            'No se puede repetir la combinación de grado y catálogo.',
          );
        }
        throw nombreRepetido();
      }
      throw error;
    }
  }

  /** Cantidad de escuelas (no borradas) de cada etapa. */
  private async cantidadDeEscuelas(
    ids: number[],
  ): Promise<Map<number, number>> {
    if (!ids.length) return new Map();
    const filas: { etapaId: number; cantidad: number }[] =
      await this.etapas.query(
        `SELECT ee.etapa_id AS "etapaId", COUNT(*)::int AS cantidad
           FROM etapa_escuela ee
           INNER JOIN escuelas e ON e.id = ee.escuela_id AND e.deleted_at IS NULL
          WHERE ee.etapa_id = ANY($1)
          GROUP BY ee.etapa_id`,
        [ids],
      );
    return new Map(filas.map((f) => [f.etapaId, f.cantidad]));
  }

  /** Ofertas vigentes de las etapas, con el nombre de su grado y catálogo (aunque estén borrados). */
  private async ofertasConNombres(etapaIds: number[]) {
    if (!etapaIds.length) return [];
    const ofertas = await this.ofertas.find({
      where: { etapaId: In(etapaIds) },
      order: { id: 'ASC' },
    });
    const [grados, catalogos] = await Promise.all([
      this.grados.find({
        where: { id: In(ofertas.map((o) => o.gradoId)) },
        withDeleted: true,
      }),
      this.catalogos.find({
        where: { id: In(ofertas.map((o) => o.catalogoId)) },
        withDeleted: true,
      }),
    ]);
    const nombreGrado = new Map(grados.map((g) => [g.id, g.nombre]));
    const nombreCatalogo = new Map(catalogos.map((c) => [c.id, c.nombre]));
    return ofertas.map((o) => ({
      id: o.id,
      etapaId: o.etapaId,
      gradoId: o.gradoId,
      catalogoId: o.catalogoId,
      cantidadMaxima: o.cantidadMaxima,
      gradoNombre: nombreGrado.get(o.gradoId) ?? '',
      catalogoNombre: nombreCatalogo.get(o.catalogoId) ?? '',
    }));
  }
}

// ── Reglas de escritura ──────────────────────────────────────────────────────

/** Las reglas entre campos responden 400 con la lista de mensajes, como el ValidationPipe. */
function verificarReglas(dto: GuardarEtapaDto) {
  const errores = erroresCruzados(dto);
  if (errores.length) throw new BadRequestException(errores);
}

async function verificarNombreLibre(
  manager: EntityManager,
  nombre: string,
  idActual?: number,
) {
  const existente = await manager.findOne(Etapa, {
    where: { nombre: nombreIgualA(nombre) },
  });
  if (existente && existente.id !== idActual) throw nombreRepetido();
}

/** Escuelas, grados y catálogos recibidos deben existir (se cuenta en una consulta por tipo). */
async function verificarExistencia(
  manager: EntityManager,
  escuelaIds: number[],
  ofertas: OfertaDto[],
) {
  const errores: string[] = [];
  if (escuelaIds.length) {
    const existen = await manager.countBy(Escuela, { id: In(escuelaIds) });
    if (existen !== escuelaIds.length) {
      errores.push('Algunas escuelas seleccionadas no existen.');
    }
  }
  const gradoIds = [...new Set(ofertas.map((o) => o.gradoId))];
  if (gradoIds.length) {
    const existen = await manager.countBy(Grado, { id: In(gradoIds) });
    if (existen !== gradoIds.length) errores.push('Algunos grados no existen.');
  }
  const catalogoIds = [...new Set(ofertas.map((o) => o.catalogoId))];
  if (catalogoIds.length) {
    const existen = await manager.countBy(Catalogo, { id: In(catalogoIds) });
    if (existen !== catalogoIds.length) {
      errores.push('Algunos catálogos no existen.');
    }
  }
  if (errores.length) throw new BadRequestException(errores);
}

/** Una sola etapa visible a la vez: antes de publicar una se ocultan las demás. */
async function ocultarLasDemas(manager: EntityManager, idPropio?: number) {
  await manager.update(
    Etapa,
    idPropio === undefined
      ? { visible: true }
      : { visible: true, id: Not(idPropio) },
    { visible: false },
  );
}

/**
 * Quitar una oferta o una escuela que ya tiene pedidos dejaría pedidos huérfanos (el
 * original lo hacía sin avisar). Se rechaza con 409 nombrando lo que lo impide.
 */
async function verificarQuitados(
  manager: EntityManager,
  datos: {
    ofertasQuitadas: Oferta[];
    ofertasQueQuedan: Oferta[];
    cantidades: Map<string, number>;
    escuelasQuitadas: number[];
    pedidos: PedidoResumido[];
    clave: (o: Pick<Oferta, 'gradoId' | 'catalogoId'>) => string;
  },
) {
  const { ofertasQuitadas, ofertasQueQuedan, escuelasQuitadas, pedidos } =
    datos;
  const motivos: string[] = [];
  const todas = [...ofertasQuitadas, ...ofertasQueQuedan];
  const nombres = todas.length ? await nombresDeOfertas(manager, todas) : null;

  for (const oferta of ofertasQuitadas) {
    const cantidad = pedidos.filter((p) => p.ofertaId === oferta.id).length;
    if (cantidad) {
      motivos.push(
        `No se puede quitar "${nombres?.get(oferta.id)}": tiene ${contar(cantidad, 'pedido', 'pedidos')}.`,
      );
    }
  }
  for (const oferta of ofertasQueQuedan) {
    const nueva = datos.cantidades.get(datos.clave(oferta));
    const mayor = Math.max(
      0,
      ...pedidos.filter((p) => p.ofertaId === oferta.id).map((p) => p.cantidad),
    );
    if (nueva !== undefined && nueva < mayor) {
      motivos.push(
        `La cantidad máxima de "${nombres?.get(oferta.id)}" no puede ser menor a ${mayor}: hay un pedido de ${contar(mayor, 'unidad', 'unidades')}.`,
      );
    }
  }

  const conPedidos = escuelasQuitadas
    .map((id) => ({
      id,
      pedidos: pedidos.filter((p) => p.escuelaId === id).length,
    }))
    .filter((e) => e.pedidos > 0);
  if (conPedidos.length) {
    const filas = await manager.find(Escuela, {
      where: { id: In(conPedidos.map((e) => e.id)) },
      withDeleted: true,
    });
    const nombre = new Map(filas.map((e) => [e.id, e.nombre]));
    const nombradas = conPedidos
      .slice(0, MAX_NOMBRES)
      .map(
        (e) =>
          `${nombre.get(e.id)} (${contar(e.pedidos, 'pedido', 'pedidos')})`,
      );
    const resto = conPedidos.length - nombradas.length;
    motivos.push(
      `No se pueden quitar escuelas que ya tienen pedidos: ${nombradas.join(', ')}${resto > 0 ? ` y ${resto} más` : ''}.`,
    );
  }

  if (motivos.length) throw new ConflictException(motivos.join(' '));
}

/** "1er Grado – Inglés" por id de oferta, para los mensajes. */
async function nombresDeOfertas(manager: EntityManager, ofertas: Oferta[]) {
  const [grados, catalogos] = await Promise.all([
    manager.find(Grado, {
      where: { id: In(ofertas.map((o) => o.gradoId)) },
      withDeleted: true,
    }),
    manager.find(Catalogo, {
      where: { id: In(ofertas.map((o) => o.catalogoId)) },
      withDeleted: true,
    }),
  ]);
  const grado = new Map(grados.map((g) => [g.id, g.nombre]));
  const catalogo = new Map(catalogos.map((c) => [c.id, c.nombre]));
  return new Map(
    ofertas.map((o) => [
      o.id,
      `${grado.get(o.gradoId)} – ${catalogo.get(o.catalogoId)}`,
    ]),
  );
}

/** Agrega y quita filas del pivot etapa_escuela sin tocar las demás (ni las de escuelas borradas). */
async function asignarEscuelas(
  manager: EntityManager,
  etapaId: number,
  agregadas: number[],
  quitadas: number[],
) {
  const relacion = () =>
    manager.createQueryBuilder().relation(Etapa, 'escuelas').of(etapaId);
  for (let i = 0; i < agregadas.length; i += LOTE_PIVOT) {
    await relacion().add(agregadas.slice(i, i + LOTE_PIVOT));
  }
  for (let i = 0; i < quitadas.length; i += LOTE_PIVOT) {
    await relacion().remove(quitadas.slice(i, i + LOTE_PIVOT));
  }
}

// ── Lecturas auxiliares ──────────────────────────────────────────────────────

/** Pedidos vigentes de las ofertas dadas. */
async function pedidosDeOfertas(
  manager: EntityManager,
  ofertaIds: number[],
): Promise<PedidoResumido[]> {
  if (!ofertaIds.length) return [];
  return manager.find(Pedido, {
    where: { ofertaId: In(ofertaIds) },
    select: { id: true, ofertaId: true, escuelaId: true, cantidad: true },
  });
}

/** Ids de las escuelas (no borradas) asignadas a la etapa. */
async function escuelasDeLaEtapa(
  manager: EntityManager,
  etapaId: number,
): Promise<number[]> {
  const filas: { id: number }[] = await manager.query(
    `SELECT ee.escuela_id AS id
       FROM etapa_escuela ee
       INNER JOIN escuelas e ON e.id = ee.escuela_id AND e.deleted_at IS NULL
      WHERE ee.etapa_id = $1
      ORDER BY ee.escuela_id`,
    [etapaId],
  );
  return filas.map((f) => f.id);
}

// ── Conversiones ─────────────────────────────────────────────────────────────

function valoresDeEtapa(dto: GuardarEtapaDto) {
  return {
    nombre: dto.nombre,
    fechaInicio: dto.fechaInicio ?? null,
    fechaFin: dto.fechaFin ?? null,
    leyenda: dto.leyenda ?? null,
    reclamoInicio: dto.reclamoInicio ?? null,
    reclamoFin: dto.reclamoFin ?? null,
    reclamoLeyenda: dto.reclamoLeyenda ?? null,
    visible: dto.visible,
  };
}

function valoresDeOferta(o: OfertaDto, etapaId: number) {
  return {
    etapaId,
    gradoId: o.gradoId,
    catalogoId: o.catalogoId,
    cantidadMaxima: o.cantidadMaxima,
  };
}

function camposDeEtapa(e: Etapa) {
  return {
    id: e.id,
    nombre: e.nombre,
    fechaInicio: e.fechaInicio,
    fechaFin: e.fechaFin,
    leyenda: e.leyenda,
    reclamoInicio: e.reclamoInicio,
    reclamoFin: e.reclamoFin,
    reclamoLeyenda: e.reclamoLeyenda,
    visible: e.visible,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function aOfertaSalida(o: {
  id: number;
  gradoId: number;
  gradoNombre: string;
  catalogoId: number;
  catalogoNombre: string;
  cantidadMaxima: number;
}): OfertaSalida {
  return {
    id: o.id,
    gradoId: o.gradoId,
    gradoNombre: o.gradoNombre,
    catalogoId: o.catalogoId,
    catalogoNombre: o.catalogoNombre,
    cantidadMaxima: o.cantidadMaxima,
  };
}

function nombreRepetido() {
  return new ConflictException('Ya existe una etapa con ese nombre.');
}

function etapaInexistente() {
  return new NotFoundException('La etapa no existe.');
}
