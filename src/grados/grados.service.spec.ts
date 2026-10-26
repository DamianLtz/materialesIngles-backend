import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Libro } from '../catalogos/entities/libro.entity.js';
import type { Oferta } from '../etapas/entities/oferta.entity.js';
import { Grado } from './entities/grado.entity.js';
import { GradosService } from './grados.service.js';

function armarServicio(opciones: {
  grado?: Partial<Grado> | null;
  libros?: number;
  ofertas?: number;
  otroConMismoNombre?: Partial<Grado> | null;
}) {
  const grados = {
    findOneBy: vi.fn().mockResolvedValue(opciones.grado ?? null),
    findOne: vi.fn().mockResolvedValue(opciones.otroConMismoNombre ?? null),
    softRemove: vi.fn().mockResolvedValue(undefined),
    save: vi.fn(),
    create: vi.fn((datos: Partial<Grado>) => datos),
  };
  const libros = { countBy: vi.fn().mockResolvedValue(opciones.libros ?? 0) };
  const ofertas = { countBy: vi.fn().mockResolvedValue(opciones.ofertas ?? 0) };
  const servicio = new GradosService(
    grados as unknown as Repository<Grado>,
    libros as unknown as Repository<Libro>,
    ofertas as unknown as Repository<Oferta>,
  );
  return { servicio, grados };
}

describe('GradosService.eliminar', () => {
  const grado = { id: 1, nombre: '1er Grado' };

  it('hace borrado lógico si el grado no está en uso', async () => {
    const { servicio, grados } = armarServicio({ grado });
    await servicio.eliminar(1);
    expect(grados.softRemove).toHaveBeenCalledWith(grado);
  });

  it('rechaza si hay libros vigentes con ese grado', async () => {
    const { servicio, grados } = armarServicio({ grado, libros: 2 });
    await expect(servicio.eliminar(1)).rejects.toThrow(
      /está en uso en 2 libros\./,
    );
    expect(grados.softRemove).not.toHaveBeenCalled();
  });

  it('informa libros y ofertas juntos', async () => {
    const { servicio } = armarServicio({ grado, libros: 1, ofertas: 3 });
    await expect(servicio.eliminar(1)).rejects.toThrow(/1 libro y 3 ofertas\./);
  });

  it('404 si el grado no existe', async () => {
    const { servicio } = armarServicio({ grado: null });
    await expect(servicio.eliminar(9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('GradosService nombre único', () => {
  it('no deja crear si otro grado tiene el nombre (sin distinguir mayúsculas)', async () => {
    const { servicio, grados } = armarServicio({
      otroConMismoNombre: { id: 5, nombre: '1er grado' },
    });
    await expect(
      servicio.crear({ nombre: '1ER GRADO' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(grados.save).not.toHaveBeenCalled();
  });

  it('al editar, el mismo grado puede conservar su nombre', async () => {
    const { servicio, grados } = armarServicio({
      grado: { id: 5, nombre: 'Viejo' },
      otroConMismoNombre: { id: 5, nombre: 'Nuevo' },
    });
    grados.save.mockResolvedValue({
      id: 5,
      nombre: 'Nuevo',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      servicio.actualizar(5, { nombre: 'Nuevo' }),
    ).resolves.toMatchObject({ id: 5, nombre: 'Nuevo' });
  });
});
