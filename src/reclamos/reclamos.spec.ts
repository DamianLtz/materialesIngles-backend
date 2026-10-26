import 'reflect-metadata'; // en la app lo carga Nest; acá no hay nadie que lo haga
import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Repository } from 'typeorm';
import { hoyEnArgentina } from '../common/fechas.js';
import { Etapa } from '../etapas/entities/etapa.entity.js';
import {
  CambiarEstadoDto,
  ListadoReclamosQueryDto,
} from './dto/reclamo.dto.js';
import { EstadoReclamo, Reclamo } from './entities/reclamo.entity.js';
import {
  etapaPorDefecto,
  ReclamosService,
  type EtapaConFechas,
} from './reclamos.service.js';

const etapa = (
  id: number,
  fechaInicio: string | null,
  reclamoInicio: string | null,
  reclamoFin: string | null,
): EtapaConFechas => ({ id, fechaInicio, reclamoInicio, reclamoFin });

describe('etapaPorDefecto', () => {
  const hoy = '2026-10-22';

  it('prefiere la de reclamo abierto, con los extremos incluidos (cierra hoy: sigue abierta)', () => {
    const etapas = [
      etapa(1, '2026-01-01', '2026-02-01', '2026-02-28'),
      etapa(2, '2026-09-01', '2026-10-01', '2026-10-22'),
      etapa(3, '2026-08-01', '2026-10-23', '2026-10-30'), // empieza mañana: todavía no
    ];
    expect(etapaPorDefecto(etapas, hoy)).toBe(2);
  });

  it('con dos abiertas a la vez, la de inicio de reclamo más reciente', () => {
    const etapas = [
      etapa(2, '2026-09-01', '2026-10-01', '2026-10-22'),
      etapa(3, '2026-08-01', '2026-10-10', '2026-10-30'),
    ];
    expect(etapaPorDefecto(etapas, hoy)).toBe(3);
  });

  it('sin reclamo abierto, la del último reclamo ya cerrado (ignora las futuras)', () => {
    const etapas = [
      etapa(1, '2026-01-01', '2026-02-01', '2026-02-28'),
      etapa(2, '2026-05-01', '2026-06-01', '2026-06-30'),
      etapa(3, '2027-01-01', '2027-02-01', '2027-02-28'), // futura
    ];
    expect(etapaPorDefecto(etapas, hoy)).toBe(2);
  });

  it('sin períodos de reclamo, la de inicio de selección más reciente', () => {
    const etapas = [
      etapa(1, '2026-01-01', null, null),
      etapa(2, '2026-06-01', null, null),
      etapa(3, null, null, null),
    ];
    expect(etapaPorDefecto(etapas, hoy)).toBe(2);
  });

  it('sin etapas devuelve null', () => {
    expect(etapaPorDefecto([], hoy)).toBeNull();
  });

  it('usa el día de Argentina: a las 21:30 del 22 aún es 22 aunque en UTC ya sea 23', () => {
    const hoyAr = hoyEnArgentina(new Date('2026-10-23T00:30:00Z'));
    expect(hoyAr).toBe('2026-10-22');
    const etapas = [etapa(1, '2026-10-01', '2026-10-15', '2026-10-22')];
    expect(etapaPorDefecto(etapas, hoyAr)).toBe(1);
  });
});

describe('ReclamosService.cambiarEstado', () => {
  function armar(reclamo: Partial<Reclamo> | null) {
    const reclamos = {
      findOneBy: vi.fn().mockResolvedValue(reclamo),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const servicio = new ReclamosService(
      reclamos as unknown as Repository<Reclamo>,
      {} as Repository<Etapa>,
    );
    return { servicio, reclamos };
  }

  it.each([
    [EstadoReclamo.Pendiente, EstadoReclamo.Resuelto],
    [EstadoReclamo.Resuelto, EstadoReclamo.Pendiente],
    [EstadoReclamo.Rechazado, EstadoReclamo.EnProceso],
    [EstadoReclamo.EnProceso, EstadoReclamo.Rechazado],
  ])('pasa libremente de %s a %s', async (desde, hacia) => {
    const reclamo = { id: 1, estado: desde };
    const { servicio, reclamos } = armar(reclamo);
    await expect(
      servicio.cambiarEstado(1, { estado: hacia as never }),
    ).resolves.toEqual({ id: 1, estado: hacia });
    expect(reclamos.save).toHaveBeenCalledWith({ id: 1, estado: hacia });
  });

  it('un reclamo archivado no se puede cambiar (409)', async () => {
    const { servicio, reclamos } = armar({
      id: 1,
      estado: EstadoReclamo.Historico,
    });
    await expect(
      servicio.cambiarEstado(1, { estado: EstadoReclamo.Pendiente }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(reclamos.save).not.toHaveBeenCalled();
  });

  it('404 si no existe', async () => {
    const { servicio } = armar(null);
    await expect(
      servicio.cambiarEstado(9, { estado: EstadoReclamo.Pendiente }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReclamosService.archivar', () => {
  it('404 si la etapa no existe y no toca nada', async () => {
    const reclamos = { createQueryBuilder: vi.fn() };
    const etapas = { findOneBy: vi.fn().mockResolvedValue(null) };
    const servicio = new ReclamosService(
      reclamos as unknown as Repository<Reclamo>,
      etapas as unknown as Repository<Etapa>,
    );
    await expect(servicio.archivar(9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reclamos.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('devuelve cuántos archivó y excluye los que ya son históricos', async () => {
    const donde: string[] = [];
    const qb = {
      update: () => qb,
      set: (valores: unknown) => {
        donde.push(JSON.stringify(valores));
        return qb;
      },
      where: (cond: string) => {
        donde.push(cond);
        return qb;
      },
      andWhere: (cond: string) => {
        donde.push(cond);
        return qb;
      },
      execute: () => Promise.resolve({ affected: 4 }),
    };
    const reclamos = { createQueryBuilder: () => qb };
    const etapas = {
      findOneBy: vi.fn().mockResolvedValue({ id: 1, nombre: 'E' }),
    };
    const servicio = new ReclamosService(
      reclamos as unknown as Repository<Reclamo>,
      etapas as unknown as Repository<Etapa>,
    );
    await expect(servicio.archivar(1)).resolves.toEqual({ archivados: 4 });
    expect(donde).toContain('{"estado":"historico"}');
    expect(donde).toContain('estado <> :historico');
    expect(donde).toContain('deleted_at IS NULL');
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
  return errores.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('DTO de reclamos', () => {
  it('el cambio de estado acepta los 4 editables', async () => {
    for (const estado of ['pendiente', 'en_proceso', 'resuelto', 'rechazado']) {
      expect(await mensajes(CambiarEstadoDto, { estado })).toEqual([]);
    }
  });

  it('"historico" y valores raros se rechazan con 400', async () => {
    for (const estado of ['historico', 'cualquiera', 5]) {
      expect(await mensajes(CambiarEstadoDto, { estado })).toEqual([
        'El estado no es válido.',
      ]);
    }
    expect(await mensajes(CambiarEstadoDto, {})).toEqual([
      'El estado no es válido.',
    ]);
  });

  it('el listado valida etapaId y estado (histórico sí se puede filtrar)', async () => {
    expect(
      plainToInstance(ListadoReclamosQueryDto, { etapaId: '3' }).etapaId,
    ).toBe(3);
    expect(
      await mensajes(ListadoReclamosQueryDto, { estado: 'historico' }),
    ).toEqual([]);
    expect(
      await mensajes(ListadoReclamosQueryDto, { estado: 'x', etapaId: 'y' }),
    ).toEqual([
      'etapaId debe ser un número entero.',
      'El estado no es válido.',
    ]);
  });
});
