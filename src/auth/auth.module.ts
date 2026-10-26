import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { AuthController } from './auth.controller.js';
import { AuthService, DURACION_SESION_SEGUNDOS } from './auth.service.js';
import { RolesGuard } from './roles.guard.js';
import { SesionGuard } from './sesion.guard.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: DURACION_SESION_SEGUNDOS },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Los guards globales corren en este orden: primero sesión, después roles
    { provide: APP_GUARD, useClass: SesionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
