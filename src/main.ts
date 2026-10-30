import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { allowedOrigins, loadEnv, missingIntegrations } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env.NODE_ENV === 'test' ? ['error', 'warn'] : undefined,
  });
  const logger = new Logger('Bootstrap');
  if (env.NODE_ENV === 'production') {
    for (const key of missingIntegrations(env)) {
      logger.warn(`${key} vazio: integração desligada`);
    }
  }

  // Sem isso, atrás do proxy todo cliente teria o IP do proxy e o rate limit
  // viraria um balde único para a internet inteira.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  const swaggerOn = env.SWAGGER_ENABLED && env.NODE_ENV !== 'production';

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Inline só quando o Swagger UI está ativo (nunca em produção).
          scriptSrc: swaggerOn ? ["'self'", "'unsafe-inline'"] : ["'self'"],
          styleSrc: swaggerOn ? ["'self'", "'unsafe-inline'"] : ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.enableCors({
    origin: allowedOrigins(env),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.enableShutdownHooks();

  if (swaggerOn) {
    const config = new DocumentBuilder()
      .setTitle('belezaOur API')
      .setDescription('Backend do MVP — ver specs/001-backend-mvp/contracts/api.md')
      .setVersion('0.1.0')
      .addCookieAuth('belezaour.session_token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document));
  }

  await app.listen(env.PORT);
  logger.log(`API ouvindo na porta ${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
