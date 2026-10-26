import 'reflect-metadata'; // en la app lo carga Nest; acá no hay nadie que lo haga
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ActualizarLibroDto,
  CrearLibroDto,
} from '../catalogos/dto/libro.dto.js';
import { GuardarGradoDto } from '../grados/dto/guardar-grado.dto.js';
import { GuardarTipoReclamoDto } from '../reclamos/dto/guardar-tipo-reclamo.dto.js';
import { ListadoQueryDto } from './listado.js';

/** Mensajes que devuelve el ValidationPipe global (stopAtFirstError: un mensaje por campo). */
async function mensajes<T extends object>(
  clase: new () => T,
  datos: Record<string, unknown>,
): Promise<string[]> {
  const errores = await validate(plainToInstance(clase, datos), {
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: true,
  });
  return errores.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('GuardarGradoDto', () => {
  it('acepta un nombre válido y lo recorta', async () => {
    const dto = plainToInstance(GuardarGradoDto, { nombre: '  1er Grado ' });
    expect(dto.nombre).toBe('1er Grado');
    expect(await mensajes(GuardarGradoDto, { nombre: '1er Grado' })).toEqual(
      [],
    );
  });

  it('da un solo mensaje claro según el problema', async () => {
    expect(await mensajes(GuardarGradoDto, {})).toEqual([
      'El nombre es obligatorio.',
    ]);
    expect(await mensajes(GuardarGradoDto, { nombre: 5 })).toEqual([
      'El nombre es obligatorio.',
    ]);
    expect(await mensajes(GuardarGradoDto, { nombre: 'a' })).toEqual([
      'El nombre debe tener al menos 2 caracteres.',
    ]);
    expect(
      await mensajes(GuardarGradoDto, { nombre: 'a'.repeat(256) }),
    ).toEqual(['El nombre no puede superar los 255 caracteres.']);
  });
});

describe('GuardarTipoReclamoDto', () => {
  it('la leyenda es opcional: vacía, con espacios o null quedan en null', () => {
    for (const leyenda of ['', '   ', null]) {
      const dto = plainToInstance(GuardarTipoReclamoDto, {
        nombre: 'Rotura',
        leyenda,
      });
      expect(dto.leyenda).toBeNull();
    }
  });

  it('valida el tipo y el largo de la leyenda', async () => {
    expect(
      await mensajes(GuardarTipoReclamoDto, { nombre: 'Rotura', leyenda: 5 }),
    ).toEqual(['La leyenda debe ser un texto.']);
    expect(
      await mensajes(GuardarTipoReclamoDto, {
        nombre: 'Rotura',
        leyenda: 'a'.repeat(1001),
      }),
    ).toEqual(['La leyenda no puede superar los 1000 caracteres.']);
    expect(
      await mensajes(GuardarTipoReclamoDto, {
        nombre: 'Rotura',
        leyenda: 'a'.repeat(1000),
      }),
    ).toEqual([]);
  });

  it('rechaza campos que no existen (mass assignment)', async () => {
    expect(
      await mensajes(GuardarTipoReclamoDto, { nombre: 'Rotura', id: 7 }),
    ).toEqual(['property id should not exist']);
  });
});

describe('CrearLibroDto', () => {
  const valido = {
    titulo: 'Rainbow Bridge 1',
    isbn: '9780194118415',
    editorial: 'Oxford',
    gradoId: 1,
    catalogoId: 2,
  };

  it('acepta un libro completo y recorta los textos', async () => {
    const dto = plainToInstance(CrearLibroDto, {
      ...valido,
      titulo: '  Rainbow Bridge 1 ',
      isbn: ' 9780194118415 ',
    });
    expect([dto.titulo, dto.isbn]).toEqual([
      'Rainbow Bridge 1',
      '9780194118415',
    ]);
    expect(await mensajes(CrearLibroDto, valido)).toEqual([]);
  });

  it('exige ISBN y editorial (en la base eran NOT NULL)', async () => {
    expect(
      await mensajes(CrearLibroDto, { ...valido, isbn: undefined }),
    ).toEqual(['El ISBN es obligatorio.']);
    expect(await mensajes(CrearLibroDto, { ...valido, isbn: '   ' })).toEqual([
      'El ISBN es obligatorio.',
    ]);
    expect(await mensajes(CrearLibroDto, { ...valido, editorial: '' })).toEqual(
      ['La editorial es obligatoria.'],
    );
  });

  it('valida los límites de largo y que el grado sea un número', async () => {
    expect(
      await mensajes(CrearLibroDto, { ...valido, isbn: '9'.repeat(31) }),
    ).toEqual(['El ISBN no puede superar los 30 caracteres.']);
    expect(await mensajes(CrearLibroDto, { ...valido, gradoId: '1' })).toEqual([
      'Seleccioná un grado.',
    ]);
  });

  it('al editar no se admite cambiar de catálogo', async () => {
    const { catalogoId, ...sinCatalogo } = valido;
    expect(await mensajes(ActualizarLibroDto, sinCatalogo)).toEqual([]);
    expect(
      await mensajes(ActualizarLibroDto, { ...sinCatalogo, catalogoId }),
    ).toEqual(['property catalogoId should not exist']);
  });
});

describe('ListadoQueryDto', () => {
  it('usa page=1 y perPage=5 por defecto', () => {
    const dto = plainToInstance(ListadoQueryDto, {});
    expect([dto.page, dto.perPage]).toEqual([1, 5]);
  });

  it('convierte los números que llegan como texto', async () => {
    const dto = plainToInstance(ListadoQueryDto, { page: '3', perPage: '20' });
    expect([dto.page, dto.perPage]).toEqual([3, 20]);
    expect(await mensajes(ListadoQueryDto, { page: '3' })).toEqual([]);
  });

  it('da mensajes claros para valores inválidos', async () => {
    expect(await mensajes(ListadoQueryDto, { page: 'abc' })).toEqual([
      'page debe ser un número entero.',
    ]);
    expect(await mensajes(ListadoQueryDto, { page: '0' })).toEqual([
      'page debe ser 1 o mayor.',
    ]);
    expect(await mensajes(ListadoQueryDto, { perPage: '500' })).toEqual([
      'perPage no puede superar 100.',
    ]);
  });
});
