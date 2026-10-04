import { useState } from 'react'
import { deleteAdminReview, getAdminReviews } from '../lib/adminApi'
import { formatDate } from '../lib/orderStatus'
import { ConfirmButton, Pager, State } from './ui'
import { useLoad } from './useLoad'

export default function ReviewsAdminPage() {
  const [page, setPage] = useState(1)
  const { data, loading, failed, reload } = useLoad((s) => getAdminReviews(page, s), [page])
  const [error, setError] = useState(false)

  return (
    <>
      <h1 className="font-serif text-4xl">Reviews</h1>
      {error && (
        <p role="alert" className="mt-4 text-danger">
          Could not remove that review.
        </p>
      )}
      <div className="mt-4">
        <State
          loading={loading}
          failed={failed}
          empty={data?.items.length === 0}
          emptyText="No reviews yet."
        >
          {data && (
            <>
              <ul className="flex flex-col gap-3">
                {data.items.map((r) => (
                  <li key={r.review_id} className="rounded-xl border border-sand bg-white p-4">
                    <p className="flex flex-wrap justify-between gap-2">
                      <span>
                        <strong>{r.product_name_snapshot}</strong> —{' '}
                        <span role="img" aria-label={`${r.rating} out of 5 stars`}>
                          {'★'.repeat(r.rating)}
                          {'☆'.repeat(5 - r.rating)}
                        </span>
                      </span>
                      <span className="text-sm text-muted">
                        {r.customer_name ?? 'Former customer'} · {formatDate(r.created_at)}
                      </span>
                    </p>
                    {r.comment && <p className="mt-1 whitespace-pre-line">{r.comment}</p>}
                    <p className="mt-2">
                      <ConfirmButton
                        label="Remove review"
                        confirmLabel="Yes, remove it"
                        onConfirm={async () => {
                          setError(false)
                          try {
                            await deleteAdminReview(r.review_id)
                            reload()
                          } catch {
                            setError(true)
                          }
                        }}
                      />
                    </p>
                  </li>
                ))}
              </ul>
              <Pager page={page} total={data.total} pageSize={20} onPage={setPage} />
            </>
          )}
        </State>
      </div>
    </>
  )
}
