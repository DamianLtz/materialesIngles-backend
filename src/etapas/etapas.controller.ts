import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decoradores.js';
import { ListadoQueryDto } from '../common/listado.js';
import { Rol } from '../usuarios/entities/usuario.entity.js';
import { GuardarEtapaDto } from './dto/etapa.dto.js';
import { EtapasService } from './etapas.service.js';

/** Gestión de etapas: super_admin y admin (super_admin pasa siempre; decisión del 22/10/2026). */
@Roles(Rol.Admin)
@Controller('back/etapas')
export class EtapasController {
  constructor(private readonly etapas: EtapasService) {}

  @Get()
  listar(@Query() query: ListadoQueryDto) {
    return this.etapas.listar(query);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.etapas.obtener(id);
  }

  @Get(':id/escuelas')
  escuelasDe(@Param('id', ParseIntPipe) id: number) {
    return this.etapas.escuelasDe(id);
  }

  @Post()
  crear(@Body() dto: GuardarEtapaDto) {
    return this.etapas.crear(dto);
  }

  @Put(':id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GuardarEtapaDto,
  ) {
    return this.etapas.actualizar(id, dto);
  }

  @Patch(':id/visible')
  cambiarVisible(@Param('id', ParseIntPipe) id: number) {
    return this.etapas.cambiarVisible(id);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.etapas.eliminar(id);
  }
}
