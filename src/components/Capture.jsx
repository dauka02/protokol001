import { useEffect, useMemo, useRef, useState } from 'react'
import { createRecognizer, isSpeechSupported } from '../lib/speech.js'
import { extractProtocol } from '../lib/extract.js'
import { DEMO_TRANSCRIPT } from '../lib/demo.js'

const LANGS = [
  { code: 'ru-RU', label: 'RU' },
  { code: 'en-US', label: 'EN' },
]

export default function Capture({ onResult }) {
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const [recording, setRecording] = useState(false)
  const [lang, setLang] = useState('ru-RU')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const recognizerRef = useRef(null)
  const speechOK = useMemo(() => Boolean(isSpeechSupported()), [])

  // Останавливаем распознавание при размонтировании.
  useEffect(() => {
    return () => recognizerRef.current?.stop()
  }, [])

  const startRecording = () => {
    setError('')
    const base = text ? text.replace(/\s*$/, '') + ' ' : ''
    const rec = createRecognizer({
      lang,
      onResult: (finalText, interimText) => {
        setText(base + finalText)
        setInterim(interimText)
      },
      onError: (msg) => {
        setError(msg)
        setRecording(false)
        setInterim('')
      },
      onEnd: () => {
        setRecording(false)
        setInterim('')
      },
    })
    if (!rec) {
      setError('Распознавание речи недоступно в этом браузере.')
      return
    }
    recognizerRef.current = rec
    rec.start()
    setRecording(true)
  }

  const stopRecording = () => {
    recognizerRef.current?.stop()
    setRecording(false)
    setInterim('')
  }

  const toggleRecording = () => (recording ? stopRecording() : startRecording())

  const onLang = (code) => {
    setLang(code)
    recognizerRef.current?.setLang(code)
  }

  const insertDemo = () => {
    if (recording) stopRecording()
    setError('')
    setText(DEMO_TRANSCRIPT)
  }

  const clearText = () => {
    if (recording) stopRecording()
    setText('')
    setInterim('')
    setError('')
  }

  const generate = async () => {
    const transcript = text.trim()
    if (!transcript) {
      setError('Сначала запишите речь или вставьте текст встречи.')
      return
    }
    if (recording) stopRecording()
    setBusy(true)
    setError('')
    try {
      const protocol = await extractProtocol(transcript)
      onResult(protocol)
    } catch (err) {
      setError(err.message || 'Не удалось собрать протокол.')
    } finally {
      setBusy(false)
    }
  }

  const charCount = text.length

  return (
    <section className="capture">
      <div className="section-head">
        <span className="eyebrow">Шаг 1 · Захват</span>
        <h2>Запись или вставка текста</h2>
        <p>
          Включите микрофон — речь будет расшифрована прямо в браузере. Или
          вставьте готовый транскрипт. Текст можно редактировать перед сборкой.
        </p>
      </div>

      <div className="capture__grid">
        <div className="panel">
          <div className="panel__label">
            <span className="mono">Микрофон</span>
            <div className="lang-switch" role="group" aria-label="Язык распознавания">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  className={lang === l.code ? 'is-active' : ''}
                  onClick={() => onLang(l.code)}
                  disabled={recording}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="recorder">
            <button
              className={`rec-btn ${recording ? 'is-recording' : ''}`}
              onClick={toggleRecording}
              disabled={!speechOK || busy}
              aria-label={recording ? 'Остановить запись' : 'Начать запись'}
            >
              <span className="rec-btn__dot" />
            </button>
            <div className="recorder__meta">
              <span className="recorder__status">
                {recording ? 'Идёт запись…' : 'Готово к записи'}
              </span>
              <span className="recorder__hint">
                {speechOK
                  ? 'Web Speech API · Chrome / Edge на https'
                  : 'Браузер не поддерживает распознавание — вставьте текст'}
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel__label">
            <span className="mono">Транскрипт</span>
            <div className="actions-row">
              <button className="btn btn--ghost" onClick={insertDemo} disabled={busy}>
                Вставить демо
              </button>
              <button
                className="btn btn--ghost"
                onClick={clearText}
                disabled={busy || (!text && !interim)}
              >
                Очистить
              </button>
            </div>
          </div>

          <textarea
            className="transcript"
            value={interim ? `${text}${text ? ' ' : ''}${interim}` : text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Здесь появится расшифровка речи. Или вставьте текст встречи…"
            disabled={busy}
          />

          <div className="transcript-foot">
            <span className="count">{charCount} символов</span>
            <button
              className="btn btn--accent btn--lg"
              onClick={generate}
              disabled={busy || !text.trim()}
            >
              {busy ? (
                <span className="loader" aria-label="Собираем протокол">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                'Собрать протокол →'
              )}
            </button>
          </div>
        </div>
      </div>

      {!speechOK && (
        <div className="notice notice--warn">
          Распознавание речи доступно в Chrome и Edge на защищённом соединении
          (https). На других браузерах используйте вставку текста или кнопку
          «Вставить демо».
        </div>
      )}

      {error && <div className="notice notice--error">{error}</div>}
    </section>
  )
}
