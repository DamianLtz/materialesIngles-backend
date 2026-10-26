import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Roles } from '../auth/decoradores.js';
import {
  hoyParaArchivo,
  nombreParaArchivo,
  TIPO_XLSX,
} from '../common/excel.js';
import { Rol } from '../usuarios/entities/usuario.entity.js';
import { AsignacionMasivaService } from './asignacion-masiva.service.js';
import {
  GuardarMasivoDto,
  SyncMasivoDto,
} from './dto/asignacion-masiva.dto.js';

/** Tope que corta multer para no cargar archivos enormes en memoria; el límite real (5 MB) lo mide el lector. */
const TOPE_SUBIDA = 20 * 1024 * 1024;

/**
 * Asignación masiva de libros por Excel: super_admin y admin (decisión del 22/10/2026).
 * Las rutas `sync`, `parse` y `save` conservan su nombre del original.
 */
@Roles(Rol.Admin)
@Controller('back/mass-assignment')
export class AsignacionMasivaController {
  constructor(private readonly masiva: AsignacionMasivaService) {}

  @Get('etapa')
  async etapa() {
    return { etapa: await this.masiva.etapa() };
  }

  /** Lee y valida el .xlsx sin guardar nada. El archivo viaja en el campo `archivo`. */
  @Post('parse')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: TOPE_SUBIDA } }),
  )
  parse(@UploadedFile() archivo?: { buffer: Buffer }) {
    if (!archivo) throw new BadRequestException('Falta el archivo.');
    return this.masiva.parse(archivo.buffer);
  }

  @Post('save')
  @HttpCode(200)
  save(@Body() dto: GuardarMasivoDto) {
    return this.masiva.save(dto.filas);
  }

  @Post('sync')
  @HttpCode(200)
  sync(@Body() dto: SyncMasivoDto) {
    return this.masiva.sync(dto);
  }

  @Get('plantilla')
  async plantilla(@Res({ passthrough: true }) res: Response) {
    const archivo = await this.masiva.plantilla();
    res.set({
      'Content-Type': TIPO_XLSX,
      'Content-Disposition':
        'attachment; filename="plantilla-asignacion-masiva.xlsx"',
    });
    return new StreamableFile(archivo);
  }

  @Get('actuales')
  async actuales(@Res({ passthrough: true }) res: Response) {
    const { archivo, etapaNombre } = await this.masiva.actuales();
    res.set({
      'Content-Type': TIPO_XLSX,
      'Content-Disposition': `attachment; filename="asignaciones-${nombreParaArchivo(etapaNombre)}-${hoyParaArchivo()}.xlsx"`,
    });
    return new StreamableFile(archivo);
  }
}
