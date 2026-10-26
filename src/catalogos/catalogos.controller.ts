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
} from '@nestjs/common';
import { CatalogosService } from './catalogos.service.js';
import { GuardarCatalogoDto } from './dto/guardar-catalogo.dto.js';

@Controller('back/catalogos')
export class CatalogosController {
  constructor(private readonly catalogos: CatalogosService) {}

  @Get()
  listar() {
    return this.catalogos.listar();
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.catalogos.obtener(id);
  }

  @Post()
  crear(@Body() dto: GuardarCatalogoDto) {
    return this.catalogos.crear(dto);
  }

  @Put(':id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GuardarCatalogoDto,
  ) {
    return this.catalogos.actualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.catalogos.eliminar(id);
  }
}
