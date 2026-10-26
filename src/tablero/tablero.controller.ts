import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { TableroService } from './tablero.service.js';

/**
 * Tablero del backoffice: lo ven los 3 roles (es la pantalla de inicio). La descarga de
 * escuelas pendientes es de super_admin y admin, como los pedidos.
 */
@Controller('back/tablero')
export class TableroController {
  constructor(private readonly tablero: TableroService) {}

  @Get('etapas')
  etapas() {
    return this.tablero.etapas();
  }

  @Get()
  resumen(
    @Query('etapaId', new ParseIntPipe({ optional: true })) etapaId?: number,
  ) {
    return this.tablero.resumen(etapaId);
  }

  @Roles(Rol.Admin)
  @Get('exportar-pendientes/:etapaId')
  async exportarPendientes(
    @Param('etapaId', ParseIntPipe) etapaId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { archivo, etapaNombre } =
      await this.tablero.exportarPendientes(etapaId);
    res.set({
      'Content-Type': TIPO_XLSX,
      'Content-Disposition': `attachment; filename="pendientes-${nombreParaArchivo(etapaNombre)}-${hoyParaArchivo()}.xlsx"`,
    });
    return new StreamableFile(archivo);
  }
}
