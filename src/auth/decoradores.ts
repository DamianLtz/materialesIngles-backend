import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Rol, Usuario } from '../usuarios/entities/usuario.entity.js';

export const PUBLICO = 'publico';
export const ROLES = 'roles';

export interface RequestConUsuario extends Request {
  usuario: Usuario;
}

/** El endpoint no requiere sesión (por defecto todos la requieren). */
export const Publico = () => SetMetadata(PUBLICO, true);

/**
 * Restringe el endpoint a estos roles. super_admin siempre pasa.
 * Sin @Roles, cualquier usuario activo con sesión tiene acceso.
 */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);

/** Usuario de la sesión actual (lo carga SesionGuard). */
export const UsuarioActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<RequestConUsuario>().usuario,
);
