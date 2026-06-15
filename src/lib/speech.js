// Обёртка над Web Speech API (распознавание речи в браузере).
// Работает в Chrome/Edge на https. Бесплатно, без серверной расшифровки.

export function isSpeechSupported() {
  return (
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  )
}

// Создаёт распознаватель. Колбэки:
//   onResult(finalText, interimText) — накопленный финал + текущий промежуточный кусок
//   onError(message) — человекочитаемая ошибка
//   onEnd() — распознавание остановлено
export function createRecognizer({ lang = 'ru-RU', onResult, onError, onEnd } = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) return null

  const recognition = new Ctor()
  recognition.lang = lang
  recognition.continuous = true
  recognition.interimResults = true

  let finalText = ''
  // Браузер сам останавливает распознавание по паузе — если пользователь
  // не нажал «стоп», перезапускаем, чтобы запись шла непрерывно.
  let manualStop = false

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const chunk = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        finalText += chunk
      } else {
        interim += chunk
      }
    }
    onResult?.(finalText, interim)
  }

  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return
    const map = {
      'not-allowed': 'Доступ к микрофону запрещён. Разрешите его в настройках браузера.',
      'service-not-allowed':
        'Доступ к микрофону запрещён. Разрешите его в настройках браузера.',
      'audio-capture': 'Микрофон не найден. Подключите устройство ввода.',
      network: 'Ошибка сети при распознавании. Проверьте подключение.',
    }
    onError?.(map[event.error] || `Ошибка распознавания: ${event.error}`)
  }

  recognition.onend = () => {
    if (!manualStop) {
      try {
        recognition.start()
        return
      } catch {
        /* повторный старт не удался — завершаем */
      }
    }
    onEnd?.()
  }

  return {
    start() {
      manualStop = false
      finalText = ''
      try {
        recognition.start()
      } catch (err) {
        onError?.('Не удалось запустить запись. Перезагрузите страницу.')
      }
    },
    stop() {
      manualStop = true
      recognition.stop()
    },
    setLang(next) {
      recognition.lang = next
    },
  }
}
