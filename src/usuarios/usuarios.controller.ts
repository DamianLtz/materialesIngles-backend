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
import { Roles, UsuarioActual } from '../auth/decoradores.js';
import { ListadoQueryDto } from '../common/listado.js';
import { ActualizarUsuarioDto, CrearUsuarioDto } from './dto/usuario.dto.js';
import { Rol, Usuario } from './entities/usuario.entity.js';
import { UsuariosService } from './usuarios.service.js';

/** Gestión de usuarios del backoffice: solo super_admin (decisión del 22/10/2026). */
@Roles(Rol.SuperAdmin)
@Controller('back/usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar(@Query() query: ListadoQueryDto, @UsuarioActual() actor: Usuario) {
    return this.usuarios.listar(query, actor.id);
  }

  @Post()
  crear(@Body() dto: CrearUsuarioDto) {
    return this.usuarios.crear(dto);
  }

  @Put(':id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarUsuarioDto,
    @UsuarioActual() actor: Usuario,
  ) {
    return this.usuarios.actualizar(id, actor.id, dto);
  }

  @Post(':id/cerrar-sesiones')
  @HttpCode(204)
  cerrarSesiones(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() actor: Usuario,
  ) {
    return this.usuarios.cerrarSesiones(id, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() actor: Usuario,
  ) {
    return this.usuarios.eliminar(id, actor.id);
  }
}
