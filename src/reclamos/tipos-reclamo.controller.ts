import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ListadoQueryDto } from '../common/listado.js';
import { GuardarTipoReclamoDto } from './dto/guardar-tipo-reclamo.dto.js';
import { TiposReclamoService } from './tipos-reclamo.service.js';

@Controller('back/tipos-reclamo')
export class TiposReclamoController {
  constructor(private readonly tipos: TiposReclamoService) {}

  @Get()
  listar(@Query() query: ListadoQueryDto) {
    return this.tipos.listar(query);
  }

  @Post()
  crear(@Body() dto: GuardarTipoReclamoDto) {
    return this.tipos.crear(dto);
  }

  @Put(':id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GuardarTipoReclamoDto,
  ) {
    return this.tipos.actualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.tipos.eliminar(id);
  }
}
