import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Rol } from '../entities/usuario.entity.js';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Cuerpo de POST de usuarios. No hay contraseña: se entra con Google. */
export class CrearUsuarioDto {
  @Transform(recortar)
  // class-validator evalúa de abajo hacia arriba: el tipo se chequea primero
  @MaxLength(255, { message: 'El nombre no puede superar los 255 caracteres.' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @IsString({ message: 'El nombre es obligatorio.' })
  nombre: string;

  // Se guarda en minúsculas: el login busca por el email en minúsculas
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MaxLength(255, { message: 'El email no puede superar los 255 caracteres.' })
  @IsEmail({}, { message: 'Ingresá un email válido.' })
  @IsString({ message: 'El email es obligatorio.' })
  email: string;

  @IsEnum(Rol, { message: 'El rol no es válido.' })
  rol: Rol;
}

/** Cuerpo de PUT: lo mismo que el alta, más poder cortar o devolver el acceso. */
export class ActualizarUsuarioDto extends CrearUsuarioDto {
  @IsBoolean({ message: 'Indicá si el usuario está activo.' })
  activo: boolean;
}
