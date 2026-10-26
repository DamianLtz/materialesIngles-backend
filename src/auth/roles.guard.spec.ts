import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Rol, type Usuario } from '../usuarios/entities/usuario.entity.js';
import { RolesGuard } from './roles.guard.js';

function contexto(usuario: Partial<Usuario> | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ usuario }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function conRoles(roles: Rol[] | undefined) {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
  }

  it('sin @Roles deja pasar a cualquier usuario', () => {
    conRoles(undefined);
    expect(guard.canActivate(contexto({ rol: Rol.Operador }))).toBe(true);
  });

  it('con @Roles deja pasar solo a los roles indicados', () => {
    conRoles([Rol.Admin]);
    expect(guard.canActivate(contexto({ rol: Rol.Admin }))).toBe(true);
    expect(guard.canActivate(contexto({ rol: Rol.Operador }))).toBe(false);
  });

  it('super_admin pasa aunque no esté en @Roles', () => {
    conRoles([Rol.Operador]);
    expect(guard.canActivate(contexto({ rol: Rol.SuperAdmin }))).toBe(true);
  });

  it('con @Roles y sin usuario (endpoint público) no deja pasar', () => {
    conRoles([Rol.Admin]);
    expect(guard.canActivate(contexto(undefined))).toBe(false);
  });
});
