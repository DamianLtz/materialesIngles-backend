import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Not, Raw, Repository } from 'typeorm';
import {
  escaparLike,
  paginar,
  type ListadoQueryDto,
  type Paginado,
} from '../common/listado.js';
import { esViolacionDeUnico } from '../common/nombres.js';
import type {
  ActualizarUsuarioDto,
  CrearUsuarioDto,
} from './dto/usuario.dto.js';
import { Rol, Usuario } from './entities/usuario.entity.js';

export interface UsuarioDto {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
  ) {}

  /** Como en el original, el usuario logueado no aparece en la lista (no se gestiona a sí mismo). */
  async listar(
    query: ListadoQueryDto,
    actorId: number,
  ): Promise<Paginado<UsuarioDto>> {
    const texto = query.search && `%${escaparLike(query.search)}%`;
    const [filas, total] = await this.usuarios.findAndCount({
      where: texto
        ? [
            { id: Not(actorId), nombre: ILike(texto) },
            { id: Not(actorId), email: ILike(texto) },
          ]
        : { id: Not(actorId) },
      order: { nombre: 'ASC', id: 'ASC' },
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    });
    return paginar(filas.map(aDto), total, query);
  }

  async crear({ nombre, email, rol }: CrearUsuarioDto): Promise<UsuarioDto> {
    await this.verificarEmailLibre(email);
    const usuario = this.usuarios.create({
      nombre,
      email,
      rol,
      activo: true,
    });
    return aDto(await this.guardar(usuario));
  }

  async actualizar(
    id: number,
    actorId: number,
    { nombre, email, rol, activo }: ActualizarUsuarioDto,
  ): Promise<UsuarioDto> {
    this.verificarNoEsUnoMismo(id, actorId);
    const usuario = await this.buscar(id);
    await this.verificarEmailLibre(email, id);

    if (email !== usuario.email.toLowerCase()) {
      // Otro email es otra persona: se desvincula la cuenta de Google y se cierran
      // sus sesiones; entra con el email nuevo y se vincula en su primer login.
      usuario.googleId = null;
      usuario.avatarUrl = null;
      usuario.versionSesion += 1;
    }
    Object.assign(usuario, { nombre, email, rol, activo });
    return aDto(await this.guardar(usuario));
  }

  /**
   * Borrado lógico. La fila queda (soft delete) pero el usuario ya no puede entrar:
   * la sesión busca al usuario en cada pedido y no encuentra a los borrados.
   */
  async eliminar(id: number, actorId: number): Promise<void> {
    this.verificarNoEsUnoMismo(id, actorId);
    await this.usuarios.softRemove(await this.buscar(id));
  }

  /** Invalida todas las sesiones abiertas del usuario sin tocar su acceso. */
  async cerrarSesiones(id: number, actorId: number): Promise<void> {
    this.verificarNoEsUnoMismo(id, actorId);
    await this.buscar(id);
    await this.usuarios.increment({ id }, 'versionSesion', 1);
  }

  /**
   * Quien gestiona usuarios es super_admin y no puede tocarse a sí mismo; así siempre
   * queda al menos un super_admin activo (el que está operando) y nadie se auto-bloquea.
   */
  private verificarNoEsUnoMismo(id: number, actorId: number) {
    if (id === actorId) {
      throw new ConflictException(
        'No podés modificar tu propio usuario desde acá.',
      );
    }
  }

  private async buscar(id: number): Promise<Usuario> {
    const usuario = await this.usuarios.findOneBy({ id });
    if (!usuario) throw new NotFoundException('El usuario no existe.');
    return usuario;
  }

  /** El índice único de Postgres distingue mayúsculas; el email se compara sin distinguirlas. */
  private async verificarEmailLibre(email: string, idActual?: number) {
    const existente = await this.usuarios.findOne({
      where: {
        email: Raw((columna) => `LOWER(${columna}) = LOWER(:email)`, { email }),
      },
    });
    if (existente && existente.id !== idActual) throw emailRepetido();
  }

  private async guardar(usuario: Usuario): Promise<Usuario> {
    try {
      return await this.usuarios.save(usuario);
    } catch (error) {
      if (esViolacionDeUnico(error)) throw emailRepetido();
      throw error;
    }
  }
}

function emailRepetido() {
  return new ConflictException('Ya existe un usuario con ese email.');
}

function aDto({
  id,
  nombre,
  email,
  rol,
  activo,
  createdAt,
  updatedAt,
}: Usuario): UsuarioDto {
  return { id, nombre, email, rol, activo, createdAt, updatedAt };
}
