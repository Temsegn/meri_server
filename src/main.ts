import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { env } from './config/env'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.setGlobalPrefix('api/v1')
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(cookieParser())
  app.useBodyParser('json', { limit: '100kb' })
  app.enableCors({ origin: env.CLIENT_URL, credentials: true })
  app.enableShutdownHooks()
  await app.listen(env.PORT)
  console.log(`MeriBoost API ready on http://localhost:${env.PORT}/api/v1`)
}

void bootstrap()
