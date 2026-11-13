import { z } from 'zod'
import { PAYMENT_METHODS } from './order-rules'

const id = z.string().min(1).max(40)
const paymentMethod = z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Choose a payment method.' }) })
const target = z.string().trim().min(2, 'Enter your channel or account.').max(300)

export const createOrderSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('YOUTUBE_SUBSCRIBERS'), packageId: id, target, paymentMethod, receiptFileId: id }),
  z.object({ type: z.literal('INSTAGRAM_FOLLOWERS'), packageId: id, target, paymentMethod, receiptFileId: id }),
  z.object({ type: z.literal('ACCOUNT_PURCHASE'), listingId: id, paymentMethod, receiptFileId: id }),
  z.object({
    type: z.literal('ACCOUNT_SALE'),
    platform: z.enum(['YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'TELEGRAM']),
    name: z.string().trim().min(2, 'Enter the account name.').max(80),
    profileUrl: z.string().trim().url('Enter the full profile link.').max(300),
    audience: z.string().trim().min(1, 'Enter the audience size.').max(60),
    askingPriceEtb: z.coerce.number().int().min(100, 'Minimum ETB 100.').max(10_000_000),
    phone: z.string().trim().min(7, 'Enter a phone number.').max(30),
  }),
])
export type CreateOrderInput = z.infer<typeof createOrderSchema>

export const orderStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'])
export const orderTypeSchema = z.enum([
  'YOUTUBE_SUBSCRIBERS',
  'INSTAGRAM_FOLLOWERS',
  'CHANNEL_PROMOTION',
  'ACCOUNT_PURCHASE',
  'ACCOUNT_SALE',
])
