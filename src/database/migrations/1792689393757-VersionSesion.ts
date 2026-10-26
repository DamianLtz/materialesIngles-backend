import { MigrationInterface, QueryRunner } from 'typeorm';

export class VersionSesion1792689393757 implements MigrationInterface {
  name = 'VersionSesion1792689393757';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "usuarios" ADD "version_sesion" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "usuarios" DROP COLUMN "version_sesion"`,
    );
  }
}
