import 'reflect-metadata'; // en la app lo carga Nest; acá no hay nadie que lo haga
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource, Repository } from 'typeorm';
import { Libro } from '../catalogos/entities/libro.entity.js';
import { Escuela } from '../escuelas/entities/escuela.entity.js';
import { Etapa } from '../etapas/entities/etapa.entity.js';
import { Oferta } from '../etapas/entities/oferta.entity.js';
import { Reclamo } from '../reclamos/entities/reclamo.entity.js';
import {
  CambioPedidoDto,
  ListadoPedidosQueryDto,
  SincronizarPedidosDto,
} from './dto/pedido.dto.js';
import { Pedido } from './entities/pedido.entity.js';
import { PedidosService } from './pedidos.service.js';
import { decidirAccion, type PedidoActual } from './reemplazo.js';

describe('decidirAccion', () => {
  const actual: PedidoActual = { id: 1, libroId: 5, cantidad: 10, reclamos: 0 };
  const conReclamos = { ...actual, reclamos: 2 };

  it('crea si no había pedido', () => {
    expect(decidirAccion(undefined, { libroId: 5, cantidad: 3 })).toEqual({
      tipo: 'crear',
    });
  });

  it('no hace nada si es lo mismo o si se quita lo que no existe', () => {
    expect(decidirAccion(actual, { libroId: 5, cantidad: 10 })).toEqual({
      tipo: 'nada',
    });
    expect(decidirAccion(undefined, null)).toEqual({ tipo: 'nada' });
  });

  it('actualiza la fila si solo cambia la cantidad (aunque tenga reclamos)', () => {
    expect(decidirAccion(actual, { libroId: 5, cantidad: 4 })).toEqual({
      tipo: 'actualizar',
    });
    expect(decidirAccion(conReclamos, { libroId: 5, cantidad: 4 })).toEqual({
      tipo: 'actualizar',
    });
  });

  it('reemplaza si cambia el libro y no hay reclamos', () => {
    expect(decidirAccion(actual, { libroId: 6, cantidad: 10 })).toEqual({
      tipo: 'reemplazar',
    });
  });

  it('bloquea cambiar el libro o quitar el pedido si tiene reclamos', () => {
    expect(decidirAccion(conReclamos, { libroId: 6, cantidad: 10 })).toEqual({
      tipo: 'bloqueado',
      motivo: 'cambiar-libro',
    });
    expect(decidirAccion(conReclamos, null)).toEqual({
      tipo: 'bloqueado',
      motivo: 'quitar',
    });
  });

  it('quita si no tiene reclamos', () => {
    expect(decidirAccion(actual, null)).toEqual({ tipo: 'quitar' });
  });
});

/** Mensajes que devuelve el ValidationPipe global (stopAtFirstError: un mensaje por campo). */
async function mensajes<T extends object>(
  clase: new () => T,
  plano: Record<string, unknown>,
): Promise<string[]> {
  const errores = await validate(plainToInstance(clase, plano), {
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: true,
  });
  const aplanar = (e: (typeof errores)[number]): string[] => [
    ...Object.values(e.constraints ?? {}),
    ...(e.children ?? []).flatMap(aplanar),
  ];
  return errores.flatMap(aplanar);
}

describe('DTO de pedidos', () => {
  it('el cambio acepta asignar o quitar (libroId null)', async () => {
    expect(
      await mensajes(CambioPedidoDto, { ofertaId: 1, libroId: 2, cantidad: 3 }),
    ).toEqual([]);
    expect(
      await mensajes(CambioPedidoDto, { ofertaId: 1, libroId: null }),
    ).toEqual([]);
  });

  it('si falta libroId no se interpreta como quitar', async () => {
    expect(await mensajes(CambioPedidoDto, { ofertaId: 1 })).toEqual([
      'El libro es obligatorio (o null para quitar el pedido).',
      'La cantidad debe ser un número entero.',
    ]);
  });

  it('con libro exige una cantidad entera de 1 o más', async () => {
    expect(
      await mensajes(CambioPedidoDto, { ofertaId: 1, libroId: 2, cantidad: 0 }),
    ).toEqual(['La cantidad debe ser 1 o mayor.']);
    expect(
      await mensajes(CambioPedidoDto, { ofertaId: 1, libroId: 2 }),
    ).toEqual(['La cantidad debe ser un número entero.']);
  });

  it('sync pide al menos un cambio y rechaza campos de más', async () => {
    expect(await mensajes(SincronizarPedidosDto, { cambios: [] })).toEqual([
      'No hay cambios para guardar.',
    ]);
    expect(
      await mensajes(SincronizarPedidosDto, {
        cambios: [{ ofertaId: 1, libroId: null, escuelaId: 9 }],
      }),
    ).toEqual(['property escuelaId should not exist']);
  });

  it('el listado convierte etapaId a número', async () => {
    const dto = plainToInstance(ListadoPedidosQueryDto, { etapaId: '3' });
    expect(dto.etapaId).toBe(3);
    expect(await mensajes(ListadoPedidosQueryDto, { etapaId: 'x' })).toEqual([
      'etapaId debe ser un número entero.',
    ]);
  });
});

// ── PedidosService.sincronizar con un manager simulado ──────────────────────

const etapa = { id: 7, nombre: 'Etapa', visible: true };
const oferta = (id: number, gradoId = 1, catalogoId = 1, max = 5) => ({
  id,
  etapaId: 7,
  gradoId,
  catalogoId,
  cantidadMaxima: max,
  grado: { nombre: 'G' + gradoId },
  catalogo: { nombre: 'C' + catalogoId },
});
const libro = (id: number, gradoId = 1, catalogoId = 1) => ({
  id,
  titulo: 'Libro ' + id,
  gradoId,
  catalogoId,
});

function armar(opciones: {
  ofertas?: ReturnType<typeof oferta>[];
  libros?: ReturnType<typeof libro>[];
  pedidos?: Partial<Pedido>[];
  reclamos?: Record<number, number>;
  publicada?: boolean;
  participa?: boolean;
}) {
  const guardados: unknown[] = [];
  const borrados: unknown[] = [];
  const manager = {
    findOneBy: vi.fn((entidad: unknown) => {
      if (entidad === Escuela) return Promise.resolve({ id: 1 });
      if (entidad === Etapa) {
        return Promise.resolve(opciones.publicada === false ? null : etapa);
      }
      return Promise.resolve(null);
    }),
    query: vi.fn(() =>
      Promise.resolve(opciones.participa === false ? [] : [{ '?column?': 1 }]),
    ),
    find: vi.fn((entidad: unknown) => {
      if (entidad === Oferta) return Promise.resolve(opciones.ofertas ?? []);
      if (entidad === Libro) return Promise.resolve(opciones.libros ?? []);
      if (entidad === Pedido) return Promise.resolve(opciones.pedidos ?? []);
      return Promise.resolve([]);
    }),
    createQueryBuilder: vi.fn(() => {
      const qb = {
        select: () => qb,
        addSelect: () => qb,
        where: () => qb,
        groupBy: () => qb,
        getRawMany: () =>
          Promise.resolve(
            Object.entries(opciones.reclamos ?? {}).map(([id, cantidad]) => ({
              pedidoId: Number(id),
              cantidad,
            })),
          ),
      };
      return qb;
    }),
    create: vi.fn((_: unknown, datos: object) => ({ ...datos })),
    save: vi.fn((x: unknown) => {
      guardados.push(x);
      return Promise.resolve(x);
    }),
    softRemove: vi.fn((x: unknown) => {
      borrados.push(x);
      return Promise.resolve(x);
    }),
  };
  const dataSource = {
    manager,
    transaction: (trabajo: (m: typeof manager) => Promise<unknown>) =>
      trabajo(manager),
  };
  const repoEscuelas = {
    findOneBy: vi.fn().mockResolvedValue({ id: 1 }),
  };
  const servicio = new PedidosService(
    dataSource as unknown as DataSource,
    {} as Repository<Pedido>,
    {} as Repository<Etapa>,
    {} as Repository<Oferta>,
    repoEscuelas as unknown as Repository<Escuela>,
    {} as Repository<Libro>,
    {} as Repository<Reclamo>,
  );
  return { servicio, guardados, borrados };
}

const pedido = (id: number, ofertaId: number, libroId: number, cantidad = 2) =>
  ({ id, ofertaId, libroId, cantidad, escuelaId: 1 }) as Partial<Pedido>;

describe('PedidosService.sincronizar', () => {
  it('crea un pedido nuevo', async () => {
    const { servicio, guardados } = armar({
      ofertas: [oferta(10)],
      libros: [libro(20)],
    });
    const r = await servicio.sincronizar(1, [
      { ofertaId: 10, libroId: 20, cantidad: 3 },
    ]);
    expect(r).toMatchObject({ creados: 1 });
    expect(guardados).toEqual([
      { escuelaId: 1, ofertaId: 10, libroId: 20, cantidad: 3 },
    ]);
  });

  it('rechaza un libro de otro grado o catálogo y uno deshabilitado', async () => {
    const { servicio, guardados } = armar({
      ofertas: [oferta(10, 1, 1), oferta(11, 2, 1)],
      libros: [libro(20, 2, 1)], // el 21 no viene: deshabilitado o inexistente
    });
    const falla = servicio.sincronizar(1, [
      { ofertaId: 10, libroId: 20, cantidad: 1 },
      { ofertaId: 11, libroId: 21, cantidad: 1 },
    ]);
    await expect(falla).rejects.toBeInstanceOf(BadRequestException);
    await expect(falla).rejects.toMatchObject({
      response: {
        message: [
          'G1 – C1: "Libro 20" no corresponde a ese grado y catálogo.',
          'G2 – C1: el libro no existe o está deshabilitado.',
        ],
      },
    });
    expect(guardados).toEqual([]);
  });

  it('rechaza una cantidad mayor a la máxima de la oferta', async () => {
    const { servicio } = armar({
      ofertas: [oferta(10, 1, 1, 5)],
      libros: [libro(20)],
    });
    await expect(
      servicio.sincronizar(1, [{ ofertaId: 10, libroId: 20, cantidad: 6 }]),
    ).rejects.toMatchObject({
      response: { message: ['G1 – C1: la cantidad máxima es 5.'] },
    });
  });

  it('rechaza una oferta que no es de la etapa publicada y las repetidas', async () => {
    const { servicio } = armar({ ofertas: [] });
    await expect(
      servicio.sincronizar(1, [{ ofertaId: 99, libroId: null }]),
    ).rejects.toMatchObject({
      response: {
        message: ['La oferta 99 no pertenece a la etapa publicada.'],
      },
    });
    await expect(
      servicio.sincronizar(1, [
        { ofertaId: 1, libroId: null },
        { ofertaId: 1, libroId: null },
      ]),
    ).rejects.toThrow('No se puede repetir una oferta');
  });

  it('exige una etapa publicada en la que participe la escuela', async () => {
    const sin = armar({ publicada: false });
    await expect(
      sin.servicio.sincronizar(1, [{ ofertaId: 1, libroId: null }]),
    ).rejects.toBeInstanceOf(ConflictException);
    const noParticipa = armar({ participa: false });
    await expect(
      noParticipa.servicio.sincronizar(1, [{ ofertaId: 1, libroId: null }]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('solo cambia la cantidad: actualiza la fila y no borra nada', async () => {
    const existente = pedido(30, 10, 20, 2);
    const { servicio, guardados, borrados } = armar({
      ofertas: [oferta(10)],
      libros: [libro(20)],
      pedidos: [existente],
      reclamos: { 30: 1 }, // con reclamos igual se permite cambiar la cantidad
    });
    const r = await servicio.sincronizar(1, [
      { ofertaId: 10, libroId: 20, cantidad: 4 },
    ]);
    expect(r).toMatchObject({ actualizados: 1, reemplazados: 0 });
    expect(guardados).toEqual([{ ...existente, cantidad: 4 }]);
    expect(borrados).toEqual([]);
  });

  it('cambia el libro: borra el anterior (lógico) y crea el nuevo', async () => {
    const existente = pedido(30, 10, 20);
    const { servicio, guardados, borrados } = armar({
      ofertas: [oferta(10)],
      libros: [libro(21)],
      pedidos: [existente],
    });
    const r = await servicio.sincronizar(1, [
      { ofertaId: 10, libroId: 21, cantidad: 2 },
    ]);
    expect(r).toMatchObject({ reemplazados: 1 });
    expect(borrados).toEqual([existente]);
    expect(guardados).toEqual([
      { escuelaId: 1, ofertaId: 10, libroId: 21, cantidad: 2 },
    ]);
  });

  it('con reclamos, cambiar el libro o quitar da 409 y no escribe nada', async () => {
    const { servicio, guardados, borrados } = armar({
      ofertas: [oferta(10), oferta(11, 2, 1)],
      libros: [libro(21)],
      pedidos: [pedido(30, 10, 20), pedido(31, 11, 22)],
      reclamos: { 30: 2, 31: 1 },
    });
    const falla = servicio.sincronizar(1, [
      { ofertaId: 10, libroId: 21, cantidad: 2 },
      { ofertaId: 11, libroId: null },
    ]);
    await expect(falla).rejects.toBeInstanceOf(ConflictException);
    await expect(falla).rejects.toThrow(
      'No se puede cambiar el libro de "G1 – C1": tiene 2 reclamos. No se puede quitar el pedido de "G2 – C1": tiene 1 reclamo.',
    );
    expect(guardados).toEqual([]);
    expect(borrados).toEqual([]);
  });

  it('quita un pedido sin reclamos', async () => {
    const existente = pedido(30, 10, 20);
    const { servicio, borrados } = armar({
      ofertas: [oferta(10)],
      pedidos: [existente],
    });
    const r = await servicio.sincronizar(1, [{ ofertaId: 10, libroId: null }]);
    expect(r).toMatchObject({ quitados: 1 });
    expect(borrados).toEqual([existente]);
  });
});

describe('PedidosService.eliminar', () => {
  function armarEliminar(opciones: {
    pedido?: Partial<Pedido> | null;
    reclamos?: number;
  }) {
    const pedidos = {
      findOneBy: vi.fn().mockResolvedValue(opciones.pedido ?? null),
      softRemove: vi.fn().mockResolvedValue(undefined),
    };
    const reclamos = {
      countBy: vi.fn().mockResolvedValue(opciones.reclamos ?? 0),
    };
    const servicio = new PedidosService(
      {} as DataSource,
      pedidos as unknown as Repository<Pedido>,
      {} as Repository<Etapa>,
      {} as Repository<Oferta>,
      {} as Repository<Escuela>,
      {} as Repository<Libro>,
      reclamos as unknown as Repository<Reclamo>,
    );
    return { servicio, pedidos };
  }

  it('hace borrado lógico si no tiene reclamos', async () => {
    const p = { id: 3 };
    const { servicio, pedidos } = armarEliminar({ pedido: p });
    await servicio.eliminar(3);
    expect(pedidos.softRemove).toHaveBeenCalledWith(p);
  });

  it('409 si tiene reclamos y 404 si no existe', async () => {
    const con = armarEliminar({ pedido: { id: 3 }, reclamos: 2 });
    await expect(con.servicio.eliminar(3)).rejects.toThrow(
      'No se puede eliminar el pedido: tiene 2 reclamos.',
    );
    expect(con.pedidos.softRemove).not.toHaveBeenCalled();
    const sin = armarEliminar({ pedido: null });
    await expect(sin.servicio.eliminar(9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
