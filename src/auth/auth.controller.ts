import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { puedeExportarEscuelas } from '../escuelas/exportacion.js';
import type { Usuario } from '../usuarios/entities/usuario.entity.js';
import { AuthService, DURACION_SESION_SEGUNDOS } from './auth.service.js';
import { COOKIE_OAUTH, COOKIE_SESION, opcionesCookie } from './cookies.js';
import { Publico, UsuarioActual } from './decoradores.js';

const PATH_OAUTH = '/api/auth/google';
const DIEZ_MINUTOS_MS = 10 * 60 * 1000;

@Controller('auth')
export class AuthController {
  private readonly cookiesSeguras: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {
    this.cookiesSeguras = config.get('NODE_ENV') === 'production';
  }

  @Publico()
  @Get('google')
  async google(@Res() res: Response) {
    const { url, state, codeVerifier } = await this.auth.iniciarLogin();
    res.cookie(
      COOKIE_OAUTH,
      JSON.stringify({ state, codeVerifier }),
      opcionesCookie(this.cookiesSeguras, PATH_OAUTH, DIEZ_MINUTOS_MS),
    );
    res.redirect(url);
  }

  @Publico()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const guardado = this.leerCookieOauth(req);
    res.clearCookie(
      COOKIE_OAUTH,
      opcionesCookie(this.cookiesSeguras, PATH_OAUTH),
    );

    if (!code || !state || !guardado || guardado.state !== state) {
      return res.redirect('/?error=login');
    }

    let usuario: Usuario | null = null;
    try {
      usuario = await this.auth.completarLogin(code, guardado.codeVerifier);
    } catch {
      return res.redirect('/?error=login');
    }
    if (!usuario) return res.redirect('/?error=sin_acceso');

    res.cookie(
      COOKIE_SESION,
      await this.auth.firmarSesion(usuario),
      opcionesCookie(this.cookiesSeguras, '/', DURACION_SESION_SEGUNDOS * 1000),
    );
    return res.redirect('/back/dashboard');
  }

  /** Usuario logueado; el front lo usa para saber si hay sesión. */
  @Get('me')
  me(@UsuarioActual() usuario: Usuario) {
    const { id, nombre, email, avatarUrl, rol } = usuario;
    return {
      id,
      nombre,
      email,
      avatarUrl,
      rol,
      // Mientras no haya permisos por rol, la exportación se limita por email
      puedeExportarEscuelas: puedeExportarEscuelas(this.config, email),
    };
  }

  /** Público para que siempre borre la cookie, aunque la sesión ya no sea válida. */
  @Publico()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE_SESION] as string | undefined;
    if (token) await this.auth.cerrarSesiones(token);
    res.clearCookie(COOKIE_SESION, opcionesCookie(this.cookiesSeguras, '/'));
  }

  private leerCookieOauth(
    req: Request,
  ): { state: string; codeVerifier: string } | null {
    const valor = req.cookies?.[COOKIE_OAUTH] as string | undefined;
    if (!valor) return null;
    try {
      return JSON.parse(valor) as { state: string; codeVerifier: string };
    } catch {
      return null;
    }
  }
}
