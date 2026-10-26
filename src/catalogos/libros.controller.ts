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
import { ActualizarLibroDto, CrearLibroDto } from './dto/libro.dto.js';
import { LibrosService } from './libros.service.js';

@Controller('back')
export class LibrosController {
  constructor(private readonly libros: LibrosService) {}

  @Get('catalogos/:catalogoId/libros')
  listar(
    @Param('catalogoId', ParseIntPipe) catalogoId: number,
    @Query() query: ListadoQueryDto,
  ) {
    return this.libros.listar(catalogoId, query);
  }

  @Post('libros')
  crear(@Body() dto: CrearLibroDto) {
    return this.libros.crear(dto);
  }

  @Put('libros/:id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarLibroDto,
  ) {
    return this.libros.actualizar(id, dto);
  }

  @Delete('libros/:id')
  @HttpCode(204)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.libros.eliminar(id);
  }
}
