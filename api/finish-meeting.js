// Serverless-функция Vercel: «Завершить совещание» — всё одним запросом.
// Три независимых шага, каждый в своём try/catch (ошибка одного не роняет others):
//   1) страница в базе «Совещания»
//   2) строки в трекере «Задачи» (по реальной схеме базы)
//   3) рассылка задач ответственным в Telegram
// Все запросы к Notion: Authorization: Bearer <NOTION_TOKEN>, Notion-Version: 2022-06-28.

const NOTION_VERSION = '2022-06-28'
const TEXT_LIMIT = 2000 // лимит rich_text-фрагмента Notion
const PRIORITIES = ['высокий', 'средний', 'низкий']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const CHAT_ID = /^\d+$/ // chat_id — только цифры (значение с «+» — телефон, пропускаем)

const text = (v) => String(v ?? '').slice(0, TEXT_LIMIT)
const normLower = (s) => String(s ?? '').trim().toLowerCase()

function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((i) => (typeof i === 'string' ? i.trim() : String(i ?? '').trim()))
    .filter(Boolean)
}

const notionHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
})

// ---------- блоки тела страницы ----------
const heading = (c) => ({
  object: 'block',
  type: 'heading_2',
  heading_2: { rich_text: [{ type: 'text', text: { content: text(c) } }] },
})
const paragraph = (c) => ({
  object: 'block',
  type: 'paragraph',
  paragraph: { rich_text: [{ type: 'text', text: { content: text(c) } }] },
})
const bullet = (c) => ({
  object: 'block',
  type: 'bulleted_list_item',
  bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text(c) } }] },
})
const listBlocks = (items) =>
  !items || items.length === 0 ? [paragraph('— не зафиксировано —')] : items.map(bullet)

// ============ ШАГ 1: страница совещания ============
async function saveMeeting(token, databaseId, p) {
  if (!databaseId) throw new Error('NOTION_DATABASE_ID не задан.')

  const тема = String(p.тема ?? '').trim() || 'Протокол совещания'
  const дата = typeof p.дата === 'string' ? p.дата.trim() : ''
  const участники = asStringArray(p.участники)
  const задачи = Array.isArray(p.задачи) ? p.задачи : []

  const properties = {
    Тема: { title: [{ type: 'text', text: { content: text(тема) } }] },
  }
  const hasValidDate = ISO_DATE.test(дата)
  if (hasValidDate) properties['Дата'] = { date: { start: дата } }

  const children = []
  const meta = []
  if (!hasValidDate && дата) meta.push(`Дата: ${дата}`)
  if (участники.length) meta.push(`Участники: ${участники.join(', ')}`)
  if (meta.length) children.push(paragraph(meta.join('  •  ')))

  children.push(heading('Краткое резюме'))
  children.push(paragraph(String(p.краткое_резюме ?? '').trim() || '—'))
  children.push(heading('Цели встречи'))
  children.push(...listBlocks(asStringArray(p.цели_встречи)))
  children.push(heading('Ключевые решения'))
  children.push(...listBlocks(asStringArray(p.ключевые_решения)))
  children.push(heading('Задачи'))
  if (задачи.length === 0) {
    children.push(paragraph('— задач нет —'))
  } else {
    задачи.forEach((t) => {
      const з = String(t?.задача ?? '').trim()
      if (!з) return
      const отв = String(t?.ответственный ?? 'не указан').trim() || 'не указан'
      const срок = String(t?.срок ?? 'не указан').trim() || 'не указан'
      const пр = String(t?.приоритет ?? 'средний').trim() || 'средний'
      children.push(bullet(`${з} — ${отв}, ${срок} (${пр})`))
    })
  }
  children.push(heading('Важные детали'))
  children.push(...listBlocks(asStringArray(p.важные_детали)))
  children.push(heading('Открытые вопросы'))
  children.push(...listBlocks(asStringArray(p.открытые_вопросы)))
  children.push(heading('Следующая встреча'))
  const след = typeof p.следующая_встреча === 'string' ? p.следующая_встреча.trim() : ''
  children.push(paragraph(след || 'не запланирована'))

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      children: children.slice(0, 100),
    }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const map = {
      unauthorized: 'Неверный NOTION_TOKEN или нет доступа к базе «Совещания».',
      object_not_found: 'База «Совещания» не найдена (NOTION_DATABASE_ID).',
      validation_error: 'Notion отклонил данные. Нужно title-свойство «Тема».',
    }
    throw new Error(map[data?.code] || data?.message || `Ошибка Notion (${res.status}).`)
  }
  return data?.url || null
}

// ============ ШАГ 2: строки в трекере «Задачи» ============
function matchOption(prop, desired) {
  const options = prop?.[prop.type]?.options
  if (Array.isArray(options)) {
    const found = options.find((o) => normLower(o?.name) === normLower(desired))
    if (found) return found.name
  }
  return null
}

// Значение свойства под реальный тип. undefined → свойство пропускается (строка
// всё равно создаётся). Для status без нужной опции возвращаем undefined.
function valueForType(prop, value) {
  const v = String(value ?? '').trim()
  switch (prop?.type) {
    case 'title':
      return { title: [{ type: 'text', text: { content: text(v) } }] }
    case 'rich_text':
      return { rich_text: [{ type: 'text', text: { content: text(v) } }] }
    case 'select':
      return v ? { select: { name: matchOption(prop, v) || v } } : undefined
    case 'status': {
      const name = matchOption(prop, v) // status-опции через API не создаются
      return name ? { status: { name } } : undefined
    }
    case 'date':
      return ISO_DATE.test(v) ? { date: { start: v } } : undefined
    case 'number': {
      const n = Number(v.replace(',', '.'))
      return v && !Number.isNaN(n) ? { number: n } : undefined
    }
    case 'url':
      return v ? { url: v } : undefined
    case 'email':
      return v ? { email: v } : undefined
    case 'phone_number':
      return v ? { phone_number: v } : undefined
    default:
      return undefined
  }
}

// Строит свойства строки задачи под реальную схему базы.
// Заголовок (свойство типа title) заполняется ВСЕГДА значением task["задача"].
// Остальные поля — по имени свойства (без учёта регистра); пустые пропускаются.
function buildTaskProps(row, byName, titleEntry) {
  const props = {}

  // Заголовок «Задача» — обязателен, ставим по фактическому title-свойству.
  if (titleEntry) {
    props[titleEntry.name] = { title: [{ type: 'text', text: { content: text(row.задача) } }] }
  }

  const fields = [
    ['Ответственный', row.ответственный],
    ['Срок', row.срок],
    ['Приоритет', row.приоритет],
    ['Статус', row.статус],
    ['Совещание', row.совещание],
  ]
  for (const [wantName, value] of fields) {
    const v = String(value ?? '').trim()
    if (!v) continue // пустое значение — свойство не добавляем
    const entry = byName.get(normLower(wantName))
    if (!entry || entry.prop?.type === 'title') continue // нет свойства / это title — пропуск
    const built = valueForType(entry.prop, v)
    if (built) props[entry.name] = built
  }
  return props
}

async function createTasks(token, tasksDbId, p) {
  const задачи = Array.isArray(p.задачи) ? p.задачи : []
  const тема = String(p.тема ?? '').trim() || 'Совещание'
  const дата = typeof p.дата === 'string' ? p.дата.trim() : ''
  const meetingRef = дата ? `${тема} — ${дата}` : тема

  // Читаем РУССКИЕ ключи задачи; строку без текста задачи не создаём.
  const rows = задачи
    .map((t) => {
      const задача = String(t?.['задача'] ?? '').trim()
      if (!задача) return null
      let приоритет = String(t?.['приоритет'] ?? '').trim().toLowerCase()
      if (приоритет && !PRIORITIES.includes(приоритет)) приоритет = 'средний'
      return {
        задача,
        ответственный: String(t?.['ответственный'] ?? '').trim(),
        срок: String(t?.['срок'] ?? '').trim(),
        приоритет,
        статус: 'Новая',
        совещание: meetingRef,
      }
    })
    .filter(Boolean)

  if (rows.length === 0) return { created: 0, error: null, sample: null }

  // Схема базы → реальные типы и имена свойств.
  const schemaRes = await fetch(`https://api.notion.com/v1/databases/${tasksDbId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
  })
  const schemaData = await schemaRes.json().catch(() => null)
  if (!schemaRes.ok) {
    const map = {
      unauthorized: 'Нет доступа к базе «Задачи».',
      object_not_found: 'База «Задачи» не найдена (NOTION_TASKS_DB_ID).',
    }
    throw new Error(
      map[schemaData?.code] || schemaData?.message || `Ошибка чтения базы «Задачи» (${schemaRes.status}).`,
    )
  }
  const schema = schemaData?.properties || {}

  // Индекс свойств по нормализованному имени + поиск title-свойства по типу.
  const byName = new Map()
  let titleEntry = null
  for (const [name, prop] of Object.entries(schema)) {
    byName.set(normLower(name), { name, prop })
    if (prop?.type === 'title') titleEntry = { name, prop }
  }

  // Отладочный пример: что реально уходит в Notion на первую задачу.
  const sample = {
    titleProperty: titleEntry?.name || null,
    values: {
      Задача: rows[0].задача,
      Ответственный: rows[0].ответственный,
      Срок: rows[0].срок,
      Приоритет: rows[0].приоритет,
      Статус: rows[0].статус,
      Совещание: rows[0].совещание,
    },
    schemaTypes: Object.fromEntries(Object.entries(schema).map(([n, pr]) => [n, pr?.type])),
    properties: buildTaskProps(rows[0], byName, titleEntry),
  }

  const results = await Promise.allSettled(
    rows.map((row) => {
      const properties = buildTaskProps(row, byName, titleEntry)
      return fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: notionHeaders(token),
        body: JSON.stringify({ parent: { database_id: tasksDbId }, properties }),
      }).then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => null)
          throw new Error(d?.message || `Ошибка Notion (${r.status})`)
        }
        return true
      })
    }),
  )
  const created = results.filter((r) => r.status === 'fulfilled').length
  const firstError = results.find((r) => r.status === 'rejected')?.reason?.message || null
  return { created, error: created < rows.length ? firstError : null, sample }
}

// ============ ШАГ 3: рассылка в Telegram ============
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
    case 'select':
      return String(prop.select?.name ?? '').trim()
    case 'formula':
      return String(prop.formula?.string ?? prop.formula?.number ?? '').trim()
    case 'unique_id':
      return prop.unique_id?.number == null ? '' : String(prop.unique_id.number)
    default:
      return ''
  }
}
function readName(properties) {
  for (const value of Object.values(properties || {})) {
    if (value?.type === 'title') return propToString(value)
  }
  return ''
}

async function loadContacts(token, contactsDbId) {
  const map = new Map()
  let cursor
  for (let page = 0; page < 20; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`https://api.notion.com/v1/databases/${contactsDbId}/query`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    })
    // eslint-disable-next-line no-await-in-loop
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const map2 = {
        unauthorized: 'Нет доступа к базе «Контакты».',
        object_not_found: 'База «Контакты» не найдена (NOTION_CONTACTS_DB_ID).',
      }
      throw new Error(map2[data?.code] || data?.message || `Ошибка Notion (${res.status}).`)
    }
    for (const row of data?.results || []) {
      // Имя — без учёта регистра и с trim; берём колонку именно «Telegram» (не «Телефон»).
      const name = normLower(readName(row.properties))
      const telegram = propToString(row.properties?.['Telegram']).trim()
      if (name && !map.has(name)) map.set(name, telegram)
    }
    if (!data?.has_more) break
    cursor = data?.next_cursor
  }
  return map
}

async function sendTelegram(botToken, chatId, message) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.ok === false) {
    const desc = data?.description || `HTTP ${res.status}`
    console.error('telegram send error:', res.status, desc)
    return { ok: false, error: desc }
  }
  return { ok: true, error: null }
}

async function notifyTelegram(notionToken, botToken, contactsDbId, p) {
  const тема = String(p.тема ?? '').trim() || 'Совещание'
  const дата = typeof p.дата === 'string' ? p.дата.trim() : ''
  const задачи = Array.isArray(p.задачи) ? p.задачи : []

  // Группируем задачи по ответственному.
  const byPerson = new Map()
  for (const t of задачи) {
    const задача = String(t?.['задача'] ?? '').trim()
    if (!задача) continue
    const person = String(t?.['ответственный'] ?? '').trim()
    if (!person || normLower(person) === 'не указан') continue
    if (!byPerson.has(person)) byPerson.set(person, [])
    byPerson.get(person).push({
      задача,
      срок: String(t?.['срок'] ?? 'не указан').trim() || 'не указан',
      приоритет: String(t?.['приоритет'] ?? 'средний').trim() || 'средний',
    })
  }
  if (byPerson.size === 0) return { sent: 0, recipients: [], report: [] }

  const contacts = await loadContacts(notionToken, contactsDbId)
  const dateLabel = дата ? ` (${дата})` : ''
  const recipients = []
  const report = [] // диагностика по каждому ответственному
  let sent = 0

  for (const [person, tasks] of byPerson) {
    const key = normLower(person)
    // Сопоставляем имя без учёта регистра и с trim.
    if (!contacts.has(key)) {
      report.push({ ответственный: person, статус: 'контакт не найден' })
      continue
    }
    const telegram = (contacts.get(key) || '').trim()
    if (!CHAT_ID.test(telegram)) {
      report.push({
        ответственный: person,
        статус: `нет числового chat_id (значение: ${telegram || 'пусто'})`,
      })
      continue
    }
    const lines = tasks.map(
      (t) => `— ${t.задача} · срок: ${t.срок} · приоритет: ${t.приоритет}`,
    )
    const message = `Совещание: ${тема}${dateLabel}\nТвои задачи:\n${lines.join('\n')}`
    // eslint-disable-next-line no-await-in-loop
    const { ok, error } = await sendTelegram(botToken, telegram, message)
    if (ok) {
      sent += 1
      recipients.push(person)
      report.push({ ответственный: person, статус: 'отправлено' })
    } else {
      report.push({ ответственный: person, статус: `ошибка Telegram: ${error}` })
    }
  }
  return { sent, recipients, report }
}

// ============ обработчик ============
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Метод не поддерживается. Используйте POST.' })
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

  // Все id/токены читаем с .trim() — лишние пробелы ломают URL (%20 в пути).
  const notionToken = (process.env.NOTION_TOKEN || '').trim()
  const meetingsDb = (process.env.NOTION_DATABASE_ID || '').trim()
  const tasksDb = (process.env.NOTION_TASKS_DB_ID || '').trim()
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim()
  const contactsDb = (process.env.NOTION_CONTACTS_DB_ID || '').trim()

  const out = {
    meetingSaved: false,
    meetingUrl: null,
    meetingError: null,
    tasksCreated: 0,
    tasksError: null,
    tasksSample: null,
    telegramSent: 0,
    telegramRecipients: [],
    telegramReport: [],
    telegramError: null,
  }

  // ШАГ 1 — Совещание
  try {
    if (!notionToken) throw new Error('NOTION_TOKEN не задан.')
    out.meetingUrl = await saveMeeting(notionToken, meetingsDb, p)
    out.meetingSaved = true
  } catch (err) {
    out.meetingError = err.message || 'Не удалось сохранить протокол.'
    console.error('finish step1:', err?.message || err)
  }

  // ШАГ 2 — Трекер задач
  try {
    if (!tasksDb) {
      out.tasksError = 'база «Задачи» не подключена'
    } else if (!notionToken) {
      out.tasksError = 'NOTION_TOKEN не задан'
    } else {
      const { created, error, sample } = await createTasks(notionToken, tasksDb, p)
      out.tasksCreated = created
      out.tasksError = error || null
      out.tasksSample = sample || null
    }
  } catch (err) {
    out.tasksError = err.message || 'Не удалось создать задачи.'
    console.error('finish step2:', err?.message || err)
  }

  // ШАГ 3 — Telegram
  try {
    if (!botToken || !contactsDb) {
      out.telegramError = 'рассылка не настроена'
    } else if (!notionToken) {
      out.telegramError = 'NOTION_TOKEN не задан'
    } else {
      const { sent, recipients, report } = await notifyTelegram(notionToken, botToken, contactsDb, p)
      out.telegramSent = sent
      out.telegramRecipients = recipients
      out.telegramReport = report || []
    }
  } catch (err) {
    out.telegramError = err.message || 'Не удалось отправить в Telegram.'
    console.error('finish step3:', err?.message || err)
  }

  return res.status(200).json(out)
}
