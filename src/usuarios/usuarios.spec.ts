import 'reflect-metadata'; // en la app lo carga Nest; acá no hay nadie que lo haga
import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Repository } from 'typeorm';
import { ActualizarUsuarioDto, CrearUsuarioDto } from './dto/usuario.dto.js';
import { Rol, Usuario } from './entities/usuario.entity.js';
import { UsuariosService } from './usuarios.service.js';

const ACTOR = 1;

function armarServicio(opciones: {
  usuario?: Partial<Usuario> | null;
  otroConMismoEmail?: Partial<Usuario> | null;
}) {
  const usuarios = {
    findOneBy: vi.fn().mockResolvedValue(opciones.usuario ?? null),
    findOne: vi.fn().mockResolvedValue(opciones.otroConMismoEmail ?? null),
    findAndCount: vi.fn().mockResolvedValue([[], 0]),
    softRemove: vi.fn().mockResolvedValue(undefined),
    increment: vi.fn().mockResolvedValue(undefined),
    save: vi.fn((u: Partial<Usuario>) =>
      Promise.resolve({
        id: 7,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...u,
      }),
    ),
    create: vi.fn((datos: Partial<Usuario>) => datos),
  };
  const servicio = new UsuariosService(
    usuarios as unknown as Repository<Usuario>,
  );
  return { servicio, usuarios };
}

const existente = (): Partial<Usuario> => ({
  id: 5,
  nombre: 'Ana',
  email: 'ana@bue.edu.ar',
  rol: Rol.Operador,
  activo: true,
  googleId: 'g-123',
  avatarUrl: 'http://foto',
  versionSesion: 2,
});

const datos = {
  nombre: 'Ana',
  email: 'ana@bue.edu.ar',
  rol: Rol.Operador,
  activo: true,
};

describe('UsuariosService.crear', () => {
  it('crea el usuario activo, sin contraseña ni google_id', async () => {
    const { servicio, usuarios } = armarServicio({});
    await servicio.crear({
      nombre: 'Ana',
      email: 'ana@bue.edu.ar',
      rol: Rol.Admin,
    });
    expect(usuarios.create).toHaveBeenCalledWith({
      nombre: 'Ana',
      email: 'ana@bue.edu.ar',
      rol: Rol.Admin,
      activo: true,
    });
  });

  it('rechaza un email que ya usa otro usuario (sin distinguir mayúsculas)', async () => {
    const { servicio, usuarios } = armarServicio({
      otroConMismoEmail: { id: 9, email: 'ANA@bue.edu.ar' },
    });
    await expect(
      servicio.crear({
        nombre: 'Ana',
        email: 'ana@bue.edu.ar',
        rol: Rol.Admin,
      }),
    ).rejects.toThrow('Ya existe un usuario con ese email.');
    expect(usuarios.save).not.toHaveBeenCalled();
  });
});

describe('UsuariosService.actualizar', () => {
  it('conserva el email propio y los datos de Google si el email no cambia', async () => {
    const { servicio, usuarios } = armarServicio({
      usuario: existente(),
      otroConMismoEmail: { id: 5 },
    });
    await servicio.actualizar(5, ACTOR, { ...datos, rol: Rol.Admin });
    expect(usuarios.save).toHaveBeenCalledWith(
      expect.objectContaining({
        rol: Rol.Admin,
        googleId: 'g-123',
        versionSesion: 2,
      }),
    );
  });

  it('con otro email desvincula Google y cierra sus sesiones', async () => {
    const { servicio, usuarios } = armarServicio({ usuario: existente() });
    await servicio.actualizar(5, ACTOR, { ...datos, email: 'otra@bue.edu.ar' });
    expect(usuarios.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'otra@bue.edu.ar',
        googleId: null,
        avatarUrl: null,
        versionSesion: 3,
      }),
    );
  });

  it('permite desactivar a otro usuario', async () => {
    const { servicio, usuarios } = armarServicio({ usuario: existente() });
    await servicio.actualizar(5, ACTOR, { ...datos, activo: false });
    expect(usuarios.save).toHaveBeenCalledWith(
      expect.objectContaining({ activo: false }),
    );
  });

  it('no deja modificarse a uno mismo', async () => {
    const { servicio, usuarios } = armarServicio({ usuario: existente() });
    await expect(
      servicio.actualizar(ACTOR, ACTOR, { ...datos, activo: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(usuarios.save).not.toHaveBeenCalled();
  });

  it('404 si no existe', async () => {
    const { servicio } = armarServicio({ usuario: null });
    await expect(servicio.actualizar(9, ACTOR, datos)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('UsuariosService.eliminar y cerrarSesiones', () => {
  it('hace borrado lógico', async () => {
    const u = existente();
    const { servicio, usuarios } = armarServicio({ usuario: u });
    await servicio.eliminar(5, ACTOR);
    expect(usuarios.softRemove).toHaveBeenCalledWith(u);
  });

  it('no deja darse de baja a uno mismo', async () => {
    const { servicio, usuarios } = armarServicio({ usuario: existente() });
    await expect(servicio.eliminar(ACTOR, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(usuarios.softRemove).not.toHaveBeenCalled();
  });

  it('cerrar sesiones incrementa la versión de sesión', async () => {
    const { servicio, usuarios } = armarServicio({ usuario: existente() });
    await servicio.cerrarSesiones(5, ACTOR);
    expect(usuarios.increment).toHaveBeenCalledWith(
      { id: 5 },
      'versionSesion',
      1,
    );
  });

  it('cerrar sesiones de un usuario inexistente da 404', async () => {
    const { servicio } = armarServicio({ usuario: null });
    await expect(servicio.cerrarSesiones(9, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('UsuariosService.listar', () => {
  it('excluye al usuario logueado y busca por nombre o email', async () => {
    const { servicio, usuarios } = armarServicio({});
    await servicio.listar({ page: 1, perPage: 10, search: 'ana' }, ACTOR);
    const { where } = usuarios.findAndCount.mock.calls[0][0] as {
      where: unknown[];
    };
    expect(where).toHaveLength(2);
    expect(where[0]).toHaveProperty('nombre');
    expect(where[1]).toHaveProperty('email');
    expect(where[0]).toHaveProperty('id');
  });
});

/** Mensajes que devuelve el ValidationPipe global (stopAtFirstError: un mensaje por campo). */
async function mensajes<T extends object>(
  clase: new () => T,
  plano: Record<string, unknown>,
): Promise<string[]> {
  const errores = await validate(plainToInstance(clase, plano), {
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: true,
  });
  return errores.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CrearUsuarioDto / ActualizarUsuarioDto', () => {
  const valido = { nombre: 'Ana', email: 'Ana@Bue.edu.ar ', rol: 'operador' };

  it('acepta datos válidos y normaliza el email a minúsculas', async () => {
    expect(await mensajes(CrearUsuarioDto, valido)).toEqual([]);
    expect(plainToInstance(CrearUsuarioDto, valido).email).toBe(
      'ana@bue.edu.ar',
    );
  });

  it('da un mensaje claro por campo', async () => {
    expect(await mensajes(CrearUsuarioDto, {})).toEqual([
      'El nombre es obligatorio.',
      'El email es obligatorio.',
      'El rol no es válido.',
    ]);
    expect(
      await mensajes(CrearUsuarioDto, { ...valido, email: 'no-es-email' }),
    ).toEqual(['Ingresá un email válido.']);
    expect(await mensajes(CrearUsuarioDto, { ...valido, rol: 'dios' })).toEqual(
      ['El rol no es válido.'],
    );
  });

  it('rechaza campos de más (no hay mass assignment de activo/versionSesion al crear)', async () => {
    const msgs = await mensajes(CrearUsuarioDto, {
      ...valido,
      versionSesion: 9,
    });
    expect(msgs).toEqual(['property versionSesion should not exist']);
  });

  it('la edición exige activo booleano', async () => {
    expect(
      await mensajes(ActualizarUsuarioDto, { ...valido, activo: 'si' }),
    ).toEqual(['Indicá si el usuario está activo.']);
    expect(
      await mensajes(ActualizarUsuarioDto, { ...valido, activo: false }),
    ).toEqual([]);
  });
});
