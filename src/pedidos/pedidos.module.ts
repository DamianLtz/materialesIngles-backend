import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Libro } from '../catalogos/entities/libro.entity.js';
import { Escuela } from '../escuelas/entities/escuela.entity.js';
import { Etapa } from '../etapas/entities/etapa.entity.js';
import { Oferta } from '../etapas/entities/oferta.entity.js';
import { Reclamo } from '../reclamos/entities/reclamo.entity.js';
import { Pedido } from './entities/pedido.entity.js';
import { PedidosController } from './pedidos.controller.js';
import { PedidosService } from './pedidos.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pedido, Etapa, Oferta, Escuela, Libro, Reclamo]),
  ],
  controllers: [PedidosController],
  providers: [PedidosService],
})
export class PedidosModule {}
