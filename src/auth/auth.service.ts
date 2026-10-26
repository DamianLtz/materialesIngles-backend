import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { Repository } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity.js';

export const DURACION_SESION_SEGUNDOS = 8 * 60 * 60;

@Injectable()
export class AuthService {
  private readonly google: OAuth2Client;
  private readonly googleClientId: string;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
  ) {
    this.googleClientId = config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.google = new OAuth2Client({
      clientId: this.googleClientId,
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      redirectUri: config.getOrThrow<string>('GOOGLE_REDIRECT_URI'),
    });
  }

  /** URL de Google más el state y code verifier (PKCE) que hay que guardar hasta el callback. */
  async iniciarLogin() {
    const state = randomBytes(32).toString('base64url');
    const { codeVerifier, codeChallenge } =
      await this.google.generateCodeVerifierAsync();
    const url = this.google.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: 'select_account',
    });
    return { url, state, codeVerifier };
  }

  /**
   * Canjea el code de Google y devuelve el usuario si puede entrar al backoffice.
   * Solo entran usuarios dados de alta previamente (por email) y activos.
   */
  async completarLogin(
    code: string,
    codeVerifier: string,
  ): Promise<Usuario | null> {
    const { tokens } = await this.google.getToken({ code, codeVerifier });
    if (!tokens.id_token) return null;

    const ticket = await this.google.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.googleClientId,
    });
    const perfil = ticket.getPayload();
    if (!perfil?.email || !perfil.email_verified) return null;

    // Primero por google_id; el primer login de un usuario lo encuentra por email
    const usuario =
      (await this.usuarios.findOneBy({ googleId: perfil.sub })) ??
      (await this.usuarios.findOneBy({ email: perfil.email.toLowerCase() }));
    if (!usuario?.activo) return null;

    usuario.googleId = perfil.sub;
    usuario.nombre = perfil.name ?? usuario.nombre;
    usuario.avatarUrl = perfil.picture ?? null;
    return this.usuarios.save(usuario);
  }

  firmarSesion(usuario: Usuario): Promise<string> {
    return this.jwt.signAsync({ sub: usuario.id, ver: usuario.versionSesion });
  }

  /**
   * Usuario del token de sesión, o null si el token es inválido, el usuario ya no
   * puede entrar o la sesión fue cerrada (versión distinta a la de la base).
   */
  async usuarioDeSesion(token: string): Promise<Usuario | null> {
    let payload: { sub: number; ver?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      return null;
    }
    // findOneBy excluye los borrados (soft delete)
    const usuario = await this.usuarios.findOneBy({ id: payload.sub });
    if (!usuario?.activo || usuario.versionSesion !== payload.ver) return null;
    return usuario;
  }

  /** Invalida todas las sesiones abiertas del usuario del token (si sigue siendo válido). */
  async cerrarSesiones(token: string): Promise<void> {
    const usuario = await this.usuarioDeSesion(token);
    if (usuario) {
      await this.usuarios.increment({ id: usuario.id }, 'versionSesion', 1);
    }
  }
}
