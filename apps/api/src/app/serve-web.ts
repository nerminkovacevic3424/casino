import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Serves the built Angular app from the API process, so the site and the API
 * share one origin. That keeps the SameSite=Strict cookies and the CSRF
 * origin check working on single-service hosts (e.g. Render's free tier).
 *
 * Must run after the /api helmet middleware is registered; /api and the
 * socket.io path never reach these handlers.
 */
export function serveWeb(app: NestExpressApplication, distDir: string): void {
  const root = resolve(distDir);
  const indexHtml = join(root, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`WEB_DIST_DIR has no index.html: ${root}`);
  }

  const isApi = (req: Request) =>
    req.path === '/api' || req.path.startsWith('/api/');

  const webHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Angular injects component styles as <style> elements.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        // Pixi decodes textures in a blob: worker.
        workerSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  const express = app.getHttpAdapter().getInstance();
  express.use((req: Request, res: Response, next: NextFunction) =>
    isApi(req) ? next() : webHelmet(req, res, next),
  );

  // Hashed bundles never change; index.html must always be revalidated.
  app.useStaticAssets(root, {
    index: false,
    setHeaders: (res, path) => {
      res.setHeader(
        'Cache-Control',
        /\.[0-9a-z]{8,}\.(js|css)$/i.test(path) || path.includes('media')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
      );
    },
  });

  // Client-side routes (/profile, /games/...) all load the SPA shell.
  express.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    if (isApi(req) || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
