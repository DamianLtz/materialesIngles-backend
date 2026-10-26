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
import { GuardarGradoDto } from './dto/guardar-grado.dto.js';
import { GradosService } from './grados.service.js';

@Controller('back/grados')
export class GradosController {
  constructor(private readonly grados: GradosService) {}

  @Get()
  listar(@Query() query: ListadoQueryDto) {
    return this.grados.listar(query);
  }

  @Post()
  crear(@Body() dto: GuardarGradoDto) {
    return this.grados.crear(dto);
  }

  @Put(':id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GuardarGradoDto,
  ) {
    return this.grados.actualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.grados.eliminar(id);
  }
}
