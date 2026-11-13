import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env'

/** Private object storage on Cloudflare R2 (S3 API). Objects are only reachable via short-lived signed URLs. */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name)
  private readonly client = createClient(env.S3_ENDPOINT)
  /** Signs download URLs against the browser-reachable host (differs from S3_ENDPOINT inside Docker). */
  private readonly signer = env.S3_PUBLIC_ENDPOINT ? createClient(env.S3_PUBLIC_ENDPOINT) : this.client

  async onModuleInit() {
    if (!env.S3_CREATE_BUCKET) return
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }))
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }))
      this.logger.log(`Created bucket ${env.S3_BUCKET}`)
    }
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
    )
  }

  /** Signed download URL, valid for `expiresIn` seconds. */
  signedUrl(key: string, filename: string, expiresIn = 300) {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `inline; filename="${filename.replace(/["\\\r\n]/g, '')}"`,
      }),
      { expiresIn },
    )
  }
}

function createClient(endpoint: string) {
  return new S3Client({
    region: env.S3_REGION,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  })
}
