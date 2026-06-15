import Anthropic from '@anthropic-ai/sdk'

// Модель по умолчанию — задана в брифе пилота. Можно переопределить env-переменной.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

// Системный промпт — дословно из брифа пилота.
const SYSTEM_PROMPT = `Ты — AI-секретарь совещаний. На вход — транскрипт встречи (возможны ошибки распознавания).
Верни СТРОГО JSON без markdown с полями: тема, дата (null если не названа), участники[],
краткое_резюме (2-4 предложения), цели_встречи[], ключевые_решения[],
задачи[{задача, ответственный, срок, приоритет: высокий|средний|низкий, статус: "новая"}],
важные_детали[], открытые_вопросы[], следующая_встреча (null если не упомянута).
Правила: задачи формулируй как действие (глагол + результат); если ответственный или срок
не назван — пиши "не указан", не выдумывай; в важные_детали выноси цифры, условия и контекст
решений; исправляй очевидные ошибки распознавания по контексту; не добавляй пунктов, которых
не было; статус всегда "новая".`

// Каркас протокола — гарантируем форму ответа независимо от модели.
const EMPTY_PROTOCOL = {
  тема: '',
  дата: null,
  участники: [],
  краткое_резюме: '',
  цели_встречи: [],
  ключевые_решения: [],
  задачи: [],
  важные_детали: [],
  открытые_вопросы: [],
  следующая_встреча: null,
}

const PRIORITIES = ['высокий', 'средний', 'низкий']

function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter(Boolean)
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null
  const задача = String(raw.задача ?? '').trim()
  if (!задача) return null
  let приоритет = String(raw.приоритет ?? '').trim().toLowerCase()
  if (!PRIORITIES.includes(приоритет)) приоритет = 'средний'
  return {
    задача,
    ответственный: String(raw.ответственный ?? 'не указан').trim() || 'не указан',
    срок: String(raw.срок ?? 'не указан').trim() || 'не указан',
    приоритет,
    статус: 'новая',
  }
}

// Приводим что бы ни вернула модель к строгой схеме протокола.
function normalizeProtocol(data) {
  const safe = data && typeof data === 'object' ? data : {}
  const дата = typeof safe.дата === 'string' && safe.дата.trim() ? safe.дата.trim() : null
  const следующая =
    typeof safe.следующая_встреча === 'string' && safe.следующая_встреча.trim()
      ? safe.следующая_встреча.trim()
      : null

  return {
    тема: String(safe.тема ?? '').trim(),
    дата,
    участники: asStringArray(safe.участники),
    краткое_резюме: String(safe.краткое_резюме ?? '').trim(),
    цели_встречи: asStringArray(safe.цели_встречи),
    ключевые_решения: asStringArray(safe.ключевые_решения),
    задачи: Array.isArray(safe.задачи) ? safe.задачи.map(normalizeTask).filter(Boolean) : [],
    важные_детали: asStringArray(safe.важные_детали),
    открытые_вопросы: asStringArray(safe.открытые_вопросы),
    следующая_встреча: следующая,
  }
}

// Модель просим вернуть чистый JSON, но защищаемся от markdown-обёрток / лишнего текста.
function parseModelJson(text) {
  if (!text) throw new Error('Пустой ответ модели')
  let cleaned = text.trim()
  // Снимаем ```json ... ``` если вдруг попались.
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // Берём первый сбалансированный { ... } блок.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error('Не удалось разобрать JSON из ответа модели')
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Метод не поддерживается. Используйте POST.' })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error:
        'Не настроен ANTHROPIC_API_KEY. Добавьте ключ в переменные окружения Vercel.',
    })
  }

  // Тело может прийти строкой (зависит от рантайма) — разбираем аккуратно.
  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = {}
    }
  }

  const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : ''
  if (!transcript) {
    return res.status(400).json({ error: 'Пустой транскрипт. Передайте поле "transcript".' })
  }
  if (transcript.length > 60000) {
    return res.status(413).json({
      error: 'Транскрипт слишком длинный (>60000 символов). Сократите текст.',
    })
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Транскрипт встречи:\n\n${transcript}`,
        },
      ],
    })

    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')

    const parsed = parseModelJson(text)
    const protocol = normalizeProtocol(parsed)

    return res.status(200).json({ protocol, model: message.model })
  } catch (err) {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 502
    const message =
      status === 401
        ? 'Неверный ключ Anthropic (401). Проверьте ANTHROPIC_API_KEY.'
        : status === 429
          ? 'Превышен лимит запросов к Anthropic (429). Повторите позже.'
          : 'Не удалось получить саммари от модели. Попробуйте ещё раз.'
    // Лог для серверной стороны; в браузер — только безопасное сообщение.
    console.error('extract error:', err?.message || err)
    return res.status(status >= 400 && status < 600 ? status : 502).json({ error: message })
  }
}
