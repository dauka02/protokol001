// Serverless-функция Vercel: сохраняет протокол в базу Notion.
// Читает NOTION_TOKEN и NOTION_DATABASE_ID из переменных окружения.
// Ключи в браузер не попадают.

const NOTION_VERSION = '2022-06-28'
// Notion ограничивает один rich_text фрагмент 2000 символами.
const TEXT_LIMIT = 2000

function text(value) {
  return String(value ?? '').slice(0, TEXT_LIMIT)
}

function heading(content) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: text(content) } }] },
  }
}

function paragraph(content) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text(content) } }] },
  }
}

function bullet(content) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text(content) } }] },
  }
}

// Список → буллеты (или строка-заглушка, если пусто).
function listBlocks(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [paragraph('— не зафиксировано —')]
  }
  return items.map((i) => bullet(i))
}

function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((i) => (typeof i === 'string' ? i.trim() : String(i ?? '').trim()))
    .filter(Boolean)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Подбирает имя select/status-опции по факту (без учёта регистра),
// иначе возвращает желаемое значение как есть.
function matchOption(prop, desired) {
  const options = prop?.[prop.type]?.options
  if (Array.isArray(options)) {
    const found = options.find((o) => normLower(o?.name) === normLower(desired))
    if (found) return found.name
  }
  return desired
}

const normLower = (s) => String(s ?? '').trim().toLowerCase()

// Строит значение свойства Notion под ФАКТИЧЕСКИЙ тип из схемы базы.
// Возвращает undefined, если значение пустое или тип не подходит.
function valueForType(prop, value) {
  const v = String(value ?? '').trim()
  switch (prop?.type) {
    case 'title':
      return { title: [{ type: 'text', text: { content: text(v) } }] }
    case 'rich_text':
      return { rich_text: [{ type: 'text', text: { content: text(v) } }] }
    case 'select':
      return v ? { select: { name: matchOption(prop, v) } } : undefined
    case 'status':
      return v ? { status: { name: matchOption(prop, v) } } : undefined
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
      return undefined // people / relation / files и пр. — пропускаем
  }
}

// Загружает схему базы «Задачи» → map имя свойства → дескриптор (с типом).
async function fetchTaskSchema(token, tasksDbId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${tasksDbId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(data?.message || `Ошибка чтения базы «Задачи» (${res.status}).`)
    err.code = data?.code
    throw err
  }
  return data?.properties || {}
}

// Создаёт по строке в базе «Задачи» на каждую задачу, заполняя свойства по их
// фактическим типам. Возвращает { created, total, error }.
async function createTaskRows(token, tasksDbId, задачи, meetingRef) {
  const tasks = (Array.isArray(задачи) ? задачи : [])
    .map((t) => {
      const задача = String(t?.задача ?? '').trim()
      if (!задача) return null
      let приоритет = String(t?.приоритет ?? '').trim().toLowerCase()
      if (!PRIORITIES.includes(приоритет)) приоритет = 'средний'
      return {
        Задача: задача,
        Ответственный: String(t?.ответственный ?? 'не указан').trim() || 'не указан',
        Срок: String(t?.срок ?? 'не указан').trim() || 'не указан',
        Приоритет: приоритет,
        Статус: 'Новая',
        Совещание: meetingRef,
      }
    })
    .filter(Boolean)

  if (tasks.length === 0) return { created: 0, total: 0, error: null }

  let schema
  try {
    schema = await fetchTaskSchema(token, tasksDbId)
  } catch (err) {
    return { created: 0, total: tasks.length, error: err.message }
  }

  const results = await Promise.allSettled(
    tasks.map((row) => {
      const properties = {}
      for (const [name, value] of Object.entries(row)) {
        const prop = schema[name]
        if (!prop) continue // свойства с таким именем нет в базе — пропускаем
        const built = valueForType(prop, value)
        if (built) properties[name] = built
      }

      return fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parent: { database_id: tasksDbId }, properties }),
      }).then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => null)
          const msg = d?.message || `Ошибка Notion (${r.status})`
          console.error('task row error:', r.status, d?.code, d?.message)
          throw new Error(msg)
        }
        return true
      })
    }),
  )

  const created = results.filter((r) => r.status === 'fulfilled').length
  const firstError = results.find((r) => r.status === 'rejected')?.reason?.message || null
  return { created, total: tasks.length, error: created < tasks.length ? firstError : null }
}


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Метод не поддерживается. Используйте POST.' })
  }

  const token = process.env.NOTION_TOKEN
  const databaseId = process.env.NOTION_DATABASE_ID
  if (!token || !databaseId) {
    return res.status(500).json({
      error:
        'Notion не настроен. Добавьте NOTION_TOKEN и NOTION_DATABASE_ID в переменные окружения Vercel.',
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

  const тема = String(p.тема ?? '').trim() || 'Протокол совещания'
  const дата = typeof p.дата === 'string' ? p.дата.trim() : ''
  const участники = asStringArray(p.участники)
  const задачи = Array.isArray(p.задачи) ? p.задачи : []

  // Свойства страницы. Title-свойство в базе должно называться "Тема".
  const properties = {
    Тема: { title: [{ type: 'text', text: { content: text(тема) } }] },
  }
  // Свойство "Дата" ставим только при строгом формате YYYY-MM-DD.
  const hasValidDate = ISO_DATE.test(дата)
  if (hasValidDate) {
    properties['Дата'] = { date: { start: дата } }
  }

  // Тело страницы.
  const children = []

  // Если даты нет в свойстве — выносим её (или участников) текстом в тело.
  const metaParts = []
  if (!hasValidDate && дата) metaParts.push(`Дата: ${дата}`)
  if (участники.length) metaParts.push(`Участники: ${участники.join(', ')}`)
  if (metaParts.length) children.push(paragraph(metaParts.join('  •  ')))

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
      const задача = String(t?.задача ?? '').trim()
      if (!задача) return
      const ответственный = String(t?.ответственный ?? 'не указан').trim() || 'не указан'
      const срок = String(t?.срок ?? 'не указан').trim() || 'не указан'
      const приоритет = String(t?.приоритет ?? 'средний').trim() || 'средний'
      children.push(bullet(`${задача} — ${ответственный}, ${срок} (${приоритет})`))
    })
  }

  children.push(heading('Важные детали'))
  children.push(...listBlocks(asStringArray(p.важные_детали)))

  children.push(heading('Открытые вопросы'))
  children.push(...listBlocks(asStringArray(p.открытые_вопросы)))

  children.push(heading('Следующая встреча'))
  const следующая = typeof p.следующая_встреча === 'string' ? p.следующая_встреча.trim() : ''
  children.push(paragraph(следующая || 'не запланирована'))

  try {
    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
        // Notion принимает максимум 100 блоков children за один запрос.
        children: children.slice(0, 100),
      }),
    })

    const data = await notionRes.json().catch(() => null)

    if (!notionRes.ok) {
      const code = data?.code
      const map = {
        unauthorized: 'Неверный NOTION_TOKEN или у интеграции нет доступа к базе.',
        object_not_found:
          'База Notion не найдена. Проверьте NOTION_DATABASE_ID и доступ интеграции к базе.',
        validation_error:
          'Notion отклонил данные. Проверьте, что в базе есть title-свойство «Тема» (и «Дата» типа date).',
        restricted_resource: 'У интеграции нет прав на эту базу Notion.',
      }
      const message =
        map[code] ||
        data?.message ||
        `Ошибка Notion (${notionRes.status}). Попробуйте ещё раз.`
      console.error('notion error:', notionRes.status, code, data?.message)
      return res.status(notionRes.status >= 400 && notionRes.status < 600 ? notionRes.status : 502).json({
        error: message,
      })
    }

    // Помимо страницы совещания — строки в базе «Задачи» (если она задана).
    const tasksDbId = process.env.NOTION_TASKS_DB_ID
    let tasks = { configured: false, created: 0, total: задачи.length, error: null }
    if (tasksDbId) {
      const meetingRef = дата ? `${тема} — ${дата}` : тема
      const result = await createTaskRows(token, tasksDbId, задачи, meetingRef)
      tasks = { configured: true, ...result }
    }

    return res.status(200).json({
      url: data?.url || null,
      id: data?.id || null,
      tasks,
    })
  } catch (err) {
    console.error('save-to-notion error:', err?.message || err)
    return res.status(502).json({ error: 'Не удалось связаться с Notion. Попробуйте позже.' })
  }
}
