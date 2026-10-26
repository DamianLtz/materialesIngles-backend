import type { CookieOptions } from 'express';

export const COOKIE_SESION = 'sesion';
/** Guarda state + code verifier entre la ida a Google y el callback. */
export const COOKIE_OAUTH = 'oauth_google';

export function opcionesCookie(
  seguras: boolean,
  path: string,
  maxAgeMs?: number,
): CookieOptions {
  return {
    httpOnly: true,
    // lax: se envía al volver de Google (navegación GET) pero no en POST cross-site
    sameSite: 'lax',
    secure: seguras,
    path,
    maxAge: maxAgeMs,
  };
}
