import { Module } from '@nestjs/common';
import { AsignacionMasivaController } from './asignacion-masiva.controller.js';
import { AsignacionMasivaService } from './asignacion-masiva.service.js';

@Module({
  controllers: [AsignacionMasivaController],
  providers: [AsignacionMasivaService],
})
export class AsignacionMasivaModule {}
