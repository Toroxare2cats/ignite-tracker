import { useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { datesBetween, formatDate, formatMinutes, formatStamp, periodText } from '../lib/dates.ts'
import { useAsync } from '../lib/useAsync.ts'
import { useUnsavedWarning } from '../lib/useFormState.ts'
import { ErrorNote, Loading } from '../components/ui.tsx'
import { loadAccounts, type Account } from './queries.ts'
import { nameKey, parseUattendReport, personClocked, personTotal, UattendFormatError, type UattendPerson, type UattendReport } from './uattend.ts'
import {
  importUattend,
  loadImports,
  loadUattendNames,
  setUattendMatch,
  type Match,
  type UattendImport,
  type UattendName,
} from './uattendQueries.ts'

interface Data {
  accounts: Account[]
  names: UattendName[]
  imports: UattendImport[]
}

const MAX_FILE_BYTES = 2 * 1024 * 1024

/**
 * Imports: upload uAttend's Timecard Report, check the preview, match names,
 * save.  Below, the import history and the remembered name matches.
 */
export default function ImportsScreen() {
  const { state, reload } = useAsync<Data>(async () => {
    const [accounts, names, imports] = await Promise.all([loadAccounts(), loadUattendNames(), loadImports()])
    return { accounts, names, imports }
  }, [])
  const [saved, setSaved] = useState<UattendImport | null>(null)

  return (
    <>
      <h1>Imports</h1>
      <p className="muted">
        Each week, export the Timecard Report from uAttend as CSV (the version with a block for each person and a line for each day) and upload it
        here. The tracker keeps the hours each person clocked on each day, so they sit beside the hours logged to orders. Pay figures in the file are
        never read.
      </p>
      {state.kind === 'loading' && <Loading what="imports" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          {saved && (
            <div className="notice" role="status">
              Saved uAttend hours for {saved.people_count} {saved.people_count === 1 ? 'person' : 'people'}, {periodText(saved.period_from, saved.period_to)}.{' '}
              <Link to={`/manage/reports/reconciliation?week=${saved.period_from}`}>See the reconciliation for this period</Link>
            </div>
          )}
          <UploadCard
            data={state.data}
            onSaved={(imp) => {
              setSaved(imp)
              reload()
            }}
            onPick={() => setSaved(null)}
          />
          <HistoryCard data={state.data} />
          <MatchesCard data={state.data} onChanged={reload} />
        </>
      )}
    </>
  )
}

// --- Upload and preview -----------------------------------------------------

/** Who a name probably is, for a spelling never seen before.  The manager confirms it. */
function suggest(person: UattendPerson, accounts: Account[]): string | null {
  const key = nameKey(person.name)
  const first = key.split(' ')[0]
  const candidates = [
    accounts.filter((a) => nameKey(a.full_name) === key),
    accounts.filter((a) => nameKey(a.full_name) === first),
    accounts.filter((a) => a.email.split('@')[0].toLowerCase() === first),
  ]
  for (const found of candidates) if (found.length === 1) return found[0].id
  return null
}

type Choice = { value: Match | undefined; origin: 'remembered' | 'suggested' | 'new' }

function initialChoices(report: UattendReport, data: Data): Map<string, Choice> {
  const remembered = new Map(data.names.map((n) => [n.name_key, n]))
  const out = new Map<string, Choice>()
  for (const p of report.people) {
    const known = remembered.get(nameKey(p.name))
    if (known) out.set(p.name, { value: known.profile_id, origin: 'remembered' })
    else {
      const guess = suggest(p, data.accounts)
      out.set(p.name, guess ? { value: guess, origin: 'suggested' } : { value: undefined, origin: 'new' })
    }
  }
  return out
}

const SKIP = 'skip'

function PersonSelect({
  id,
  value,
  accounts,
  onChange,
  allowUndecided,
  label,
}: {
  id: string
  value: Match | undefined
  accounts: Account[]
  onChange: (value: Match) => void
  allowUndecided: boolean
  label: string
}) {
  const active = accounts.filter((a) => a.active)
  const inactive = accounts.filter((a) => !a.active)
  return (
    <select
      id={id}
      aria-label={label}
      value={value === undefined ? '' : value === null ? SKIP : value}
      onChange={(e) => onChange(e.target.value === SKIP ? null : e.target.value)}
    >
      {(allowUndecided || value === undefined) && (
        <option value="" disabled>
          Choose who this is…
        </option>
      )}
      <option value={SKIP}>Not in the tracker (skip)</option>
      {active.map((a) => (
        <option key={a.id} value={a.id}>
          {a.full_name}
          {a.role === 'manager' ? ' (manager)' : ''}
        </option>
      ))}
      {inactive.length > 0 && (
        <optgroup label="Switched off">
          {inactive.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

function DayCell({ person, date }: { person: UattendPerson; date: string }) {
  const day = person.days.find((d) => d.date === date)
  if (!day) return <span className="muted">—</span>
  return (
    <>
      {day.missingPunch ? (
        <span className="missing">
          Missing punch
          {day.minutes !== null && day.minutes > 0 ? ` (${formatMinutes(day.minutes)} given)` : ''}
        </span>
      ) : (
        <span>{day.minutes ? formatMinutes(day.minutes) : '—'}</span>
      )}
      {day.leaveMinutes > 0 && <span className="small muted"> + {formatMinutes(day.leaveMinutes)} leave, not counted</span>}
    </>
  )
}

function UploadCard({ data, onSaved, onPick }: { data: Data; onSaved: (imp: UattendImport) => void; onPick: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [report, setReport] = useState<UattendReport | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [inputKey, setInputKey] = useState(0)

  useUnsavedWarning(report !== null)
  const accountName = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.full_name])), [data.accounts])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    onPick()
    setReport(null)
    setProblem(null)
    setSaveError(null)
    if (!file) return
    setFileName(file.name)
    if (file.size > MAX_FILE_BYTES) {
      setProblem('That file is larger than 2 MB, which is far bigger than a weekly Timecard Report. Check it is the right file.')
      return
    }
    try {
      const parsed = parseUattendReport(await file.text())
      setReport(parsed)
      setChoices(initialChoices(parsed, data))
    } catch (e) {
      setProblem(e instanceof UattendFormatError ? e.message : `The file could not be read: ${(e as Error).message}`)
    }
  }

  function clear() {
    setReport(null)
    setFileName(null)
    setProblem(null)
    setSaveError(null)
    setInputKey((k) => k + 1)
  }

  const dates = report ? datesBetween(report.periodFrom, report.periodTo) : []
  const undecided = report ? report.people.filter((p) => choices.get(p.name)?.value === undefined) : []
  const matched = report ? report.people.filter((p) => typeof choices.get(p.name)?.value === 'string') : []
  const doubled = (() => {
    const seen = new Map<string, string>()
    for (const p of matched) {
      const id = choices.get(p.name)!.value as string
      if (seen.has(id)) return `${seen.get(id)} and ${p.name} are both matched to ${accountName.get(id)}. Match each person once.`
      seen.set(id, p.name)
    }
    return null
  })()
  const overlapping = report
    ? data.imports.filter((i) => i.days_in_use > 0 && i.period_from <= report.periodTo && i.period_to >= report.periodFrom)
    : []
  const canSave = report !== null && undecided.length === 0 && doubled === null && !saving

  async function save() {
    if (!report || !fileName || !canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      const matches = new Map<string, Match>(report.people.map((p) => [p.name, choices.get(p.name)?.value ?? null]))
      const imp = await importUattend(fileName, report, matches)
      clear()
      onSaved(imp)
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card" aria-labelledby="upload-heading">
      <h2 id="upload-heading" style={{ marginTop: 0 }}>
        Upload a uAttend export
      </h2>
      <label htmlFor="uattend-file">Timecard Report (CSV file)</label>
      <input key={inputKey} id="uattend-file" type="file" accept=".csv,text/csv" onChange={handleFile} />
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}

      {report && (
        <div className="preview" data-testid="uattend-preview">
          <h3>Preview: nothing is saved yet</h3>
          <p>
            <strong>{fileName}</strong> · pay period {periodText(report.periodFrom, report.periodTo)} · {report.people.length} people in the file
          </p>
          {overlapping.length > 0 && (
            <p className="notice warn">
              This period was already uploaded ({overlapping.map((i) => `${formatStamp(i.uploaded_at)}`).join(', ')}). Saving replaces those days
              for the people matched below; it does not add a second copy, and nobody else changes.
            </p>
          )}
          <p className="form-note">
            Hours are what each person clocked on each day (regular plus overtime). Choose who each uAttend name is in the tracker; the tracker
            remembers each choice for next week. Names with no tracker account are skipped.
          </p>
          <div className="table-scroll">
            <table className="table preview-table">
              <thead>
                <tr>
                  <th>uAttend name</th>
                  <th>Tracker person</th>
                  {dates.map((d) => (
                    <th key={d}>{formatDate(d)}</th>
                  ))}
                  <th>Clocked</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {report.people.map((p, i) => {
                  const choice = choices.get(p.name)!
                  const skipped = choice.value === null
                  const totalOk = p.reportedTotal === null || p.reportedTotal === personTotal(p)
                  return (
                    <tr key={p.name} className={skipped ? 'skipped' : undefined}>
                      <td data-label="uAttend name">
                        <strong>{p.name}</strong>
                        {choice.origin === 'suggested' && <span className="tag">Suggested match</span>}
                        {choice.origin === 'new' && <span className="tag warn">New name</span>}
                      </td>
                      <td data-label="Tracker person">
                        <PersonSelect
                          id={`match-${i}`}
                          label={`Tracker person for ${p.name}`}
                          value={choice.value}
                          accounts={data.accounts}
                          allowUndecided={false}
                          onChange={(value) => setChoices((current) => new Map(current).set(p.name, { ...choice, value }))}
                        />
                      </td>
                      {dates.map((d) => (
                        <td key={d} data-label={formatDate(d)}>
                          <DayCell person={p} date={d} />
                        </td>
                      ))}
                      <td data-label="Clocked">
                        <strong>{formatMinutes(personClocked(p))}</strong>
                      </td>
                      <td data-label="Check">
                        {p.reportedTotal === null ? (
                          <span className="muted">No total in file</span>
                        ) : totalOk ? (
                          <span className="ok">Matches uAttend's total</span>
                        ) : (
                          <span className="missing">uAttend says {formatMinutes(p.reportedTotal)}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="savebar">
            <p className={`save-status ${saveError ? 'error' : 'dirty'}`} role="status" aria-live="polite">
              {saveError
                ? `Not saved. ${saveError}`
                : doubled
                  ? doubled
                  : undecided.length > 0
                    ? `Choose who ${undecided.length === 1 ? 'one new name is' : `${undecided.length} new names are`} before saving.`
                    : saving
                      ? 'Saving…'
                      : `Not saved yet: ${matched.length} ${matched.length === 1 ? 'person' : 'people'} to save, ${report.people.length - matched.length} skipped.`}
            </p>
            <div className="savebar-actions">
              <button type="button" className="secondary" onClick={clear} disabled={saving}>
                Cancel
              </button>
              <button type="button" onClick={save} disabled={!canSave}>
                {saving ? 'Saving…' : `Save hours for ${matched.length} ${matched.length === 1 ? 'person' : 'people'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// --- History ----------------------------------------------------------------

function HistoryCard({ data }: { data: Data }) {
  const who = new Map(data.accounts.map((a) => [a.id, a.full_name]))
  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading">Import history</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Uploaded</th>
            <th>Pay period</th>
            <th>File</th>
            <th>Saved</th>
            <th>Skipped names</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.imports.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                Nothing uploaded yet.
              </td>
            </tr>
          )}
          {data.imports.map((i) => (
            <tr key={i.id}>
              <td data-label="Uploaded">
                {formatStamp(i.uploaded_at)}
                <div className="small muted">{(i.uploaded_by && who.get(i.uploaded_by)) || 'Unknown'}</div>
              </td>
              <td data-label="Pay period">
                <Link to={`/manage/reports/reconciliation?week=${i.period_from}`}>{periodText(i.period_from, i.period_to)}</Link>
              </td>
              <td data-label="File" className="break">
                {i.file_name ?? <span className="muted">No name</span>}
              </td>
              <td data-label="Saved">
                {i.people_count ?? 0} people, {i.row_count ?? 0} days
                {i.missing_punch_days > 0 && (
                  <div className="small missing">
                    {i.missing_punch_days} {i.missing_punch_days === 1 ? 'day' : 'days'} with a missing punch
                  </div>
                )}
              </td>
              <td data-label="Skipped names">{i.skipped_names.length > 0 ? i.skipped_names.join(', ') : <span className="muted">None</span>}</td>
              <td data-label="Status">
                {i.days_in_use > 0 ? (
                  i.days_in_use < (i.row_count ?? 0) ? (
                    <span>Partly replaced by a later upload</span>
                  ) : (
                    <span className="ok">In use</span>
                  )
                ) : (
                  <span className="muted">Replaced by a later upload</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// --- Remembered matches -----------------------------------------------------

function MatchesCard({ data, onChanged }: { data: Data; onChanged: () => void }) {
  return (
    <section aria-labelledby="matches-heading">
      <h2 id="matches-heading">uAttend names</h2>
      <p className="muted">
        How uAttend spells each person, and who that is in the tracker. Fix a wrong match here: the hours already imported under that name move to
        the right person. Choosing “Not in the tracker” removes them.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>uAttend name</th>
            <th>Tracker person</th>
          </tr>
        </thead>
        <tbody>
          {data.names.length === 0 && (
            <tr>
              <td colSpan={2} className="empty">
                No names yet. They are added by the first upload.
              </td>
            </tr>
          )}
          {data.names.map((n) => (
            <MatchRow key={n.name_key} name={n} accounts={data.accounts} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </section>
  )
}

function MatchRow({ name, accounts, onChanged }: { name: UattendName; accounts: Account[]; onChanged: () => void }) {
  const [value, setValue] = useState<Match>(name.profile_id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const changed = value !== name.profile_id
  useUnsavedWarning(changed)
  const target = accounts.find((a) => a.id === value)?.full_name

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await setUattendMatch(name.uattend_name, value)
      setDone(true)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr>
      <td data-label="uAttend name">
        <strong>{name.uattend_name}</strong>
      </td>
      <td data-label="Tracker person">
        <div className="match-edit">
          <PersonSelect
            id={`known-${name.name_key}`}
            label={`Tracker person for ${name.uattend_name}`}
            value={value}
            accounts={accounts}
            allowUndecided={false}
            onChange={(v) => {
              setValue(v)
              setDone(false)
              setError(null)
            }}
          />
          {changed && (
            <>
              <p className="form-note">
                {value === null
                  ? `Hours already imported for ${name.uattend_name} will be removed.`
                  : name.profile_id === null
                    ? `Upload the file again to bring in ${name.uattend_name}'s hours for ${target}.`
                    : `Hours already imported for ${name.uattend_name} will move to ${target}.`}
              </p>
              <div className="button-row">
                <button type="button" className="secondary" onClick={() => setValue(name.profile_id)} disabled={saving}>
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save match'}
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              Not saved. {error}
            </p>
          )}
          {done && !changed && (
            <p className="save-status saved" role="status">
              Match saved
            </p>
          )}
        </div>
      </td>
    </tr>
  )
}
