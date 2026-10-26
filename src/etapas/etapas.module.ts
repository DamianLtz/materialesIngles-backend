import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Catalogo } from '../catalogos/entities/catalogo.entity.js';
import { Escuela } from '../escuelas/entities/escuela.entity.js';
import { Grado } from '../grados/entities/grado.entity.js';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import { Etapa } from './entities/etapa.entity.js';
import { Oferta } from './entities/oferta.entity.js';
import { EtapasController } from './etapas.controller.js';
import { EtapasService } from './etapas.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Etapa, Oferta, Escuela, Grado, Catalogo, Pedido]),
  ],
  controllers: [EtapasController],
  providers: [EtapasService],
  exports: [EtapasService],
})
export class EtapasModule {}
