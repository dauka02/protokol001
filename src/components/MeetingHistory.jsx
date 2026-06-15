import { useEffect, useState } from 'react'
import { listMeetings } from '../lib/notion.js'

const MONTHS = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
]

// ISO / YYYY-MM-DD → «25 июн 2026», иначе показываем как есть.
function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export default function MeetingHistory() {
  // 'loading' | 'ready' | 'error'
  const [state, setState] = useState('loading')
  const [meetings, setMeetings] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    listMeetings()
      .then((list) => {
        if (!alive) return
        setMeetings(list)
        setState('ready')
      })
      .catch((err) => {
        if (!alive) return
        setError(err.message || 'Не удалось загрузить историю.')
        setState('error')
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="landing__history">
      <div className="history__head">
        <h3>История встреч</h3>
        <span className="mono history__src">из Notion</span>
      </div>

      {state === 'loading' && (
        <div className="history__state">
          <span className="loader" aria-label="Загрузка">
            <span />
            <span />
            <span />
          </span>
          <span>Загружаем…</span>
        </div>
      )}

      {state === 'error' && (
        <div className="notice notice--error">{error}</div>
      )}

      {state === 'ready' && meetings.length === 0 && (
        <div className="history__state history__empty">Пока нет сохранённых встреч</div>
      )}

      {state === 'ready' && meetings.length > 0 && (
        <ul className="history__list">
          {meetings.map((m) => (
            <li className="history__item" key={m.id}>
              <div className="history__info">
                <span className="history__topic">{m.тема}</span>
                <span className="history__date mono">{formatDate(m.дата)}</span>
              </div>
              {m.url ? (
                <a
                  className="history__link"
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть в Notion →
                </a>
              ) : (
                <span className="history__link history__link--off">нет ссылки</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
