import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { setupApp } from './app/setup-app';
import { loadConfig } from './config/env';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config),
    { bufferLogs: true },
  );
  setupApp(app, config);
  await app.listen(config.PORT);
  app.get(Logger).log(`API listening on port ${config.PORT}`);
}

bootstrap().catch((err: unknown) => {
  // The logger may not exist yet (e.g. invalid configuration), so fall back to stderr.
  console.error(err);
  process.exit(1);
});
