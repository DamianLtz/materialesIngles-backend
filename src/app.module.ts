import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AsignacionMasivaModule } from './asignacion-masiva/asignacion-masiva.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogosModule } from './catalogos/catalogos.module.js';
import { opcionesPostgres } from './database/opciones-postgres.js';
import { EscuelasModule } from './escuelas/escuelas.module.js';
import { EtapasModule } from './etapas/etapas.module.js';
import { GradosModule } from './grados/grados.module.js';
import { PedidosModule } from './pedidos/pedidos.module.js';
import { ReclamosModule } from './reclamos/reclamos.module.js';
import { TableroModule } from './tablero/tablero.module.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        opcionesPostgres((clave) => config.getOrThrow<string>(clave)),
    }),
    AsignacionMasivaModule,
    AuthModule,
    CatalogosModule,
    EscuelasModule,
    EtapasModule,
    GradosModule,
    PedidosModule,
    ReclamosModule,
    TableroModule,
    UsuariosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
