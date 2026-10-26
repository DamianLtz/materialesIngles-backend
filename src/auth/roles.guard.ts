import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Rol } from '../usuarios/entities/usuario.entity.js';
import { ROLES, type RequestConUsuario } from './decoradores.js';

/** Guard global: aplica @Roles(...). Corre después de SesionGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles?.length) return true;

    const { usuario } = ctx.switchToHttp().getRequest<RequestConUsuario>();
    if (!usuario) return false;
    return usuario.rol === Rol.SuperAdmin || roles.includes(usuario.rol);
  }
}
