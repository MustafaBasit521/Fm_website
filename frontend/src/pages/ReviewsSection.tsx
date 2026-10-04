import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import {
  ApiError,
  createReview,
  deleteReview,
  getMyReviewState,
  getReviews,
  updateReview,
  type MyReviewState,
  type ReviewList,
} from '../lib/api'
import { formatDate } from '../lib/orderStatus'
import { buttonClass, FormError } from './ui'

const Stars = ({ rating }: { rating: number }) => (
  <span aria-label={`${rating} out of 5 stars`} role="img">
    {'★'.repeat(rating)}
    {'☆'.repeat(5 - rating)}
  </span>
)

export function ReviewsSection({ productId }: { productId: string }) {
  const { session } = useAuth()
  const signedIn = session !== null
  const [page, setPage] = useState(1)
  const [version, setVersion] = useState(0) // bump to reload after a change
  const [list, setList] = useState<{ key: string; data: ReviewList | null } | null>(null)
  const [mine, setMine] = useState<{ key: string; data: MyReviewState | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const listKey = `${productId}:${page}:${version}`
  const mineKey = `${productId}:${signedIn}:${version}`

  useEffect(() => {
    const controller = new AbortController()
    getReviews(productId, page, controller.signal)
      .then((data) => setList({ key: listKey, data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError'))
          setList({ key: listKey, data: null })
      })
    return () => controller.abort()
  }, [productId, page, listKey])

  useEffect(() => {
    if (!signedIn) return
    const controller = new AbortController()
    getMyReviewState(productId, controller.signal)
      .then((data) => setMine({ key: mineKey, data }))
      .catch(() => setMine({ key: mineKey, data: null }))
    return () => controller.abort()
  }, [productId, signedIn, mineKey])

  const currentList = list?.key === listKey ? list.data : null
  const state = signedIn && mine?.key === mineKey ? mine.data : null

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const rating = Number(form.get('rating'))
    const comment = String(form.get('comment') ?? '').trim() || null
    if (!rating) return setError('Please choose a rating.')
    setBusy(true)
    setError(null)
    try {
      if (state?.review) await updateReview(productId, { rating, comment })
      else await createReview(productId, { rating, comment })
      setEditing(false)
      setVersion((v) => v + 1)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'NOT_ELIGIBLE'
          ? 'You can review a product after an order containing it has been delivered.'
          : err instanceof ApiError && err.code === 'ALREADY_REVIEWED'
            ? 'You have already reviewed this product.'
            : 'Could not save your review. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    setBusy(true)
    setError(null)
    try {
      await deleteReview(productId)
      setVersion((v) => v + 1)
    } catch {
      setError('Could not delete your review. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const showForm = state && (editing || (state.eligible && !state.review))
  const totalPages = currentList
    ? Math.max(1, Math.ceil(currentList.total / currentList.page_size))
    : 1

  return (
    <section aria-labelledby="reviews-heading" className="mt-10">
      <h2 id="reviews-heading" className="font-serif text-3xl">
        Reviews
      </h2>
      {currentList && currentList.rating_count > 0 && (
        <p className="mt-1">
          <Stars rating={Math.round(currentList.average_rating ?? 0)} />{' '}
          {currentList.average_rating} out of 5 · {currentList.rating_count}{' '}
          {currentList.rating_count === 1 ? 'review' : 'reviews'}
        </p>
      )}

      {!signedIn && (
        <p className="mt-2 text-muted">
          <Link to="/login" className="text-terracotta underline">
            Log in
          </Link>{' '}
          to review products you have bought.
        </p>
      )}
      {state && !state.eligible && !state.review && (
        <p className="mt-2 text-muted">
          You can review this product after your order is delivered.
        </p>
      )}

      {state?.review && !editing && (
        <div className="mt-4 rounded-xl border border-sand bg-cream-100 p-4">
          <p className="font-semibold">Your review</p>
          <p>
            <Stars rating={state.review.rating} />
          </p>
          {state.review.comment && <p>{state.review.comment}</p>}
          <div className="mt-2 flex gap-4">
            <button
              type="button"
              className="text-terracotta underline"
              onClick={() => setEditing(true)}
            >
              Edit review
            </button>
            <button
              type="button"
              className="text-danger underline"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              Delete review
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={onSubmit}
          aria-label="Write a review"
          className="mt-4 flex flex-col gap-3 rounded-xl border border-sand bg-white p-4"
        >
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="mb-1 font-medium text-bark">Your rating</legend>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="rating"
                  value={n}
                  defaultChecked={state.review?.rating === n}
                />
                {n}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="comment" className="text-sm font-medium text-bark">
              Comment (optional)
            </label>
            <textarea
              id="comment"
              name="comment"
              rows={3}
              maxLength={2000}
              defaultValue={state.review?.comment ?? ''}
              className="rounded-lg border border-sand px-3 py-2"
            />
          </div>
          <FormError message={error} />
          <div className="flex gap-3">
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Saving…' : state.review ? 'Save changes' : 'Post review'}
            </button>
            {editing && (
              <button type="button" className="underline" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {!showForm && <FormError message={error} />}

      {!currentList && !list && (
        <p role="status" className="mt-4">
          Loading reviews…
        </p>
      )}
      {list && list.key === listKey && !list.data && (
        <p role="alert" className="mt-4 text-danger">
          Could not load reviews.
        </p>
      )}
      {currentList && currentList.items.length === 0 && <p className="mt-4">No reviews yet.</p>}
      {currentList && currentList.items.length > 0 && (
        <>
          <ul className="mt-4 flex flex-col gap-4">
            {currentList.items.map((r) => (
              <li key={r.review_id} className="border-b border-sand pb-3">
                <p>
                  <Stars rating={r.rating} /> <span className="font-semibold">{r.author}</span>{' '}
                  <span className="text-sm text-muted">{formatDate(r.created_at)}</span>
                </p>
                {r.comment && <p className="mt-1 whitespace-pre-line">{r.comment}</p>}
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav aria-label="Review pages" className="mt-4 flex items-center gap-4">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  )
}
