import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { UsuarioActual } from '../auth/decoradores.js';
import { hoyParaArchivo, TIPO_XLSX } from '../common/excel.js';
import { ListadoQueryDto } from '../common/listado.js';
import type { Usuario } from '../usuarios/entities/usuario.entity.js';
import {
  ExportarEscuelasQueryDto,
  GuardarEscuelaDto,
} from './dto/escuela.dto.js';
import { EscuelasService } from './escuelas.service.js';
import { puedeExportarEscuelas } from './exportacion.js';

@Controller('back/escuelas')
export class EscuelasController {
  constructor(
    private readonly escuelas: EscuelasService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  listar(@Query() query: ListadoQueryDto) {
    return this.escuelas.listar(query);
  }

  /** Todas las escuelas, sin paginar, para los selectores (ej. asignar escuelas a una etapa). */
  @Get('opciones')
  opciones() {
    return this.escuelas.opciones();
  }

  /** Descarga el Excel. Solo para los emails de EXPORTAR_ESCUELAS_EMAILS. */
  @Get('exportar')
  async exportar(
    @Query() query: ExportarEscuelasQueryDto,
    @UsuarioActual() usuario: Usuario,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!puedeExportarEscuelas(this.config, usuario.email)) {
      throw new ForbiddenException('No tenés permiso para exportar escuelas.');
    }
    const archivo = await this.escuelas.exportar(query.search);
    res.set({
      'Content-Type': TIPO_XLSX,
      'Content-Disposition': `attachment; filename="escuelas_${hoyParaArchivo()}.xlsx"`,
    });
    return new StreamableFile(archivo);
  }

  @Post()
  crear(@Body() dto: GuardarEscuelaDto) {
    return this.escuelas.crear(dto);
  }

  @Put(':id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GuardarEscuelaDto,
  ) {
    return this.escuelas.actualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.escuelas.eliminar(id);
  }
}
