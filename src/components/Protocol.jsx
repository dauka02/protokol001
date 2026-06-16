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

export default function Protocol({ protocol, onRestart }) {
  const [toast, setToast] = useState('')
  // Notion: 'idle' | 'saving' | 'saved' | 'error'
  const [notion, setNotion] = useState({ status: 'idle', url: '', error: '' })
  // Telegram: 'idle' | 'sending' | 'sent' | 'error'
  const [tg, setTg] = useState({ status: 'idle', sent: 0, recipients: [], error: '' })

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
    setNotion({ status: 'saving', url: '', error: '' })
    try {
      const url = await saveToNotion(protocol)
      setNotion({ status: 'saved', url: url || '', error: '' })
      setToast('Сохранено в Notion')
    } catch (err) {
      setNotion({ status: 'error', url: '', error: err.message || 'Ошибка Notion' })
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

  const p = protocol

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

      {notion.status === 'saved' && (
        <div className="notion-status notion-status--ok">
          Протокол сохранён в Notion.
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
