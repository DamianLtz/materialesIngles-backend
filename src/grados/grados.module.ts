import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Libro } from '../catalogos/entities/libro.entity.js';
import { Oferta } from '../etapas/entities/oferta.entity.js';
import { Grado } from './entities/grado.entity.js';
import { GradosController } from './grados.controller.js';
import { GradosService } from './grados.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Grado, Libro, Oferta])],
  controllers: [GradosController],
  providers: [GradosService],
})
export class GradosModule {}
