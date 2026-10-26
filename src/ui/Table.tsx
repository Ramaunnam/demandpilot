import { useMemo, useState, type ReactNode } from 'react'
import { ArrowUp, ArrowDown, Download, Search } from 'lucide-react'
import { downloadCSV } from '@/lib/csv'
import { Empty, Why } from './kit'

export interface Col<T> {
  key: string
  h: string
  cell: (r: T) => ReactNode
  val?: (r: T) => string | number
  right?: boolean
  w?: string
  term?: string
  hide?: boolean
}

export function Table<T>({
  rows, cols, rowKey, onRow, search, sort: initSort, page = 14, csv, max, toolbar,
}: {
  rows: T[]
  cols: Col<T>[]
  rowKey: (r: T) => string
  onRow?: (r: T) => void
  search?: (r: T) => string
  sort?: { key: string; dir: 'asc' | 'desc' }
  page?: number
  csv?: string
  max?: string
  toolbar?: ReactNode
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initSort ?? null)
  const [p, setP] = useState(0)
  const visible = cols.filter(c => !c.hide)

  const filtered = useMemo(() => {
    if (!q.trim() || !search) return rows
    const n = q.toLowerCase()
    return rows.filter(r => search(r).toLowerCase().includes(n))
  }, [rows, q, search])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const c = cols.find(x => x.key === sort.key)
    if (!c?.val) return filtered
    const out = [...filtered].sort((a, b) => {
      const av = c.val!(a), bv = c.val!(b)
      return typeof av === 'number' && typeof bv === 'number'
        ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true })
    })
    return sort.dir === 'desc' ? out.reverse() : out
  }, [filtered, sort, cols])

  const pages = Math.max(1, Math.ceil(sorted.length / page))
  const pg = Math.min(p, pages - 1)
  const slice = sorted.slice(pg * page, pg * page + page)

  return (
    <div>
      {(search || csv || toolbar) && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2 no-print">
          {search && (
            <div className="relative w-44">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input pl-6 h-7 text-sm" placeholder="Search" value={q}
                onChange={e => { setQ(e.target.value); setP(0) }} />
            </div>
          )}
          {toolbar}
          <div className="flex-1" />
          <span className="num text-2xs text-muted">{sorted.length}</span>
          {csv && (
            <button className="btn btn-ghost btn-xs" title="Export CSV"
              onClick={() => downloadCSV(csv, sorted.map(r =>
                Object.fromEntries(visible.filter(c => c.val).map(c => [c.h, c.val!(r)]))))}>
              <Download className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {slice.length === 0 ? <Empty title="Nothing here" hint="Try a different filter." /> : (
        <div className="overflow-auto rounded-lg border border-line" style={max ? { maxHeight: max } : undefined}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {visible.map(c => (
                  <th key={c.key} className={`th ${c.right ? 'text-right' : ''}`} style={c.w ? { width: c.w } : undefined}>
                    <button
                      className={`inline-flex items-center gap-0.5 ${c.val ? 'hover:text-fg' : 'cursor-default'}`}
                      onClick={() => c.val && setSort(s =>
                        s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' })}>
                      {c.h}
                      {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />)}
                    </button>
                    {c.term && <Why term={c.term} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.map(r => (
                <tr key={rowKey(r)} className={onRow ? 'tr cursor-pointer' : ''}
                  onClick={onRow ? () => onRow(r) : undefined}>
                  {visible.map(c => (
                    <td key={c.key} className={`td ${c.right ? 'text-right num' : ''}`}>{c.cell(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-1.5 mt-2 no-print">
          <span className="num text-2xs text-muted mr-1">{pg + 1}/{pages}</span>
          <button className="btn btn-outline btn-xs" disabled={pg === 0} onClick={() => setP(x => x - 1)}>Prev</button>
          <button className="btn btn-outline btn-xs" disabled={pg >= pages - 1} onClick={() => setP(x => x + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}
