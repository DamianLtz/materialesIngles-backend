import { Column, Entity, Index } from 'typeorm';
import { EntidadBase } from '../../database/entidad-base.js';

export enum Rol {
  SuperAdmin = 'super_admin',
  Admin = 'admin',
  Operador = 'operador',
}

/**
 * Usuarios del backoffice. Se dan de alta por email y el primer login con Google
 * completa google_id. Las escuelas no tienen usuario: entran por su cueanexo.
 */
@Entity('usuarios')
@Index('uq_usuarios_email', ['email'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('uq_usuarios_google_id', ['googleId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Usuario extends EntidadBase {
  @Column({ type: 'varchar' })
  nombre: string;

  @Column({ type: 'varchar' })
  email: string;

  @Column({ name: 'google_id', type: 'varchar', nullable: true })
  googleId: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 2048, nullable: true })
  avatarUrl: string | null;

  @Column({
    type: 'enum',
    enum: Rol,
    enumName: 'rol_usuario',
    default: Rol.Operador,
  })
  rol: Rol;

  /** Si es false el usuario no puede entrar al backoffice, aunque exista y tenga rol. */
  @Column({ type: 'boolean', default: true })
  activo: boolean;

  /**
   * Va dentro del token de sesión. Incrementarla invalida todas las sesiones
   * abiertas del usuario (lo hace el logout).
   */
  @Column({ name: 'version_sesion', type: 'int', default: 0 })
  versionSesion: number;
}
