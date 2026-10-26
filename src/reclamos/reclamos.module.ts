import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Etapa } from '../etapas/entities/etapa.entity.js';
import { Reclamo } from './entities/reclamo.entity.js';
import { TipoReclamo } from './entities/tipo-reclamo.entity.js';
import { ReclamosController } from './reclamos.controller.js';
import { ReclamosService } from './reclamos.service.js';
import { TiposReclamoController } from './tipos-reclamo.controller.js';
import { TiposReclamoService } from './tipos-reclamo.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([TipoReclamo, Reclamo, Etapa])],
  controllers: [TiposReclamoController, ReclamosController],
  providers: [TiposReclamoService, ReclamosService],
})
export class ReclamosModule {}
