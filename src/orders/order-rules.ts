import type { OrderStatus, OrderType, Platform } from '@prisma/client'

/** Allowed status moves. Backwards moves exist so an admin can undo one step. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['IN_PROGRESS', 'REJECTED', 'PENDING'],
  IN_PROGRESS: ['COMPLETED', 'ACCEPTED'],
  COMPLETED: ['IN_PROGRESS'],
  REJECTED: ['PENDING'],
}

export const canTransition = (from: OrderStatus, to: OrderStatus) => TRANSITIONS[from].includes(to)

/** Order types delivered by assigning emails (subscribe / follow). */
export const DELIVERY_PLATFORM: Partial<Record<OrderType, Platform>> = {
  YOUTUBE_SUBSCRIBERS: 'YOUTUBE',
  INSTAGRAM_FOLLOWERS: 'INSTAGRAM',
}

/** Statuses that count as paid/approved revenue. */
export const APPROVED: OrderStatus[] = ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED']

export const REF_PREFIX: Record<OrderType, string> = {
  YOUTUBE_SUBSCRIBERS: 'YT',
  INSTAGRAM_FOLLOWERS: 'IG',
  CHANNEL_PROMOTION: 'CH',
  ACCOUNT_PURCHASE: 'AB',
  ACCOUNT_SALE: 'AS',
}

export const TYPE_LABEL: Record<OrderType, string> = {
  YOUTUBE_SUBSCRIBERS: 'YouTube subscriber',
  INSTAGRAM_FOLLOWERS: 'Instagram follower',
  CHANNEL_PROMOTION: 'Channel promotion',
  ACCOUNT_PURCHASE: 'Account purchase',
  ACCOUNT_SALE: 'Account sale',
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'pending review',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in progress',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
}

export const PAYMENT_METHODS = ['Telebirr', 'CBE', 'Bank of Abyssinia'] as const
