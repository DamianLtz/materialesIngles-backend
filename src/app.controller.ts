import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Publico } from './auth/decoradores.js';

@Publico()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
