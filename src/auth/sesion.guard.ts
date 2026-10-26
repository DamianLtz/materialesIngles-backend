import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import { COOKIE_SESION } from './cookies.js';
import { PUBLICO, type RequestConUsuario } from './decoradores.js';

/** Guard global: exige sesión válida salvo en endpoints @Publico(). */
@Injectable()
export class SesionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest<RequestConUsuario>();
    const token = req.cookies?.[COOKIE_SESION] as string | undefined;
    const usuario = token ? await this.auth.usuarioDeSesion(token) : null;
    if (!usuario) throw new UnauthorizedException();

    req.usuario = usuario;
    return true;
  }
}
