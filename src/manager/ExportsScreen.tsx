import { useState } from 'react'
import { downloadCsv } from '../lib/csv.ts'
import { EXPORTS } from './exports.ts'

type Status = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; fileName: string; rows: number } | { kind: 'error'; message: string }

/**
 * Exports: CSV files of orders, entries, designs, purchases and tasks, managers only
 * (brief: Operations).  Built in the browser from what the signed-in manager
 * can read, then downloaded.  A monthly export kept by a manager is part of the
 * backup arrangement.
 */
export default function ExportsScreen() {
  const [status, setStatus] = useState<Record<string, Status>>({})

  async function run(key: string) {
    const item = EXPORTS.find((e) => e.key === key)!
    setStatus((s) => ({ ...s, [key]: { kind: 'working' } }))
    try {
      const file = await item.run()
      downloadCsv(file.fileName, file.text)
      setStatus((s) => ({ ...s, [key]: { kind: 'done', fileName: file.fileName, rows: file.rowCount } }))
    } catch (e) {
      setStatus((s) => ({ ...s, [key]: { kind: 'error', message: (e as Error).message } }))
    }
  }

  return (
    <>
      <h1>Exports</h1>
      <p className="muted">
        Each button downloads a CSV file that opens in Excel, Numbers or Google Sheets. Keep a copy each month as part of the backups. These files hold
        pay-related figures, so store them where only managers can see them.
      </p>
      <ul className="list">
        {EXPORTS.map((e) => {
          const s = status[e.key] ?? { kind: 'idle' }
          return (
            <li key={e.key} className="export-row">
              <div className="row-main">
                <div className="row-title">{e.name}</div>
                <div className="row-sub">{e.what}</div>
                {s.kind === 'done' && (
                  <p className="save-status saved" role="status">
                    Downloaded {s.fileName} ({s.rows} {s.rows === 1 ? 'row' : 'rows'})
                  </p>
                )}
                {s.kind === 'error' && (
                  <p className="error" role="alert">
                    Could not build the file: {s.message}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => run(e.key)} disabled={s.kind === 'working'}>
                {s.kind === 'working' ? 'Building…' : `Download ${e.name} CSV`}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
