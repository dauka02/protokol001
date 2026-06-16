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

const PRIORITIES = ['высокий', 'средний', 'низкий']

// Создаёт по строке в базе «Задачи» (NOTION_TASKS_DB_ID) на каждую задачу.
// Возвращает число успешно созданных строк. Не бросает — ошибки логирует.
async function createTaskRows(token, tasksDbId, задачи, meetingRef) {
  if (!Array.isArray(задачи) || задачи.length === 0) return 0

  const results = await Promise.allSettled(
    задачи.map((t) => {
      const задача = String(t?.задача ?? '').trim()
      if (!задача) return Promise.resolve(false)
      const ответственный = String(t?.ответственный ?? 'не указан').trim() || 'не указан'
      const срок = String(t?.срок ?? 'не указан').trim() || 'не указан'
      let приоритет = String(t?.приоритет ?? '').trim().toLowerCase()
      if (!PRIORITIES.includes(приоритет)) приоритет = 'средний'

      const richText = (content) => ({
        rich_text: [{ type: 'text', text: { content: text(content) } }],
      })

      const properties = {
        Задача: { title: [{ type: 'text', text: { content: text(задача) } }] },
        Ответственный: richText(ответственный),
        Срок: richText(срок),
        Приоритет: { select: { name: приоритет } },
        Статус: { select: { name: 'Новая' } },
        Совещание: richText(meetingRef),
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
          console.error('task row error:', r.status, d?.code, d?.message)
          return false
        }
        return true
      })
    }),
  )

  return results.filter((r) => r.status === 'fulfilled' && r.value === true).length
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
    let tasksCreated = 0
    const tasksDbId = process.env.NOTION_TASKS_DB_ID
    if (tasksDbId) {
      const meetingRef = дата ? `${тема} — ${дата}` : тема
      tasksCreated = await createTaskRows(token, tasksDbId, задачи, meetingRef)
    }

    return res.status(200).json({
      url: data?.url || null,
      id: data?.id || null,
      tasksCreated,
    })
  } catch (err) {
    console.error('save-to-notion error:', err?.message || err)
    return res.status(502).json({ error: 'Не удалось связаться с Notion. Попробуйте позже.' })
  }
}
