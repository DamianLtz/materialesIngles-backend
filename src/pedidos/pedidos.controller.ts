import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
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
  BuscarLibrosQueryDto,
  ListadoPedidosQueryDto,
  SincronizarPedidosDto,
} from './dto/pedido.dto.js';
import { PedidosService } from './pedidos.service.js';

/** Pedidos de libros en el backoffice: super_admin y admin (decisión del 22/10/2026). */
@Roles(Rol.Admin)
@Controller('back')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Get('pedidos')
  listar(@Query() query: ListadoPedidosQueryDto) {
    return this.pedidos.listar(query);
  }

  @Get('pedidos/etapas')
  etapas() {
    return this.pedidos.etapasParaFiltro();
  }

  @Get('pedidos/exportar/:etapaId')
  async exportar(
    @Param('etapaId', ParseIntPipe) etapaId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { archivo, etapaNombre } = await this.pedidos.exportar(etapaId);
    res.set({
      'Content-Type': TIPO_XLSX,
      'Content-Disposition': `attachment; filename="pedidos-${nombreParaArchivo(etapaNombre)}-${hoyParaArchivo()}.xlsx"`,
    });
    return new StreamableFile(archivo);
  }

  @Delete('pedidos/:id')
  @HttpCode(204)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.pedidos.eliminar(id);
  }

  @Get('escuelas/:id/pedidos')
  deEscuela(@Param('id', ParseIntPipe) id: number) {
    return this.pedidos.deEscuela(id);
  }

  @Post('escuelas/:id/pedidos/sync')
  @HttpCode(200)
  sincronizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SincronizarPedidosDto,
  ) {
    return this.pedidos.sincronizar(id, dto.cambios);
  }

  @Get('ofertas/:id/libros')
  buscarLibros(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: BuscarLibrosQueryDto,
  ) {
    return this.pedidos.buscarLibros(id, query.search);
  }
}
