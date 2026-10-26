import 'reflect-metadata'; // en la app lo carga Nest; acá no hay nadie que lo haga
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource } from 'typeorm';
import { crearXlsx } from '../common/excel.js';
import { Etapa } from '../etapas/entities/etapa.entity.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import { AsignacionMasivaService } from './asignacion-masiva.service.js';
import {
  FilaGuardarDto,
  GuardarMasivoDto,
  SyncMasivoDto,
} from './dto/asignacion-masiva.dto.js';
import { leerFilas, MAX_BYTES, MAX_FILAS } from './lector-excel.js';
import {
  gradoCoincide,
  validarFilas,
  type ContextoValidacion,
} from './validador.js';

vi.mock('./contexto.js', () => ({ cargarContexto: vi.fn() }));
const { cargarContexto } = await import('./contexto.js');

// ── Lector ──────────────────────────────────────────────────────────────────

const xlsx = (
  encabezados: string[],
  filas: (string | number | null)[][],
): Promise<Buffer> => crearXlsx(encabezados, filas);

describe('leerFilas', () => {
  it('lee las filas con encabezados en cualquier mayúscula, con tildes y alias', async () => {
    const buffer = await xlsx(
      ['CUE / Anexo', 'ISBN', 'Cantidad', 'Grado'],
      [
        [20000200, '978-950-466-954-8', 20, '2do Grado'],
        ['20000800', 9789876154635, '15', null],
      ],
    );
    expect(await leerFilas(buffer)).toEqual([
      {
        fila: 2,
        cueanexo: '20000200',
        isbn: '9789504669548',
        cantidad: '20',
        grado: '2do Grado',
      },
      {
        fila: 3,
        cueanexo: '20000800',
        isbn: '9789876154635',
        cantidad: '15',
        grado: '',
      },
    ]);
  });

  it('la columna grado es opcional', async () => {
    const buffer = await xlsx(
      ['cueanexo', 'isbn', 'cantidad'],
      [['1', '2', 3]],
    );
    expect((await leerFilas(buffer))[0].grado).toBe('');
  });

  it('ignora las filas vacías pero conserva el número de fila real', async () => {
    const buffer = await xlsx(
      ['cueanexo', 'isbn', 'cantidad'],
      [
        ['1', '2', 3],
        [null, null, null],
        ['4', '5', 6],
      ],
    );
    expect((await leerFilas(buffer)).map((f) => f.fila)).toEqual([2, 4]);
  });

  it('dice qué columnas faltan', async () => {
    const buffer = await xlsx(['cueanexo', 'grado'], [['1', '2']]);
    await expect(leerFilas(buffer)).rejects.toThrow(
      'Faltan columnas: isbn, cantidad.',
    );
  });

  it('rechaza lo que no es un .xlsx, un archivo vacío y uno sin filas', async () => {
    await expect(leerFilas(Buffer.from('cue,isbn\n1,2'))).rejects.toThrow(
      'no es un Excel (.xlsx) válido',
    );
    // Parece un zip pero no es un Excel
    await expect(
      leerFilas(Buffer.concat([Buffer.from('PK'), Buffer.alloc(50)])),
    ).rejects.toThrow('no es un Excel (.xlsx) válido');
    const soloEncabezado = await xlsx(['cueanexo', 'isbn', 'cantidad'], []);
    await expect(leerFilas(soloEncabezado)).rejects.toThrow(
      'no tiene filas para importar',
    );
  });

  it('rechaza más de 5 MB y más de 5000 filas', async () => {
    await expect(leerFilas(Buffer.alloc(MAX_BYTES + 1))).rejects.toThrow(
      'supera los 5 MB',
    );
    const muchas = await xlsx(
      ['cueanexo', 'isbn', 'cantidad'],
      Array.from({ length: MAX_FILAS + 1 }, (_, i) => [String(i), '1', 1]),
    );
    await expect(leerFilas(muchas)).rejects.toThrow(
      `el máximo es ${MAX_FILAS}`,
    );
  });
});

// ── Validador ───────────────────────────────────────────────────────────────

const ctx = (): ContextoValidacion => ({
  escuelasPorCue: new Map([
    ['S1', { id: 1, nombre: 'Escuela 1' }],
    ['S2', { id: 2, nombre: 'Escuela 2 (fuera de la etapa)' }],
    ['S3', { id: 3, nombre: 'Escuela 3' }],
    ['S4', { id: 4, nombre: 'Escuela 4' }],
  ]),
  escuelasDeLaEtapa: new Set([1, 3, 4]),
  librosPorIsbn: new Map([
    ['A', [{ id: 1, titulo: 'Libro A', gradoId: 1, catalogoId: 1 }]],
    ['A2', [{ id: 2, titulo: 'Libro A2', gradoId: 1, catalogoId: 1 }]],
    ['B', [{ id: 3, titulo: 'Libro B', gradoId: 2, catalogoId: 1 }]],
    ['B2', [{ id: 4, titulo: 'Libro B2', gradoId: 2, catalogoId: 1 }]],
    [
      'SIN-OFERTA',
      [{ id: 5, titulo: 'Libro raro', gradoId: 9, catalogoId: 1 }],
    ],
    [
      'AMBIGUO',
      [
        { id: 6, titulo: 'Libro 6', gradoId: 1, catalogoId: 1 },
        { id: 7, titulo: 'Libro 7', gradoId: 2, catalogoId: 1 },
      ],
    ],
  ]),
  ofertas: new Map([
    [
      '1-1',
      {
        id: 10,
        gradoNombre: '1er Grado',
        catalogoNombre: 'Inglés',
        cantidadMaxima: 5,
      },
    ],
    [
      '2-1',
      {
        id: 11,
        gradoNombre: '2do Grado',
        catalogoNombre: 'Inglés',
        cantidadMaxima: 3,
      },
    ],
  ]),
  pedidos: new Map([
    // S1 ya tiene el libro A (cantidad 2) en la oferta 10, sin reclamos
    [
      '1-10',
      { id: 100, libroId: 1, libroTitulo: 'Libro A', cantidad: 2, reclamos: 0 },
    ],
    // S4 tiene el libro B en la oferta 11, sin reclamos
    [
      '4-11',
      { id: 102, libroId: 3, libroTitulo: 'Libro B', cantidad: 1, reclamos: 0 },
    ],
    // S1 tiene el libro B en la oferta 11, con 2 reclamos
    [
      '1-11',
      { id: 101, libroId: 3, libroTitulo: 'Libro B', cantidad: 1, reclamos: 2 },
    ],
  ]),
});

const fila = (
  n: number,
  cueanexo: string,
  isbn: string,
  cantidad: string,
  grado = '',
) => ({
  fila: n,
  cueanexo,
  isbn,
  cantidad,
  grado,
});

describe('validarFilas', () => {
  it('clasifica nueva, actualiza y reemplaza', () => {
    const { filas, resueltas } = validarFilas(
      [
        fila(2, 'S3', 'A', '3'), // S3 no tiene pedido: nueva
        fila(3, 'S1', 'A', '4'), // S1 ya tiene A con 2: solo cambia la cantidad
        fila(4, 'S4', 'B2', '2'), // S4 tiene B y pide otro libro del mismo grado: reemplaza
      ],
      ctx(),
    );
    expect(filas.map((f) => f.estado)).toEqual([
      'nueva',
      'actualiza',
      'reemplaza',
    ]);
    expect(filas[1]).toMatchObject({
      cantidadAnterior: 2,
      libroAnterior: 'Libro A',
    });
    expect(filas[2]).toMatchObject({
      libroAnterior: 'Libro B',
      libro: 'Libro B2',
    });
    expect(resueltas.map((r) => r?.accion)).toEqual([
      'crear',
      'actualizar',
      'reemplazar',
    ]);
    expect(resueltas[0]).toMatchObject({
      escuelaId: 3,
      ofertaId: 10,
      libroId: 1,
    });
    expect(resueltas[2]).toMatchObject({ existenteId: 102, libroId: 4 });
  });

  it('lo que ya está igual queda "sin cambios"', () => {
    const { filas } = validarFilas([fila(2, 'S1', 'A', '2')], ctx());
    expect(filas[0].estado).toBe('sin_cambios');
  });

  it('el grado y el catálogo salen de la oferta del libro, y trae su máximo', () => {
    const { filas } = validarFilas([fila(2, 'S3', 'B', '1')], ctx());
    expect(filas[0]).toMatchObject({
      grado: '2do Grado',
      catalogo: 'Inglés',
      cantidadMaxima: 3,
      escuela: 'Escuela 3',
    });
  });

  it('errores de escuela', () => {
    const { filas } = validarFilas(
      [
        fila(2, '', 'A', '1'),
        fila(3, 'NOEXISTE', 'A', '1'),
        fila(4, 'S2', 'A', '1'),
      ],
      ctx(),
    );
    expect(filas.map((f) => f.errores)).toEqual([
      ['Falta el CUE/Anexo.'],
      ['CUE/Anexo no encontrado: NOEXISTE.'],
      ['La escuela no participa de la etapa publicada.'],
    ]);
    expect(filas.every((f) => f.estado === 'error')).toBe(true);
  });

  it('errores de libro', () => {
    const { filas } = validarFilas(
      [
        fila(2, 'S3', '', '1'),
        fila(3, 'S3', 'XXX', '1'),
        fila(4, 'S3', 'SIN-OFERTA', '1'),
        fila(5, 'S3', 'AMBIGUO', '1'),
      ],
      ctx(),
    );
    expect(filas.map((f) => f.errores)).toEqual([
      ['Falta el ISBN.'],
      ['ISBN no encontrado: XXX.'],
      ['"Libro raro" no corresponde a ninguna oferta de la etapa.'],
      [
        'ISBN ambiguo: corresponde a más de una oferta de la etapa (1er Grado – Inglés, 2do Grado – Inglés).',
      ],
    ]);
  });

  it('cantidad: entero de 1 al máximo, sin decimales', () => {
    const { filas } = validarFilas(
      [
        fila(2, 'S3', 'A', '1.5'),
        fila(3, 'S3', 'A', '0'),
        fila(4, 'S3', 'A', 'abc'),
        fila(5, 'S3', 'A', ''),
        fila(6, 'S3', 'A', '6'),
        fila(7, 'S3', 'A', '5'),
      ],
      ctx(),
    );
    expect(filas.map((f) => f.errores)).toEqual([
      ['Cantidad inválida: 1.5.'],
      ['Cantidad inválida: 0.'],
      ['Cantidad inválida: abc.'],
      ['Falta la cantidad.'],
      ['La cantidad máxima de 1er Grado – Inglés es 5.'],
      [],
    ]);
    expect(filas[5].estado).toBe('nueva');
  });

  it('el grado, si viene, controla contra el del libro (nombre o número)', () => {
    const una = (grado: string) =>
      validarFilas([fila(2, 'S3', 'A', '1', grado)], ctx()).filas[0];
    expect(una('1er Grado').estado).toBe('nueva');
    expect(una('1').estado).toBe('nueva');
    expect(una('1ER GRADO').estado).toBe('nueva');
    expect(una('2').estado).toBe('error');
    expect(una('3er Grado').estado).toBe('error');
    expect(una('2').errores[0]).toContain(
      'El grado no coincide: el libro es de 1er Grado y el archivo dice "2".',
    );
    expect(gradoCoincide('1', '12 Grado')).toBe(false);
  });

  it('una fila acumula todos sus errores', () => {
    const { filas } = validarFilas([fila(2, 'NO', 'XXX', '0')], ctx());
    expect(filas[0].errores).toEqual([
      'CUE/Anexo no encontrado: NO.',
      'ISBN no encontrado: XXX.',
      'Cantidad inválida: 0.',
    ]);
  });

  it('detecta la misma escuela y oferta repetida (la primera queda, la segunda es error)', () => {
    const { filas, resueltas } = validarFilas(
      [
        fila(2, 'S3', 'A', '1'),
        fila(3, 'S3', 'A2', '2'),
        fila(4, 'S3', 'B', '1'),
      ],
      ctx(),
    );
    expect(filas.map((f) => f.estado)).toEqual(['nueva', 'error', 'nueva']);
    expect(filas[1].errores).toEqual([
      'Fila repetida: la misma escuela y oferta ya aparece en la fila 2.',
    ]);
    expect(resueltas[1]).toBeNull();
  });

  it('una fila con error no hace "repetida" a la siguiente', () => {
    const { filas } = validarFilas(
      [fila(2, 'S3', 'A', '0'), fila(3, 'S3', 'A', '1')],
      ctx(),
    );
    expect(filas.map((f) => f.estado)).toEqual(['error', 'nueva']);
  });

  it('cambiar el libro de un pedido con reclamos falla solo esa fila', () => {
    const { filas, resueltas } = validarFilas(
      [fila(2, 'S1', 'B2', '1'), fila(3, 'S3', 'A', '1')],
      ctx(),
    );
    expect(filas[0].estado).toBe('error');
    expect(filas[0].errores).toEqual([
      'El pedido actual tiene 2 reclamos: no se puede cambiar el libro.',
    ]);
    expect(resueltas[0]).toBeNull();
    expect(filas[1].estado).toBe('nueva');
  });

  it('con reclamos sí se puede cambiar solo la cantidad (mismo libro)', () => {
    const { filas } = validarFilas([fila(2, 'S1', 'B', '3')], ctx());
    expect(filas[0].estado).toBe('actualiza');
  });
});

// ── Guardado ────────────────────────────────────────────────────────────────

describe('AsignacionMasivaService.save', () => {
  function armar(publicada = true) {
    const guardados: unknown[] = [];
    const borrados: unknown[] = [];
    const existentes = [
      { id: 100, libroId: 1, cantidad: 2, escuelaId: 1, ofertaId: 10 },
      { id: 102, libroId: 3, cantidad: 1, escuelaId: 4, ofertaId: 11 },
    ];
    const manager = {
      findOneBy: vi.fn((entidad: unknown) =>
        Promise.resolve(
          entidad === Etapa && publicada ? { id: 7, nombre: 'E' } : null,
        ),
      ),
      find: vi.fn((entidad: unknown) =>
        Promise.resolve(
          entidad === Pedido ? existentes.map((e) => ({ ...e })) : [],
        ),
      ),
      create: vi.fn((_: unknown, datos: object) => ({ ...datos })),
      save: vi.fn((x: unknown) => {
        guardados.push(JSON.parse(JSON.stringify(x)));
        return Promise.resolve(x);
      }),
      softRemove: vi.fn((x: unknown) => {
        borrados.push(x);
        return Promise.resolve(x);
      }),
    };
    const dataSource = {
      manager,
      transaction: (t: (m: typeof manager) => Promise<unknown>) => t(manager),
    };
    vi.mocked(cargarContexto).mockResolvedValue(ctx());
    const servicio = new AsignacionMasivaService(
      dataSource as unknown as DataSource,
    );
    return { servicio, guardados, borrados, existentes };
  }
  const entrada = (cueanexo: string, isbn: string, cantidad: string) =>
    ({ cueanexo, isbn, cantidad }) as FilaGuardarDto;

  it('aplica solo las filas válidas, vuelve a validar y cuenta cada caso', async () => {
    const { servicio, guardados, borrados, existentes } = armar();
    const r = await servicio.save([
      entrada('S3', 'A', '3'), // nueva
      entrada('S1', 'A', '4'), // actualiza
      entrada('S4', 'B2', '2'), // reemplaza
      entrada('S3', 'XXX', '1'), // error: ISBN
      entrada('S3', 'B', '99'), // error: tope (aunque el navegador lo haya dejado pasar)
    ]);
    expect(r).toMatchObject({
      nuevas: 1,
      actualizadas: 1,
      reemplazadas: 1,
      sinCambios: 0,
      omitidas: 2,
    });
    expect(r.errores.map((e) => e.fila)).toEqual([5, 6]);
    // El reemplazado se borra de forma lógica (nunca física) y se crea el nuevo
    expect(borrados).toEqual([existentes[1]]);
    expect(guardados).toEqual([
      { escuelaId: 3, ofertaId: 10, libroId: 1, cantidad: 3 },
      { ...existentes[0], cantidad: 4 },
      { escuelaId: 4, ofertaId: 11, libroId: 4, cantidad: 2 },
    ]);
  });

  it('sin etapa publicada responde 409', async () => {
    const { servicio } = armar(false);
    await expect(
      servicio.save([entrada('S3', 'A', '1')]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sync asigna un mismo libro a varias escuelas con las mismas reglas', async () => {
    const { servicio, guardados } = armar();
    const r = await servicio.sync({
      isbn: 'A',
      cantidad: '2',
      cueanexos: ['S3', 'S2', 'NOEXISTE'],
    });
    expect(r).toMatchObject({ nuevas: 1, omitidas: 2 });
    expect(r.errores.map((e) => e.cueanexo)).toEqual(['S2', 'NOEXISTE']);
    expect(guardados).toHaveLength(1);
  });
});

// ── DTO ─────────────────────────────────────────────────────────────────────

async function mensajes<T extends object>(
  clase: new () => T,
  plano: Record<string, unknown>,
): Promise<string[]> {
  const aplanar = (
    e: Awaited<ReturnType<typeof validate>>[number],
  ): string[] => [
    ...Object.values(e.constraints ?? {}),
    ...(e.children ?? []).flatMap(aplanar),
  ];
  const errores = await validate(plainToInstance(clase, plano), {
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: true,
  });
  return errores.flatMap(aplanar);
}

describe('DTO de asignación masiva', () => {
  it('save acepta la cantidad como número (la editada en pantalla) y la pasa a texto', async () => {
    const dto = plainToInstance(GuardarMasivoDto, {
      filas: [{ cueanexo: ' 1 ', isbn: '2', cantidad: 5 }],
    });
    expect(dto.filas[0]).toMatchObject({ cueanexo: '1', cantidad: '5' });
    expect(
      await mensajes(GuardarMasivoDto, {
        filas: [{ cueanexo: '1', isbn: '2', cantidad: 5 }],
      }),
    ).toEqual([]);
  });

  it('save no admite ids ni otros campos (no confía en el navegador)', async () => {
    expect(
      await mensajes(GuardarMasivoDto, {
        filas: [
          { cueanexo: '1', isbn: '2', cantidad: 5, escuelaId: 9, ofertaId: 3 },
        ],
      }),
    ).toEqual([
      'property escuelaId should not exist',
      'property ofertaId should not exist',
    ]);
  });

  it('save pide al menos una fila y no más de 5000', async () => {
    expect(await mensajes(GuardarMasivoDto, { filas: [] })).toEqual([
      'No hay filas para guardar.',
    ]);
    const muchas = Array.from({ length: MAX_FILAS + 1 }, () => ({
      cueanexo: '1',
      isbn: '2',
      cantidad: '1',
    }));
    expect(await mensajes(GuardarMasivoDto, { filas: muchas })).toEqual([
      `Son demasiadas filas: el máximo es ${MAX_FILAS}.`,
    ]);
  });

  it('sync pide isbn, cantidad y escuelas sin repetir', async () => {
    expect(
      await mensajes(SyncMasivoDto, {
        isbn: 'A',
        cantidad: 2,
        cueanexos: ['1', '2'],
      }),
    ).toEqual([]);
    expect(
      await mensajes(SyncMasivoDto, {
        isbn: 'A',
        cantidad: '2',
        cueanexos: [],
      }),
    ).toEqual(['Indicá al menos una escuela.']);
    expect(
      await mensajes(SyncMasivoDto, {
        isbn: 'A',
        cantidad: '2',
        cueanexos: ['1', '1'],
      }),
    ).toEqual(['Hay CUE/Anexo repetidos.']);
  });
});

it('BadRequestException es lo que devuelve el lector ante un archivo inválido', async () => {
  await expect(leerFilas(Buffer.from('x'))).rejects.toBeInstanceOf(
    BadRequestException,
  );
});
