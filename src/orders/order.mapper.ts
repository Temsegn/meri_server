import { Prisma } from '@prisma/client'
import { TRANSITIONS } from './order-rules'

export const orderInclude = {
  receipt: { select: { id: true, name: true } },
  listing: { select: { id: true, name: true, platform: true } },
  events: { orderBy: { createdAt: 'asc' }, select: { to: true, note: true, createdAt: true } },
  deliveries: { select: { deliveryEmailId: true } },
} satisfies Prisma.OrderInclude

export const adminOrderInclude = {
  ...orderInclude,
  user: { select: { id: true, name: true, email: true, status: true } },
} satisfies Prisma.OrderInclude

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>
type AdminOrderRow = Prisma.OrderGetPayload<{ include: typeof adminOrderInclude }>

export function toOrder(order: OrderRow) {
  return {
    id: order.id,
    ref: order.ref,
    type: order.type,
    status: order.status,
    target: order.target,
    quantity: order.quantity,
    watchHours: order.watchHours,
    amountEtb: order.amountEtb,
    paymentMethod: order.paymentMethod,
    rejectionReason: order.rejectionReason,
    details: order.details,
    deliveredCount: order.deliveries.length,
    receipt: order.receipt,
    listing: order.listing,
    events: order.events,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }
}

export function toAdminOrder(order: AdminOrderRow) {
  return {
    ...toOrder(order),
    user: order.user,
    deliveryEmailIds: order.deliveries.map((delivery) => delivery.deliveryEmailId),
    nextStatuses: TRANSITIONS[order.status],
  }
}
