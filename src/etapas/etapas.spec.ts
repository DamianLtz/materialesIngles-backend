import 'reflect-metadata'; // en la app lo carga Nest; acá no hay nadie que lo haga
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import type { DataSource, Repository } from 'typeorm';
import { Catalogo } from '../catalogos/entities/catalogo.entity.js';
import { Escuela } from '../escuelas/entities/escuela.entity.js';
import { Grado } from '../grados/entities/grado.entity.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import { erroresCruzados, GuardarEtapaDto } from './dto/etapa.dto.js';
import { Etapa } from './entities/etapa.entity.js';
import { Oferta } from './entities/oferta.entity.js';
import { EtapasService } from './etapas.service.js';

/** Datos de la "base" que ven los repositorios y el manager simulados. */
interface Escenario {
  etapa?: Partial<Etapa> | null;
  otraConMismoNombre?: Partial<Etapa> | null;
  ofertas?: Partial<Oferta>[];
  pedidos?: Partial<Pedido>[];
  /** Ids de escuelas asignadas hoy a la etapa (el pivot). */
  escuelasAsignadas?: number[];
  /** Cuántas escuelas/grados/catálogos existen de los pedidos (para probar "no existe"). */
  existen?: { escuelas?: number; grados?: number; catalogos?: number };
}

function armar(e: Escenario = {}) {
  const relacion = { add: vi.fn(), remove: vi.fn() };
  const manager = {
    findOneBy: vi.fn().mockResolvedValue(e.etapa ?? null),
    findOne: vi.fn().mockResolvedValue(e.otraConMismoNombre ?? null),
    findBy: vi.fn().mockResolvedValue(e.ofertas ?? []),
    find: vi.fn((entidad: unknown) => {
      if (entidad === Pedido) return Promise.resolve(e.pedidos ?? []);
      if (entidad === Grado) {
        return Promise.resolve([{ id: 1, nombre: '1er Grado' }]);
      }
      if (entidad === Catalogo) {
        return Promise.resolve([{ id: 1, nombre: 'Inglés' }]);
      }
      if (entidad === Escuela) {
        return Promise.resolve([
          { id: 10, nombre: 'Escuela Diez' },
          { id: 11, nombre: 'Escuela Once' },
        ]);
      }
      return Promise.resolve([]);
    }),
    countBy: vi.fn((entidad: unknown, donde: { id: { value: number[] } }) => {
      const pedidas = donde.id.value.length;
      const clave =
        entidad === Escuela
          ? 'escuelas'
          : entidad === Grado
            ? 'grados'
            : 'catalogos';
      return Promise.resolve(e.existen?.[clave] ?? pedidas);
    }),
    query: vi
      .fn()
      .mockResolvedValue((e.escuelasAsignadas ?? []).map((id) => ({ id }))),
    create: vi.fn((_: unknown, datos: object) => ({ ...datos })),
    save: vi.fn((x: unknown) =>
      Promise.resolve(Array.isArray(x) ? x : { id: 7, ...(x as object) }),
    ),
    update: vi.fn().mockResolvedValue(undefined),
    softRemove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn(() => ({
      relation: () => ({ of: () => relacion }),
    })),
  };
  const dataSource = {
    transaction: vi.fn((trabajo: (m: unknown) => unknown) => trabajo(manager)),
  };
  const repos = {
    etapas: {
      findOneBy: vi.fn().mockResolvedValue(e.etapa ?? null),
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
    },
    ofertas: {
      findBy: vi.fn().mockResolvedValue(e.ofertas ?? []),
      find: vi.fn().mockResolvedValue(e.ofertas ?? []),
    },
    escuelas: { manager },
    grados: { find: vi.fn().mockResolvedValue([]) },
    catalogos: { find: vi.fn().mockResolvedValue([]) },
    pedidos: {
      manager,
      countBy: vi.fn().mockResolvedValue(e.pedidos?.length ?? 0),
    },
  };
  const servicio = new EtapasService(
    dataSource as unknown as DataSource,
    repos.etapas as unknown as Repository<Etapa>,
    repos.ofertas as unknown as Repository<Oferta>,
    repos.escuelas as unknown as Repository<Escuela>,
    repos.grados as unknown as Repository<Grado>,
    repos.catalogos as unknown as Repository<Catalogo>,
    repos.pedidos as unknown as Repository<Pedido>,
  );
  // obtener() (que cierra crear/actualizar) se prueba aparte: acá se simplifica
  vi.spyOn(servicio, 'obtener').mockResolvedValue({} as never);
  return { servicio, manager, relacion, repos };
}

const valido = {
  nombre: 'E2E Etapa',
  fechaInicio: '2026-10-01',
  fechaFin: '2026-10-31',
  leyenda: null,
  reclamoInicio: null,
  reclamoFin: null,
  reclamoLeyenda: null,
  visible: false,
  escuelaIds: [10, 11],
  ofertas: [{ gradoId: 1, catalogoId: 1, cantidadMaxima: 100 }],
};

const dto = (cambios: Partial<GuardarEtapaDto> = {}): GuardarEtapaDto => ({
  ...valido,
  ...cambios,
});

describe('EtapasService.crear', () => {
  it('guarda la etapa, sus ofertas y las escuelas en una transacción', async () => {
    const { servicio, manager, relacion } = armar();
    await servicio.crear(dto());
    expect(manager.save).toHaveBeenCalledTimes(2);
    expect(manager.create).toHaveBeenCalledWith(
      Oferta,
      expect.objectContaining({ etapaId: 7, cantidadMaxima: 100 }),
    );
    expect(relacion.add).toHaveBeenCalledWith([10, 11]);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('al publicar oculta las demás etapas', async () => {
    const { servicio, manager } = armar();
    await servicio.crear(dto({ visible: true }));
    expect(manager.update).toHaveBeenCalledWith(
      Etapa,
      { visible: true },
      { visible: false },
    );
  });

  it('rechaza un nombre repetido (sin distinguir mayúsculas)', async () => {
    const { servicio, manager } = armar({ otraConMismoNombre: { id: 3 } });
    await expect(servicio.crear(dto())).rejects.toThrow(
      'Ya existe una etapa con ese nombre.',
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rechaza con 400 las reglas cruzadas, todas juntas', async () => {
    const { servicio, manager } = armar();
    const error = await servicio
      .crear(
        dto({
          fechaInicio: '2026-10-31',
          fechaFin: '2026-10-01',
          ofertas: [
            { gradoId: 1, catalogoId: 1, cantidadMaxima: 5 },
            { gradoId: 1, catalogoId: 1, cantidadMaxima: 6 },
          ],
        }),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      message: [
        'El fin de selección debe ser igual o posterior al inicio.',
        'No se puede repetir la combinación de grado y catálogo.',
      ],
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rechaza con 400 escuelas o grados que no existen', async () => {
    const { servicio } = armar({ existen: { escuelas: 1 } });
    const error = await servicio.crear(dto()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      message: ['Algunas escuelas seleccionadas no existen.'],
    });
  });

  it('traduce la violación del índice de etapa visible a 409', async () => {
    const { servicio, manager } = armar();
    manager.save.mockRejectedValueOnce(
      Object.assign(new Error('dup'), {
        code: '23505',
        constraint: 'uq_etapas_visible',
      }),
    );
    await expect(servicio.crear(dto({ visible: true }))).rejects.toThrow(
      'Otra etapa se publicó al mismo tiempo.',
    );
  });
});

describe('EtapasService.actualizar', () => {
  const etapa = (): Partial<Etapa> => ({ id: 5, nombre: 'E2E Etapa' });
  const oferta: Partial<Oferta> = {
    id: 20,
    etapaId: 5,
    gradoId: 1,
    catalogoId: 1,
    cantidadMaxima: 100,
  };

  it('actualiza la cantidad, agrega y quita ofertas, y solo cambia las escuelas pedidas', async () => {
    const { servicio, manager, relacion } = armar({
      etapa: etapa(),
      ofertas: [{ ...oferta }, { ...oferta, id: 21, gradoId: 2 }],
      escuelasAsignadas: [10, 12],
    });
    await servicio.actualizar(
      5,
      dto({
        escuelaIds: [10, 11],
        ofertas: [
          { gradoId: 1, catalogoId: 1, cantidadMaxima: 50 },
          { gradoId: 3, catalogoId: 1, cantidadMaxima: 100 },
        ],
      }),
    );
    // la oferta que sigue baja de 100 a 50
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 20, cantidadMaxima: 50 }),
    );
    // la que ya no está se borra (lógico); la nueva se crea
    expect(manager.softRemove).toHaveBeenCalledWith([
      expect.objectContaining({ id: 21 }),
    ]);
    expect(manager.create).toHaveBeenCalledWith(
      Oferta,
      expect.objectContaining({ gradoId: 3, etapaId: 5 }),
    );
    // pivot: se agrega 11 y se quita 12; el 10 no se toca
    expect(relacion.add).toHaveBeenCalledWith([11]);
    expect(relacion.remove).toHaveBeenCalledWith([12]);
  });

  it('no deja quitar una oferta que tiene pedidos (409 con nombre y cantidad)', async () => {
    const { servicio, manager } = armar({
      etapa: etapa(),
      ofertas: [{ ...oferta }],
      pedidos: [
        { id: 1, ofertaId: 20, escuelaId: 10, cantidad: 2 },
        { id: 2, ofertaId: 20, escuelaId: 11, cantidad: 1 },
      ],
      escuelasAsignadas: [10, 11],
    });
    await expect(
      servicio.actualizar(
        5,
        dto({ ofertas: [{ gradoId: 9, catalogoId: 1, cantidadMaxima: 1 }] }),
      ),
    ).rejects.toThrow(
      'No se puede quitar "1er Grado – Inglés": tiene 2 pedidos.',
    );
    expect(manager.softRemove).not.toHaveBeenCalled();
  });

  it('no deja bajar la cantidad máxima por debajo de un pedido existente', async () => {
    const { servicio } = armar({
      etapa: etapa(),
      ofertas: [{ ...oferta }],
      pedidos: [{ id: 1, ofertaId: 20, escuelaId: 10, cantidad: 8 }],
      escuelasAsignadas: [10, 11],
    });
    const error = await servicio
      .actualizar(
        5,
        dto({ ofertas: [{ gradoId: 1, catalogoId: 1, cantidadMaxima: 5 }] }),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toContain('no puede ser menor a 8');
    // con exactamente el pedido más grande sí se puede
    await expect(
      servicio.actualizar(
        5,
        dto({ ofertas: [{ gradoId: 1, catalogoId: 1, cantidadMaxima: 8 }] }),
      ),
    ).resolves.toBeDefined();
  });

  it('no deja quitar escuelas con pedidos: nombra hasta 5 y cuenta el resto', async () => {
    const asignadas = [10, 11, 12, 13, 14, 15, 16];
    const { servicio, manager } = armar({
      etapa: etapa(),
      ofertas: [{ ...oferta }],
      pedidos: asignadas.map((escuelaId, i) => ({
        id: i,
        ofertaId: 20,
        escuelaId,
        cantidad: 1,
      })),
      escuelasAsignadas: asignadas,
    });
    manager.find.mockImplementation((entidad: unknown) =>
      Promise.resolve(
        entidad === Escuela
          ? asignadas.map((id) => ({ id, nombre: `Escuela ${id}` }))
          : entidad === Pedido
            ? asignadas.map((escuelaId, i) => ({
                id: i,
                ofertaId: 20,
                escuelaId,
                cantidad: 1,
              }))
            : [{ id: 1, nombre: 'X' }],
      ),
    );
    const error = await servicio
      .actualizar(5, dto({ escuelaIds: [] }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    const mensaje = (error as Error).message;
    expect(mensaje).toContain('Escuela 10 (1 pedido)');
    expect(mensaje).toContain('Escuela 14 (1 pedido)');
    expect(mensaje).not.toContain('Escuela 15');
    expect(mensaje).toContain('y 2 más');
  });

  it('al publicar oculta las demás, menos ella misma', async () => {
    const { servicio, manager } = armar({
      etapa: etapa(),
      ofertas: [{ ...oferta }],
      escuelasAsignadas: [10, 11],
    });
    await servicio.actualizar(5, dto({ visible: true }));
    expect(manager.update).toHaveBeenCalledWith(
      Etapa,
      expect.objectContaining({ visible: true, id: expect.anything() }),
      { visible: false },
    );
  });

  it('404 si no existe', async () => {
    const { servicio } = armar({ etapa: null });
    await expect(servicio.actualizar(9, dto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('EtapasService.cambiarVisible', () => {
  it('publicar oculta las demás; ocultar no toca a nadie más', async () => {
    const oculta = armar({ etapa: { id: 5, visible: false } });
    expect(await oculta.servicio.cambiarVisible(5)).toEqual({
      id: 5,
      visible: true,
    });
    expect(oculta.manager.update).toHaveBeenCalledTimes(1);

    const publicada = armar({ etapa: { id: 5, visible: true } });
    expect(await publicada.servicio.cambiarVisible(5)).toEqual({
      id: 5,
      visible: false,
    });
    expect(publicada.manager.update).not.toHaveBeenCalled();
  });
});

describe('EtapasService.eliminar', () => {
  it('con pedidos da 409 y no borra nada', async () => {
    const { servicio, manager } = armar({
      etapa: { id: 5, nombre: 'E2E Etapa' },
      ofertas: [{ id: 20 }],
      pedidos: [{ id: 1 }, { id: 2 }],
    });
    await expect(servicio.eliminar(5)).rejects.toThrow(
      'No se puede eliminar "E2E Etapa": tiene 2 pedidos de libros.',
    );
    expect(manager.softRemove).not.toHaveBeenCalled();
  });

  it('sin pedidos la oculta y borra (lógico) la etapa y sus ofertas', async () => {
    const e = { id: 5, nombre: 'E2E Etapa' };
    const { servicio, manager } = armar({
      etapa: e,
      ofertas: [{ id: 20 }],
    });
    await servicio.eliminar(5);
    expect(manager.update).toHaveBeenCalledWith(Etapa, 5, { visible: false });
    expect(manager.softRemove).toHaveBeenCalledWith([{ id: 20 }]);
    expect(manager.softRemove).toHaveBeenCalledWith(e);
  });
});

// ── DTO y reglas cruzadas ────────────────────────────────────────────────────

/** Mensajes del ValidationPipe global, incluidos los de las ofertas anidadas. */
async function mensajes(plano: Record<string, unknown>): Promise<string[]> {
  const aplanar = (e: ValidationError): string[] => [
    ...Object.values(e.constraints ?? {}),
    ...(e.children ?? []).flatMap(aplanar),
  ];
  const errores = await validate(plainToInstance(GuardarEtapaDto, plano), {
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: true,
  });
  return errores.flatMap(aplanar);
}

describe('GuardarEtapaDto', () => {
  it('acepta una etapa válida y recorta el nombre', async () => {
    expect(await mensajes(valido)).toEqual([]);
    expect(
      plainToInstance(GuardarEtapaDto, { ...valido, nombre: '  Etapa 1 ' })
        .nombre,
    ).toBe('Etapa 1');
  });

  it('las fechas y leyendas vacías pasan a null', () => {
    const d = plainToInstance(GuardarEtapaDto, {
      ...valido,
      fechaInicio: '',
      leyenda: '   ',
      reclamoLeyenda: '',
    });
    expect([d.fechaInicio, d.leyenda, d.reclamoLeyenda]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('valida el nombre y el formato de las fechas', async () => {
    expect(await mensajes({ ...valido, nombre: 'a' })).toEqual([
      'El nombre debe tener al menos 2 caracteres.',
    ]);
    for (const mala of ['01/10/2026', '2026-02-30', '2026-10-01T00:00:00Z']) {
      expect(await mensajes({ ...valido, fechaInicio: mala })).toEqual([
        'La fecha no es válida (formato aaaa-mm-dd).',
      ]);
    }
  });

  it('exige al menos una oferta, con cantidad entre 1 y 1000', async () => {
    expect(await mensajes({ ...valido, ofertas: [] })).toEqual([
      'Debe agregar al menos una combinación de grado y catálogo.',
    ]);
    const oferta = { gradoId: 1, catalogoId: 1 };
    expect(
      await mensajes({
        ...valido,
        ofertas: [{ ...oferta, cantidadMaxima: 0 }],
      }),
    ).toEqual(['La cantidad máxima debe ser 1 o mayor.']);
    expect(
      await mensajes({
        ...valido,
        ofertas: [{ ...oferta, cantidadMaxima: 1001 }],
      }),
    ).toEqual(['La cantidad máxima no puede superar 1000.']);
    expect(
      await mensajes({
        ...valido,
        ofertas: [{ ...oferta, cantidadMaxima: 1.5 }],
      }),
    ).toEqual(['La cantidad máxima debe ser un número entero.']);
  });

  it('rechaza escuelas repetidas y campos de más', async () => {
    expect(await mensajes({ ...valido, escuelaIds: [1, 1] })).toEqual([
      'Hay escuelas repetidas.',
    ]);
    expect(await mensajes({ ...valido, id: 3 })).toEqual([
      'property id should not exist',
    ]);
  });
});

describe('erroresCruzados', () => {
  const base = {
    fechaInicio: null,
    fechaFin: null,
    reclamoInicio: null,
    reclamoFin: null,
    ofertas: [{ gradoId: 1, catalogoId: 1, cantidadMaxima: 1 }],
  };

  it('las fechas van de a pares', () => {
    expect(erroresCruzados({ ...base, fechaInicio: '2026-10-01' })).toContain(
      'Si carga inicio de selección, debe cargar también el fin.',
    );
    expect(erroresCruzados({ ...base, fechaFin: '2026-10-01' })).toContain(
      'Si carga fin de selección, debe cargar también el inicio.',
    );
    expect(
      erroresCruzados({
        ...base,
        fechaInicio: '2026-10-01',
        fechaFin: '2026-10-02',
        reclamoInicio: '2026-11-01',
      }),
    ).toEqual(['Si carga inicio de reclamo, debe cargar también el fin.']);
  });

  it('el fin no puede ser anterior al inicio (el mismo día vale)', () => {
    const c = {
      ...base,
      reclamoInicio: '2026-11-05',
      reclamoFin: '2026-11-04',
    };
    expect(erroresCruzados(c)).toEqual([
      'El fin de reclamo debe ser igual o posterior al inicio.',
    ]);
    expect(erroresCruzados({ ...c, reclamoFin: '2026-11-05' })).toEqual([]);
  });

  it('pide al menos un período', () => {
    expect(erroresCruzados(base)).toEqual([
      'Debe cargar al menos un período (selección o reclamo).',
    ]);
  });
});
