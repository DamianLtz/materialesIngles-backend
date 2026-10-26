import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Oferta } from '../etapas/entities/oferta.entity.js';
import { Grado } from '../grados/entities/grado.entity.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import { CatalogosController } from './catalogos.controller.js';
import { CatalogosService } from './catalogos.service.js';
import { Catalogo } from './entities/catalogo.entity.js';
import { Libro } from './entities/libro.entity.js';
import { LibrosController } from './libros.controller.js';
import { LibrosService } from './libros.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Catalogo, Libro, Grado, Oferta, Pedido])],
  controllers: [CatalogosController, LibrosController],
  providers: [CatalogosService, LibrosService],
})
export class CatalogosModule {}
