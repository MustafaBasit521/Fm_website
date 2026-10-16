import { useState } from 'react'
import { getAuditLog } from '../lib/adminApi'
import { Pager, State } from './ui'
import { useLoad } from './useLoad'

export default function ActivityLogPage() {
  const [page, setPage] = useState(1)
  const { data, loading, failed } = useLoad((s) => getAuditLog(page, s), [page])
  return (
    <>
      <h1 className="font-serif text-4xl md:text-5xl">Activity log</h1>
      <p className="mt-1 text-muted">
        Every change made in the admin area, and every refused attempt, newest first. Entries cannot
        be edited or deleted here.
      </p>
      <div className="mt-4">
        <State
          loading={loading}
          failed={failed}
          empty={data?.items.length === 0}
          emptyText="No activity recorded yet."
        >
          {data && (
            <>
              <ul className="flex flex-col gap-2">
                {data.items.map((e) => (
                  <li key={e.audit_id} className="rounded-[18px] border border-sand bg-paper p-3">
                    <p className="flex flex-wrap justify-between gap-2">
                      <strong className="break-all">{e.action}</strong>
                      <span className={e.status_code >= 400 ? 'text-danger' : ''}>
                        {e.status_code >= 400
                          ? `Refused or failed (${e.status_code})`
                          : `OK (${e.status_code})`}
                      </span>
                    </p>
                    <p className="text-sm text-muted">
                      {new Date(e.created_at).toLocaleString('en-GB')} · user{' '}
                      {e.user_id.slice(0, 8)} · {e.ip ?? 'unknown address'}
                    </p>
                  </li>
                ))}
              </ul>
              <Pager page={page} total={data.total} pageSize={50} onPage={setPage} />
            </>
          )}
        </State>
      </div>
    </>
  )
}
