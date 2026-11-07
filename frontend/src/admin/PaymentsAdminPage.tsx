import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getAdminPayments,
  getPaymentReceipt,
  rejectPayment,
  verifyPayment,
  type AdminPaymentAttempt,
} from '../lib/adminApi'
import { ApiError, type RejectionReason } from '../lib/api'
import { formatPrice } from '../lib/money'
import { formatDate } from '../lib/orderStatus'
import { methodName, REJECTION_LABELS } from '../lib/paymentText'
import { ConfirmDialog } from '../pages/ConfirmDialog'
import { buttonClass, FormError, secondaryButtonClass } from '../pages/ui'
import { useToast } from '../toast/context'
import { inputClass } from './styles'
import { Badge, PageTitle, Pager, State, cardClass } from './ui'
import { useLoad } from './useLoad'

const FILTERS: [string, string][] = [
  ['SUBMITTED', 'Waiting for a check'],
  ['PAID', 'Verified'],
  ['REJECTED', 'Rejected'],
  ['', 'All'],
]
const STATUS_TEXT: Record<string, string> = {
  SUBMITTED: 'Waiting for a check',
  PAID: 'Verified',
  REJECTED: 'Rejected',
}
const ORDER_NUMBER = (a: AdminPaymentAttempt) => a.order_id.slice(0, 8).toUpperCase()
const when = (iso: string) =>
  `${formatDate(iso)} ${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`

const MESSAGES: Record<string, string> = {
  ALREADY_REVIEWED: 'This payment was already verified or rejected. The list has been refreshed.',
  ORDER_NOT_OPEN:
    'The order is no longer waiting for this payment (it may have been cancelled), so it cannot be verified.',
  AMOUNT_CHANGED:
    'The order total changed after this payment was sent. Reject it and ask the customer to pay again.',
}

export default function PaymentsAdminPage() {
  const toast = useToast()
  const [status, setStatus] = useState('SUBMITTED')
  const [page, setPage] = useState(1)
  const { data, loading, failed, reload } = useLoad(
    (s) => getAdminPayments({ status, page }, s),
    [status, page],
  )
  const [dialog, setDialog] = useState<{
    mode: 'verify' | 'reject'
    item: AdminPaymentAttempt
  } | null>(null)
  const [reason, setReason] = useState<RejectionReason>('NOT_RECEIVED')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipts, setReceipts] = useState<Record<string, string | null | 'loading'>>({})

  function close() {
    setDialog(null)
    setError(null)
  }

  async function showReceipt(a: AdminPaymentAttempt) {
    setReceipts((r) => ({ ...r, [a.attempt_id]: 'loading' }))
    try {
      const { url } = await getPaymentReceipt(a.attempt_id)
      setReceipts((r) => ({ ...r, [a.attempt_id]: url }))
    } catch {
      setReceipts((r) => ({ ...r, [a.attempt_id]: null }))
    }
  }

  async function decide() {
    if (!dialog) return
    const { mode, item } = dialog
    if (mode === 'reject' && reason === 'OTHER' && !note.trim())
      return setError('Please write the reason.')
    setBusy(true)
    setError(null)
    try {
      if (mode === 'verify') await verifyPayment(item.attempt_id)
      else await rejectPayment(item.attempt_id, reason, note.trim() || null)
      toast.show(mode === 'verify' ? 'Payment verified, order confirmed' : 'Payment rejected')
      close()
      reload()
    } catch (err) {
      setError(
        (err instanceof ApiError && err.code && MESSAGES[err.code]) ||
          'Could not save this decision. Please try again.',
      )
      if (err instanceof ApiError && err.code === 'ALREADY_REVIEWED') reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageTitle
        eyebrow={data ? `${data.total} ${data.total === 1 ? 'payment' : 'payments'}` : undefined}
        title="Payments"
      />
      <p className="mt-2 max-w-2xl text-bark">
        Easypaisa and JazzCash payments sent by customers. Always check your own merchant account
        for the money before you verify: a screenshot alone proves nothing.
      </p>
      <div className="mt-5 flex max-w-xs flex-col gap-1">
        <label htmlFor="p-status" className="text-sm font-medium text-bark">
          Show
        </label>
        <select
          id="p-status"
          className={inputClass}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
        >
          {FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        <State
          loading={loading}
          failed={failed}
          empty={data?.items.length === 0}
          emptyText="No payments here."
        >
          {data && (
            <>
              <ul className="flex flex-col gap-4">
                {data.items.map((a) => {
                  const receipt = receipts[a.attempt_id]
                  return (
                    <li
                      key={a.attempt_id}
                      className={`${cardClass} flex flex-col gap-3 p-4 md:p-5`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <Link
                            to={`/orders/${a.order_id}`}
                            className="font-serif text-2xl underline"
                          >
                            Order {ORDER_NUMBER(a)}
                          </Link>
                          <p className="text-sm text-muted">
                            {methodName(a.method)} · sent {when(a.created_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-lg">{formatPrice(a.amount_paisa)}</strong>
                          <Badge>{STATUS_TEXT[a.status] ?? a.status}</Badge>
                        </div>
                      </div>
                      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-bark">Customer</dt>
                          <dd>
                            {a.customer_name} · {a.customer_email}
                            {a.customer_phone ? ` · ${a.customer_phone}` : ''}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-bark">Transaction number</dt>
                          <dd className="break-all font-semibold">{a.transaction_reference}</dd>
                        </div>
                        {a.status === 'REJECTED' && (
                          <div className="sm:col-span-2">
                            <dt className="text-bark">
                              Rejected{a.reviewed_at ? ` on ${when(a.reviewed_at)}` : ''}
                            </dt>
                            <dd>
                              {a.rejection_reason ? REJECTION_LABELS[a.rejection_reason] : ''}
                              {a.rejection_note ? `: ${a.rejection_note}` : ''}
                            </dd>
                          </div>
                        )}
                        {a.status === 'PAID' && a.reviewed_at && (
                          <div>
                            <dt className="text-bark">Verified</dt>
                            <dd>{when(a.reviewed_at)}</dd>
                          </div>
                        )}
                      </dl>

                      {receipt && receipt !== 'loading' && (
                        <figure>
                          <a href={receipt} target="_blank" rel="noopener noreferrer">
                            <img
                              src={receipt}
                              alt={`Receipt screenshot for order ${ORDER_NUMBER(a)}`}
                              className="max-h-96 w-full rounded-[10px] bg-cream-200 object-contain"
                            />
                          </a>
                          <figcaption className="mt-1 text-sm text-muted">
                            Receipt screenshot (the link expires after an hour)
                          </figcaption>
                        </figure>
                      )}
                      {receipt === null && (
                        <p role="status" className="text-sm text-bark">
                          The receipt could not be loaded.
                        </p>
                      )}

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          disabled={receipt === 'loading'}
                          onClick={() => void showReceipt(a)}
                        >
                          {receipt === 'loading' ? 'Loading…' : 'View receipt'}
                        </button>
                        {a.status === 'SUBMITTED' && (
                          <>
                            <button
                              type="button"
                              className={buttonClass}
                              onClick={() => setDialog({ mode: 'verify', item: a })}
                            >
                              Verify payment
                            </button>
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              onClick={() => {
                                setReason('NOT_RECEIVED')
                                setNote('')
                                setDialog({ mode: 'reject', item: a })
                              }}
                            >
                              Reject payment
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <Pager page={page} total={data.total} pageSize={20} onPage={setPage} />
            </>
          )}
        </State>
      </div>

      <ConfirmDialog
        open={dialog?.mode === 'verify'}
        title="Is the money in your account?"
        confirmLabel="Yes, verify the payment"
        cancelLabel="Not yet"
        busy={busy}
        onCancel={close}
        onConfirm={() => void decide()}
      >
        {dialog && (
          <>
            <p>
              Open your {methodName(dialog.item.method)} merchant account and look for{' '}
              <strong>{formatPrice(dialog.item.amount_paisa)}</strong> with transaction number{' '}
              <strong className="break-all">{dialog.item.transaction_reference}</strong>. Only
              verify if you can see it there.
            </p>
            <p className="mt-2">
              The payment is marked Paid, the order is confirmed and the customer is told.
            </p>
            <FormError message={error} />
          </>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog?.mode === 'reject'}
        title="Reject this payment?"
        confirmLabel="Reject payment"
        cancelLabel="Back"
        danger
        busy={busy}
        onCancel={close}
        onConfirm={() => void decide()}
      >
        <p>
          The customer is told why and gets another 30 minutes to send corrected details. The order
          stays out of preparation.
        </p>
        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor="reject-reason" className="text-sm font-medium text-bark">
            Reason
          </label>
          <select
            id="reject-reason"
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value as RejectionReason)}
          >
            {(Object.keys(REJECTION_LABELS) as RejectionReason[]).map((r) => (
              <option key={r} value={r}>
                {REJECTION_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor="reject-note" className="text-sm font-medium text-bark">
            {reason === 'OTHER' ? 'Write the reason' : 'Note for the customer (optional)'}
          </label>
          <textarea
            id="reject-note"
            rows={2}
            maxLength={300}
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <FormError message={error} />
      </ConfirmDialog>
    </>
  )
}
