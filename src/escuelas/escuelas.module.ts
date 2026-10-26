import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pedido } from '../pedidos/entities/pedido.entity.js';
import { Escuela } from './entities/escuela.entity.js';
import { EscuelasController } from './escuelas.controller.js';
import { EscuelasService } from './escuelas.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Escuela, Pedido])],
  controllers: [EscuelasController],
  providers: [EscuelasService],
})
export class EscuelasModule {}
