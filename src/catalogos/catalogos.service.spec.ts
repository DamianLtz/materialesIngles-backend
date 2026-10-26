import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Oferta } from '../etapas/entities/oferta.entity.js';
import type { Grado } from '../grados/entities/grado.entity.js';
import type { Pedido } from '../pedidos/entities/pedido.entity.js';
import { CatalogosService } from './catalogos.service.js';
import type { Catalogo } from './entities/catalogo.entity.js';
import type { Libro } from './entities/libro.entity.js';
import { LibrosService } from './libros.service.js';

const conteo = (n = 0) => ({ countBy: vi.fn().mockResolvedValue(n) });

function servicioDeCatalogos(opciones: {
  catalogo?: Partial<Catalogo> | null;
  libros?: number;
  ofertas?: number;
}) {
  const catalogos = {
    findOneBy: vi.fn().mockResolvedValue(opciones.catalogo ?? null),
    softRemove: vi.fn().mockResolvedValue(undefined),
  };
  const servicio = new CatalogosService(
    catalogos as unknown as Repository<Catalogo>,
    conteo(opciones.libros) as unknown as Repository<Libro>,
    conteo(opciones.ofertas) as unknown as Repository<Oferta>,
  );
  return { servicio, catalogos };
}

describe('CatalogosService.eliminar', () => {
  const catalogo = { id: 1, nombre: 'Inglés' };

  it('borra (lógico) un catálogo sin libros ni ofertas', async () => {
    const { servicio, catalogos } = servicioDeCatalogos({ catalogo });
    await servicio.eliminar(1);
    expect(catalogos.softRemove).toHaveBeenCalledWith(catalogo);
  });

  it('rechaza si tiene libros, y dice cuántos', async () => {
    const { servicio, catalogos } = servicioDeCatalogos({
      catalogo,
      libros: 118,
    });
    await expect(servicio.eliminar(1)).rejects.toThrow(/tiene 118 libros\./);
    expect(catalogos.softRemove).not.toHaveBeenCalled();
  });

  it('informa libros y ofertas juntos', async () => {
    const { servicio } = servicioDeCatalogos({
      catalogo,
      libros: 1,
      ofertas: 1,
    });
    await expect(servicio.eliminar(1)).rejects.toThrow(
      /tiene 1 libro y 1 oferta\./,
    );
  });

  it('404 si no existe', async () => {
    const { servicio } = servicioDeCatalogos({ catalogo: null });
    await expect(servicio.eliminar(9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('LibrosService.eliminar', () => {
  function servicioDeLibros(pedidos: number) {
    const libros = {
      findOneBy: vi.fn().mockResolvedValue({ id: 7, titulo: 'Rainbow' }),
      softRemove: vi.fn().mockResolvedValue(undefined),
    };
    const servicio = new LibrosService(
      libros as unknown as Repository<Libro>,
      {} as unknown as Repository<Catalogo>,
      {} as unknown as Repository<Grado>,
      conteo(pedidos) as unknown as Repository<Pedido>,
    );
    return { servicio, libros };
  }

  it('borra un libro que ninguna escuela pidió', async () => {
    const { servicio, libros } = servicioDeLibros(0);
    await servicio.eliminar(7);
    expect(libros.softRemove).toHaveBeenCalled();
  });

  it('rechaza un libro que está en pedidos vigentes', async () => {
    const { servicio, libros } = servicioDeLibros(3);
    await expect(servicio.eliminar(7)).rejects.toThrow(
      /está en 3 pedidos de escuelas\./,
    );
    expect(libros.softRemove).not.toHaveBeenCalled();
  });
});
