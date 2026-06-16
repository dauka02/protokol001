import { useEffect, useState } from 'react'
import { copySummary, downloadDoc } from '../lib/word.js'
import { finishMeeting } from '../lib/notion.js'

function Block({ index, title, children }) {
  return (
    <div className="block">
      <div className="block__head">
        <span className="block__index">{index}</span>
        <span className="block__title">{title}</span>
      </div>
      {children}
    </div>
  )
}

function BulletList({ items }) {
  if (!items || items.length === 0) {
    return <p className="empty-line">— не зафиксировано —</p>
  }
  return (
    <ul className="list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

// Три строки результата «Завершить совещание». Каждая — { status, node }.
function meetingLine(r) {
  if (r.meetingSaved) {
    return {
      status: 'ok',
      node: (
        <>
          Протокол сохранён
          {r.meetingUrl && (
            <>
              {' · '}
              <a href={r.meetingUrl} target="_blank" rel="noopener noreferrer">
                Открыть страницу →
              </a>
            </>
          )}
        </>
      ),
    }
  }
  return {
    status: 'err',
    node: `Протокол не сохранён${r.meetingError ? `: ${r.meetingError}` : ''}`,
  }
}

function tasksLine(r) {
  if (!r.tasksError) {
    return { status: 'ok', node: `Задач в трекере: ${r.tasksCreated}` }
  }
  if (r.tasksCreated > 0) {
    return {
      status: 'ok',
      node: `Задач в трекере: ${r.tasksCreated} (часть с ошибкой: ${r.tasksError})`,
    }
  }
  const skip = /не подключена/i.test(r.tasksError)
  return { status: skip ? 'skip' : 'err', node: `Задачи в трекере: ${r.tasksError}` }
}

function telegramLine(r) {
  const names = r.telegramRecipients.length ? ` (${r.telegramRecipients.join(', ')})` : ''
  if (!r.telegramError || r.telegramSent > 0) {
    return { status: 'ok', node: `В Telegram отправлено: ${r.telegramSent}${names}` }
  }
  const skip = /не настроена/i.test(r.telegramError)
  return { status: skip ? 'skip' : 'err', node: `В Telegram: ${r.telegramError}` }
}

const STATUS_ICON = { ok: '✓', err: '✕', skip: '—' }

export default function Protocol({ protocol, onRestart }) {
  const [toast, setToast] = useState('')
  // 'idle' | 'running' | 'done'
  const [finish, setFinish] = useState({ state: 'idle', result: null, error: '' })

  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => setToast(''), 2200)
    return () => clearTimeout(id)
  }, [toast])

  const handleCopy = async () => {
    try {
      await copySummary(protocol)
      setToast('Саммари скопировано в буфер')
    } catch {
      setToast('Не удалось скопировать')
    }
  }

  const handleDownload = () => {
    downloadDoc(protocol)
    setToast('Документ Word скачивается')
  }

  // Один запрос: протокол + задачи + рассылка в Telegram.
  const handleFinish = async () => {
    if (finish.state === 'running') return
    setFinish({ state: 'running', result: null, error: '' })
    try {
      const result = await finishMeeting(protocol)
      setFinish({ state: 'done', result, error: '' })
      setToast('Совещание завершено')
    } catch (err) {
      setFinish({ state: 'idle', result: null, error: err.message || 'Ошибка' })
    }
  }

  const p = protocol
  const r = finish.result

  return (
    <section className="protocol">
      <div className="protocol__bar">
        <button className="btn btn--ghost" onClick={onRestart}>
          ← Новая встреча
        </button>
        <div className="protocol__bar-actions">
          <button className="btn btn--ghost" onClick={handleCopy}>
            Копировать саммари
          </button>
          <button className="btn btn--ghost" onClick={handleDownload}>
            ↓ Скачать Word
          </button>
          <button
            className="btn btn--accent btn--lg"
            onClick={handleFinish}
            disabled={finish.state === 'running'}
          >
            {finish.state === 'running' ? (
              <span className="loader" aria-label="Завершаю совещание">
                <span />
                <span />
                <span />
              </span>
            ) : (
              '✦ Завершить совещание'
            )}
          </button>
        </div>
      </div>

      {finish.error && (
        <div className="notion-status notion-status--error">{finish.error}</div>
      )}

      {r && (
        <ol className="finish-steps finish-result">
          {[meetingLine(r), tasksLine(r), telegramLine(r)].map((l, i) => (
            <li className={`finish-step finish-step--${l.status}`} key={i}>
              <span className="finish-step__icon" aria-hidden="true">
                {STATUS_ICON[l.status]}
              </span>
              <span className="finish-step__label">{l.node}</span>
            </li>
          ))}
        </ol>
      )}

      <article className="doc">
        <header className="doc__head">
          <h1 className="doc__title">{p.тема || 'Протокол совещания'}</h1>
          <div className="doc__meta">
            <span>
              <b>Дата:</b> {p.дата || 'не указана'}
            </span>
            <span>
              <b>Задач:</b> {p.задачи?.length || 0}
            </span>
            <span>
              <b>Статус:</b> новый
            </span>
          </div>
        </header>

        <div className="doc__body stagger">
          <Block index="01" title="Участники">
            {p.участники && p.участники.length ? (
              <div className="people">
                {p.участники.map((person, i) => (
                  <span className="person" key={i}>
                    {person}
                  </span>
                ))}
              </div>
            ) : (
              <p className="empty-line">— не указаны —</p>
            )}
          </Block>

          <Block index="02" title="Краткое резюме">
            <p className="summary-text">{p.краткое_резюме || '— нет —'}</p>
          </Block>

          <Block index="03" title="Цели встречи">
            <BulletList items={p.цели_встречи} />
          </Block>

          <Block index="04" title="Ключевые решения">
            <BulletList items={p.ключевые_решения} />
          </Block>

          <Block index="05" title="Задачи">
            {p.задачи && p.задачи.length ? (
              <div className="tasks">
                {p.задачи.map((t, i) => (
                  <div className="task" key={i}>
                    <span className="task__no">{String(i + 1).padStart(2, '0')}</span>
                    <div className="task__main">
                      <span className="task__text">{t.задача}</span>
                      <div className="task__attrs">
                        <span>
                          <b>Кто:</b> {t.ответственный}
                        </span>
                        <span>
                          <b>Срок:</b> {t.срок}
                        </span>
                      </div>
                    </div>
                    <div className="task__side">
                      <span className={`badge badge--${t.приоритет}`}>{t.приоритет}</span>
                      <span className="badge badge--status">{t.статус}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-line">— задач нет —</p>
            )}
          </Block>

          <Block index="06" title="Важные детали">
            <BulletList items={p.важные_детали} />
          </Block>

          <Block index="07" title="Открытые вопросы">
            <BulletList items={p.открытые_вопросы} />
          </Block>

          <Block index="08" title="Следующая встреча">
            {p.следующая_встреча ? (
              <span className="next-meeting">◷ {p.следующая_встреча}</span>
            ) : (
              <p className="empty-line">— не запланирована —</p>
            )}
          </Block>
        </div>
      </article>

      {toast && <div className="toast">{toast}</div>}
    </section>
  )
}
