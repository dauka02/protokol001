// Serverless-функция Vercel: рассылка задач ответственным в личку Telegram.
// Контакты берёт из базы Notion «Контакты» (Имя → Telegram),
// сообщения шлёт через Bot API. Токены — только в окружении.

const NOTION_VERSION = '2022-06-28'

// Числовой chat_id Telegram (личный — положительное число; допускаем ведущий «-»).
const CHAT_ID = /^-?\d+$/

// Достаёт значение свойства Notion как строку, независимо от типа.
function propToString(prop) {
  if (!prop || typeof prop !== 'object') return ''
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return (prop[prop.type] || []).map((t) => t?.plain_text ?? '').join('').trim()
    case 'phone_number':
      return String(prop.phone_number ?? '').trim()
    case 'number':
      return prop.number == null ? '' : String(prop.number)
    case 'email':
      return String(prop.email ?? '').trim()
    case 'url':
      return String(prop.url ?? '').trim()
    case 'select':
      return String(prop.select?.name ?? '').trim()
    case 'formula':
      return String(prop.formula?.string ?? prop.formula?.number ?? '').trim()
    default:
      return ''
  }
}

// Имя из title-свойства (любого, тип 'title').
function readName(properties) {
  for (const value of Object.values(properties || {})) {
    if (value?.type === 'title') return propToString(value)
  }
  return ''
}

const normKey = (s) => String(s ?? '').trim().toLowerCase()

// Тянет все строки базы «Контакты» → карта нормализованное_имя → значение «Telegram».
async function loadContacts(token, contactsDbId) {
  const map = new Map()
  let cursor
  // Пагинация на случай большой базы.
  for (let page = 0; page < 20; page += 1) {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${contactsDbId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
      },
    )
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const err = new Error(data?.message || `Ошибка Notion (${res.status}).`)
      err.code = data?.code
      err.status = res.status
      throw err
    }
    for (const row of data?.results || []) {
      const name = normKey(readName(row.properties))
      const telegram = propToString(row.properties?.['Telegram'])
      if (name && !map.has(name)) map.set(name, telegram)
    }
    if (!data?.has_more) break
    cursor = data?.next_cursor
  }
  return map
}

async function sendTelegram(botToken, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => null)
    console.error('telegram send error:', res.status, d?.description)
    return false
  }
  return true
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Метод не поддерживается. Используйте POST.' })
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID
  // База «Контакты» читается интеграцией Notion (тот же токен, что и для остального).
  const notionToken = process.env.NOTION_TOKEN
  if (!botToken || !contactsDbId) {
    return res.status(500).json({
      error:
        'Рассылка не настроена. Добавьте TELEGRAM_BOT_TOKEN и NOTION_CONTACTS_DB_ID в переменные окружения Vercel.',
    })
  }
  if (!notionToken) {
    return res.status(500).json({
      error: 'Не настроен NOTION_TOKEN для чтения базы «Контакты».',
    })
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = {}
    }
  }
  const p = body && typeof body === 'object' ? body : {}
  const тема = String(p.тема ?? '').trim() || 'Совещание'
  const дата = typeof p.дата === 'string' ? p.дата.trim() : ''
  const задачи = Array.isArray(p.задачи) ? p.задачи : []

  if (задачи.length === 0) {
    return res.status(400).json({ error: 'В протоколе нет задач для отправки.' })
  }

  // Группируем задачи по ответственному.
  const byPerson = new Map()
  for (const t of задачи) {
    const задача = String(t?.задача ?? '').trim()
    if (!задача) continue
    const person = String(t?.ответственный ?? '').trim()
    if (!person || normKey(person) === 'не указан') continue
    if (!byPerson.has(person)) byPerson.set(person, [])
    byPerson.get(person).push({
      задача,
      срок: String(t?.срок ?? 'не указан').trim() || 'не указан',
      приоритет: String(t?.приоритет ?? 'средний').trim() || 'средний',
    })
  }

  if (byPerson.size === 0) {
    return res.status(200).json({ sent: 0, recipients: [], skipped: [] })
  }

  let contacts
  try {
    contacts = await loadContacts(notionToken, contactsDbId)
  } catch (err) {
    const map = {
      unauthorized: 'Неверный NOTION_TOKEN или нет доступа к базе «Контакты».',
      object_not_found:
        'База «Контакты» не найдена. Проверьте NOTION_CONTACTS_DB_ID и доступ интеграции.',
      restricted_resource: 'У интеграции нет прав на базу «Контакты».',
    }
    return res
      .status(err.status >= 400 && err.status < 600 ? err.status : 502)
      .json({ error: map[err.code] || err.message || 'Не удалось прочитать базу «Контакты».' })
  }

  const dateLabel = дата ? ` (${дата})` : ''
  const recipients = []
  const skipped = []
  let sent = 0

  for (const [person, tasks] of byPerson) {
    const telegram = contacts.get(normKey(person)) || ''
    // Нет контакта или значение не числовой chat_id (например телефон) — пропуск.
    if (!CHAT_ID.test(telegram)) {
      skipped.push(person)
      continue
    }
    const lines = tasks.map(
      (t) => `— ${t.задача} · срок: ${t.срок} · приоритет: ${t.приоритет}`,
    )
    const message = `Совещание: ${тема}${dateLabel}\nТвои задачи:\n${lines.join('\n')}`
    // eslint-disable-next-line no-await-in-loop
    const ok = await sendTelegram(botToken, telegram, message)
    if (ok) {
      sent += 1
      recipients.push(person)
    } else {
      skipped.push(person)
    }
  }

  return res.status(200).json({ sent, recipients, skipped })
}
