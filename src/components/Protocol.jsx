import { useEffect, useState } from 'react'
import { copySummary, downloadDoc } from '../lib/word.js'
import { notifyTelegram, saveToNotion } from '../lib/notion.js'

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

// «N задач» с правильным склонением.
function plural(n, one, few, many) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

const tasksWord = (n) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`

// Текстовый итог по строкам в базе «Задачи».
function tasksSummary(tasks) {
  if (!tasks || !tasks.configured) return ''
  if (tasks.error) {
    return tasks.created > 0
      ? ` + ${tasksWord(tasks.created)} (часть с ошибкой: ${tasks.error})`
      : ` · задачи не созданы: ${tasks.error}`
  }
  return ` + ${tasksWord(tasks.created)}`
}

export default function Protocol({ protocol, onRestart }) {
  const [toast, setToast] = useState('')
  // Notion: 'idle' | 'saving' | 'saved' | 'error'
  const [notion, setNotion] = useState({ status: 'idle', url: '', error: '', tasks: null })
  // Telegram: 'idle' | 'sending' | 'sent' | 'error'
  const [tg, setTg] = useState({ status: 'idle', sent: 0, recipients: [], error: '' })
  // Цепочка «Завершить совещание»: список шагов с прогрессом.
  const [finish, setFinish] = useState({ running: false, steps: [] })

  const hasTasks = Array.isArray(protocol.задачи) && protocol.задачи.length > 0

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

  const handleNotion = async () => {
    if (notion.status === 'saving') return
    setNotion({ status: 'saving', url: '', error: '', tasks: null })
    try {
      const { url, tasks } = await saveToNotion(protocol)
      setNotion({ status: 'saved', url: url || '', error: '', tasks })
      setToast('Сохранено в Notion')
    } catch (err) {
      setNotion({ status: 'error', url: '', error: err.message || 'Ошибка Notion', tasks: null })
    }
  }

  const handleTelegram = async () => {
    if (tg.status === 'sending') return
    setTg({ status: 'sending', sent: 0, recipients: [], error: '' })
    try {
      const { sent, recipients } = await notifyTelegram(protocol)
      setTg({ status: 'sent', sent, recipients, error: '' })
      setToast(sent > 0 ? `Отправлено: ${sent}` : 'Никому не отправлено')
    } catch (err) {
      setTg({ status: 'error', sent: 0, recipients: [], error: err.message || 'Ошибка Telegram' })
    }
  }

  // «Завершить совещание»: сохранить протокол + задачи, затем разослать в Telegram.
  const handleFinish = async () => {
    if (finish.running) return
    const steps = [
      { key: 'protocol', label: 'Сохраняю протокол', status: 'run', detail: '' },
      { key: 'tasks', label: 'Создаю задачи', status: 'wait', detail: '' },
      { key: 'telegram', label: 'Отправляю в Telegram', status: 'wait', detail: '' },
    ]
    setFinish({ running: true, steps })
    const set = (key, patch) =>
      setFinish((f) => ({
        ...f,
        steps: f.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)),
      }))

    // Шаг 1–2: сохранение страницы и строк задач (один запрос).
    let saved
    try {
      saved = await saveToNotion(protocol)
      set('protocol', { status: 'ok', detail: '' })
      setNotion({ status: 'saved', url: saved.url || '', error: '', tasks: saved.tasks })
    } catch (err) {
      set('protocol', { status: 'err', detail: err.message || 'ошибка' })
      set('tasks', { status: 'skip', detail: 'пропущено' })
      set('telegram', { status: 'skip', detail: 'пропущено' })
      setFinish((f) => ({ ...f, running: false }))
      return
    }

    const t = saved.tasks || { configured: false, created: 0, error: null }
    if (!t.configured) {
      set('tasks', { status: 'skip', detail: 'база не подключена' })
    } else if (t.error && t.created === 0) {
      set('tasks', { status: 'err', detail: t.error })
    } else if (t.error) {
      set('tasks', { status: 'ok', detail: `${t.created}, часть с ошибкой` })
    } else {
      set('tasks', { status: 'ok', detail: String(t.created) })
    }

    // Шаг 3: рассылка в Telegram.
    if (!hasTasks) {
      set('telegram', { status: 'skip', detail: 'нет задач' })
      setFinish((f) => ({ ...f, running: false }))
      return
    }
    set('telegram', { status: 'run' })
    try {
      const { sent, recipients } = await notifyTelegram(protocol)
      set('telegram', { status: 'ok', detail: String(sent) })
      setTg({ status: 'sent', sent, recipients, error: '' })
    } catch (err) {
      set('telegram', { status: 'err', detail: err.message || 'ошибка' })
    }
    setFinish((f) => ({ ...f, running: false }))
  }

  const p = protocol

  return (
    <section className="protocol">
      <div className="protocol__bar">
        <button className="btn btn--ghost" onClick={onRestart}>
          ← Новая встреча
        </button>
        <div className="protocol__bar-actions">
          <button
            className="btn btn--accent"
            onClick={handleFinish}
            disabled={finish.running}
          >
            {finish.running ? (
              <span className="loader" aria-label="Завершаю совещание">
                <span />
                <span />
                <span />
              </span>
            ) : (
              '✦ Завершить совещание'
            )}
          </button>
          <button className="btn btn--ghost" onClick={handleCopy}>
            Копировать саммари
          </button>
          <button
            className="btn btn--ghost"
            onClick={handleNotion}
            disabled={notion.status === 'saving'}
          >
            {notion.status === 'saving' ? (
              <span className="loader" aria-label="Сохраняю в Notion">
                <span />
                <span />
                <span />
              </span>
            ) : notion.status === 'saved' ? (
              'Сохранено в Notion ✓'
            ) : (
              'Сохранить в Notion'
            )}
          </button>
          <button
            className="btn btn--ghost"
            onClick={handleTelegram}
            disabled={tg.status === 'sending' || !hasTasks}
            title={hasTasks ? '' : 'В протоколе нет задач'}
          >
            {tg.status === 'sending' ? (
              <span className="loader" aria-label="Отправляю в Telegram">
                <span />
                <span />
                <span />
              </span>
            ) : (
              'Отправить задачи в Telegram'
            )}
          </button>
          <button className="btn btn--primary" onClick={handleDownload}>
            ↓ Скачать Word
          </button>
        </div>
      </div>

      {finish.steps.length > 0 && (
        <ol className="finish-steps">
          {finish.steps.map((s) => (
            <li className={`finish-step finish-step--${s.status}`} key={s.key}>
              <span className="finish-step__icon" aria-hidden="true">
                {s.status === 'run' ? (
                  <span className="loader loader--sm">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : s.status === 'ok' ? (
                  '✓'
                ) : s.status === 'err' ? (
                  '✕'
                ) : s.status === 'skip' ? (
                  '—'
                ) : (
                  '·'
                )}
              </span>
              <span className="finish-step__label">{s.label}</span>
              {s.detail && <span className="finish-step__detail mono">{s.detail}</span>}
            </li>
          ))}
        </ol>
      )}

      {notion.status === 'saved' && (
        <div className="notion-status notion-status--ok">
          Сохранено: протокол{tasksSummary(notion.tasks)}.
          {notion.url && (
            <>
              {' '}
              <a href={notion.url} target="_blank" rel="noopener noreferrer">
                Открыть страницу →
              </a>
            </>
          )}
        </div>
      )}
      {notion.status === 'error' && (
        <div className="notion-status notion-status--error">{notion.error}</div>
      )}

      {tg.status === 'sent' && (
        <div className="notion-status notion-status--ok">
          {tg.sent > 0
            ? `Отправлено: ${tg.sent} ${tg.sent === 1 ? 'сообщение' : 'сообщений'}`
            : 'Сообщения не отправлены — нет подходящих контактов.'}
          {tg.recipients.length > 0 && (
            <span className="mono"> · {tg.recipients.join(', ')}</span>
          )}
        </div>
      )}
      {tg.status === 'error' && (
        <div className="notion-status notion-status--error">{tg.error}</div>
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
