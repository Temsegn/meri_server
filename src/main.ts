import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { json, raw } from 'express'
import { env } from './config/env'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.setGlobalPrefix('api/v1')
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(cookieParser())
  // Larger bodies only where needed: app data sync (photos are embedded), AI context, and raw file uploads.
  app.use('/api/v1/sync/push', json({ limit: '8mb' }))
  app.use('/api/v1/assistant', json({ limit: '1mb' }))
  app.use('/api/v1/sync/blobs', raw({ type: () => true, limit: '26mb' }))
  app.useBodyParser('json', { limit: '100kb' })
  app.enableCors({ origin: env.CLIENT_URL, credentials: true })
  app.enableShutdownHooks()
  await app.listen(env.PORT)
  console.log(`MeriBoost API ready on http://localhost:${env.PORT}/api/v1`)
}

void bootstrap()
