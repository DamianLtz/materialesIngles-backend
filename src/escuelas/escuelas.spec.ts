import 'reflect-metadata'; // en la app lo carga Nest; acá no hay nadie que lo haga
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Repository } from 'typeorm';
import type { Pedido } from '../pedidos/entities/pedido.entity.js';
import { GuardarEscuelaDto } from './dto/escuela.dto.js';
import type { Escuela } from './entities/escuela.entity.js';
import { EscuelasService } from './escuelas.service.js';
import { puedeExportarEscuelas } from './exportacion.js';

async function mensajes(datos: Record<string, unknown>) {
  const errores = await validate(plainToInstance(GuardarEscuelaDto, datos), {
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: true,
  });
  return errores.flatMap((e) => Object.values(e.constraints ?? {}));
}

const valida = {
  cueanexo: '200002',
  nombre: 'Escuela Primaria N° 2',
  comuna: 4,
  calle: 'Av. Rivadavia',
  altura: 1234,
  codigoPostal: 'C1033',
};

describe('GuardarEscuelaDto', () => {
  it('acepta una escuela válida', async () => {
    expect(await mensajes(valida)).toEqual([]);
  });

  it('el CUE/Anexo solo admite dígitos (va en la URL pública)', async () => {
    expect(await mensajes({ ...valida, cueanexo: '20A002' })).toEqual([
      'El CUE/Anexo debe tener solo números (hasta 20).',
    ]);
    expect(await mensajes({ ...valida, cueanexo: '9'.repeat(21) })).toEqual([
      'El CUE/Anexo debe tener solo números (hasta 20).',
    ]);
    expect(await mensajes({ ...valida, cueanexo: 200002 })).toEqual([
      'El CUE/Anexo es obligatorio.',
    ]);
  });

  it('comuna y número son enteros dentro de un rango', async () => {
    expect(await mensajes({ ...valida, comuna: 0 })).toEqual([
      'La comuna debe estar entre 1 y 15.',
    ]);
    expect(await mensajes({ ...valida, comuna: 16 })).toEqual([
      'La comuna debe estar entre 1 y 15.',
    ]);
    expect(await mensajes({ ...valida, comuna: '4' })).toEqual([
      'La comuna debe ser un número.',
    ]);
    // Las migradas no tienen comuna, pero al guardar es obligatoria
    expect(await mensajes({ ...valida, comuna: null })).toEqual([
      'La comuna debe ser un número.',
    ]);
    expect(await mensajes({ ...valida, altura: -1 })).toEqual([
      'El número no puede ser negativo.',
    ]);
    // 0 significa "sin número"
    expect(await mensajes({ ...valida, altura: 0 })).toEqual([]);
  });

  it('la descripción es opcional: vacía o null quedan en null', () => {
    for (const descripcion of ['', '   ', null]) {
      const dto = plainToInstance(GuardarEscuelaDto, {
        ...valida,
        descripcion,
      });
      expect(dto.descripcion).toBeNull();
    }
  });
});

describe('EscuelasService.eliminar', () => {
  function armar(pedidos: number, escuela: Partial<Escuela> | null) {
    const escuelas = {
      findOneBy: vi.fn().mockResolvedValue(escuela),
      softRemove: vi.fn().mockResolvedValue(undefined),
    };
    const servicio = new EscuelasService(
      escuelas as unknown as Repository<Escuela>,
      {
        countBy: vi.fn().mockResolvedValue(pedidos),
      } as unknown as Repository<Pedido>,
    );
    return { servicio, escuelas };
  }
  const escuela = { id: 1, nombre: 'Escuela N° 1' };

  it('borra (lógico) una escuela sin pedidos', async () => {
    const { servicio, escuelas } = armar(0, escuela);
    await servicio.eliminar(1);
    expect(escuelas.softRemove).toHaveBeenCalledWith(escuela);
  });

  it('rechaza una escuela con pedidos vigentes', async () => {
    const { servicio, escuelas } = armar(7, escuela);
    await expect(servicio.eliminar(1)).rejects.toThrow(
      /tiene 7 pedidos de libros\./,
    );
    expect(escuelas.softRemove).not.toHaveBeenCalled();
    await expect(armar(7, escuela).servicio.eliminar(1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404 si no existe', async () => {
    await expect(armar(0, null).servicio.eliminar(9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('puedeExportarEscuelas', () => {
  const config = (valor?: string) =>
    ({ get: () => valor }) as unknown as ConfigService;

  it('permite solo a los emails de la lista, sin importar mayúsculas ni espacios', () => {
    const c = config(' Ana@bue.edu.ar , luis@bue.edu.ar');
    expect(puedeExportarEscuelas(c, 'ana@bue.edu.ar')).toBe(true);
    expect(puedeExportarEscuelas(c, 'LUIS@bue.edu.ar')).toBe(true);
    expect(puedeExportarEscuelas(c, 'otro@bue.edu.ar')).toBe(false);
  });

  it('sin lista configurada nadie puede exportar', () => {
    expect(puedeExportarEscuelas(config(undefined), 'ana@bue.edu.ar')).toBe(
      false,
    );
    expect(puedeExportarEscuelas(config(''), 'ana@bue.edu.ar')).toBe(false);
  });
});
