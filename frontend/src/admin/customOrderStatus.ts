import type { CustomOrderStatus } from '../lib/api'

export const CUSTOM_ORDER_LABELS: Record<CustomOrderStatus, string> = {
  NEW: 'New',
  IN_DISCUSSION: 'In discussion',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
}

/** What the admin may do next (the server enforces the same rules). Accepting is separate: it
 *  needs the agreed price, so it has its own form on the request's page. */
export const CUSTOM_ORDER_NEXT: Record<string, [CustomOrderStatus, string][]> = {
  NEW: [
    ['IN_DISCUSSION', 'Start discussion'],
    ['DECLINED', 'Decline'],
    ['CANCELLED', 'Cancel'],
  ],
  IN_DISCUSSION: [
    ['DECLINED', 'Decline'],
    ['CANCELLED', 'Cancel'],
  ],
  ACCEPTED: [
    ['IN_PROGRESS', 'Start making'],
    ['CANCELLED', 'Cancel'],
  ],
  IN_PROGRESS: [
    ['COMPLETED', 'Mark completed'],
    ['CANCELLED', 'Cancel'],
  ],
}

export const DISCUSSION_OPEN = ['NEW', 'IN_DISCUSSION', 'ACCEPTED', 'IN_PROGRESS']
