import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { AppConfig } from '../config/env';
import { RedisIoAdapter } from '../realtime/redis-io.adapter';
import { serveWeb } from './serve-web';

export const GLOBAL_PREFIX = 'api';
export const DOCS_PATH = `${GLOBAL_PREFIX}/docs`;

/** Everything shared by `main.ts` and the integration tests. */
export function setupApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.disable('x-powered-by');
  // Behind a reverse proxy (nginx / platform load balancer) in docker and production.
  app.set(
    'trust proxy',
    config.NODE_ENV === 'development' ? false : config.TRUST_PROXY_HOPS,
  );
  app.setGlobalPrefix(GLOBAL_PREFIX);

  // The API only serves JSON: lock everything down, except the Swagger UI assets.
  const strict = helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  const docs = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
      },
    },
  });
  const servesWeb = Boolean(config.WEB_DIST_DIR);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith(`/${DOCS_PATH}`)) return docs(req, res, next);
    // The web app's pages get their own policy in serveWeb().
    if (servesWeb && !req.path.startsWith(`/${GLOBAL_PREFIX}`)) return next();
    return strict(req, res, next);
  });
  if (config.WEB_DIST_DIR) serveWeb(app, config.WEB_DIST_DIR);

  app.use(cookieParser());
  const origins = new Set([
    new URL(config.APP_URL).origin,
    ...config.CORS_ORIGINS,
  ]);
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'X-XSRF-TOKEN',
      'Idempotency-Key',
      'X-Request-Id',
    ],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useWebSocketAdapter(new RedisIoAdapter(app, config));
  app.enableShutdownHooks();

  SwaggerModule.setup(DOCS_PATH, app, () => createOpenApiDocument(app), {
    jsonDocumentUrl: `${DOCS_PATH}-json`,
  });
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Casino API')
    .setDescription(
      'Virtual-credit casino. Amounts are integer minor units (100 = 1.00 credit). ' +
        'Authentication uses httpOnly cookies; unsafe requests need the X-XSRF-TOKEN header (double-submit).',
    )
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .addSecurityRequirements('access_token')
    .build();
  return SwaggerModule.createDocument(app, config);
}
