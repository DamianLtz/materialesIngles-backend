import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Las rutas quedan /api/<path original>, ej: /api/back/mass-assignment/sync
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(
    // whitelist descarta campos de más; forbidNonWhitelisted los rechaza (evita mass assignment)
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Un solo mensaje por campo, no todas las reglas que incumple
      stopAtFirstError: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
