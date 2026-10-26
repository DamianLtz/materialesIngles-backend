import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las escuelas pasan de distrito escolar a comuna. La comuna arranca vacía (se carga a
 * mano desde el backoffice) y el distrito se borra: el down no puede recuperar esos datos.
 */
export class ComunaEnEscuelas1793042257687 implements MigrationInterface {
  name = 'ComunaEnEscuelas1793042257687';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "escuelas" ADD "comuna" integer`);
    await queryRunner.query(`ALTER TABLE "escuelas" DROP COLUMN "distrito"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "escuelas" ADD "distrito" integer`);
    await queryRunner.query(`ALTER TABLE "escuelas" DROP COLUMN "comuna"`);
  }
}
