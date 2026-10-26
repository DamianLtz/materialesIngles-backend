import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../auth/decoradores.js';
import {
  hoyParaArchivo,
  nombreParaArchivo,
  TIPO_XLSX,
} from '../common/excel.js';
import { Rol } from '../usuarios/entities/usuario.entity.js';
import {
  CambiarEstadoDto,
  ListadoReclamosQueryDto,
} from './dto/reclamo.dto.js';
import { ReclamosService } from './reclamos.service.js';

/**
 * Reclamos en el backoffice: los 3 roles ven, cambian el estado y exportan; archivar
 * (masivo e irreversible) es de super_admin y admin (decisión del 22/10/2026).
 */
@Controller('back/reclamos')
export class ReclamosController {
  constructor(private readonly reclamos: ReclamosService) {}

  @Get()
  listar(@Query() query: ListadoReclamosQueryDto) {
    return this.reclamos.listar(query);
  }

  @Get('etapas')
  etapas() {
    return this.reclamos.etapasParaFiltro();
  }

  @Patch(':id/estado')
  cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CambiarEstadoDto,
  ) {
    return this.reclamos.cambiarEstado(id, dto);
  }

  @Get('exportar/:etapaId')
  async exportar(
    @Param('etapaId', ParseIntPipe) etapaId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { archivo, etapaNombre } = await this.reclamos.exportar(etapaId);
    res.set({
      'Content-Type': TIPO_XLSX,
      'Content-Disposition': `attachment; filename="reclamos-${nombreParaArchivo(etapaNombre)}-${hoyParaArchivo()}.xlsx"`,
    });
    return new StreamableFile(archivo);
  }

  @Roles(Rol.Admin)
  @Get('archivar/:etapaId')
  contarArchivables(@Param('etapaId', ParseIntPipe) etapaId: number) {
    return this.reclamos.contarArchivables(etapaId);
  }

  @Roles(Rol.Admin)
  @Post('archivar/:etapaId')
  @HttpCode(200)
  archivar(@Param('etapaId', ParseIntPipe) etapaId: number) {
    return this.reclamos.archivar(etapaId);
  }
}
