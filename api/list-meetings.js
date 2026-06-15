// Serverless-функция Vercel: список сохранённых встреч из базы Notion.
// Читает NOTION_TOKEN и NOTION_DATABASE_ID из окружения.

const NOTION_VERSION = '2022-06-28'
const PAGE_SIZE = 50

// Достаёт текст из title-свойства "Тема".
function readTitle(props) {
  const prop = props?.['Тема']
  if (prop?.type === 'title' && Array.isArray(prop.title)) {
    const text = prop.title.map((t) => t?.plain_text ?? '').join('').trim()
    if (text) return text
  }
  return 'Без названия'
}

// Достаёт дату: сначала свойство "Дата" (date), иначе дата создания страницы.
function readDate(props, createdTime) {
  const prop = props?.['Дата']
  if (prop?.type === 'date' && prop.date?.start) {
    return prop.date.start
  }
  return createdTime || null
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Метод не поддерживается.' })
  }

  const token = process.env.NOTION_TOKEN
  const databaseId = process.env.NOTION_DATABASE_ID
  if (!token || !databaseId) {
    return res.status(500).json({
      error:
        'Notion не настроен. Добавьте NOTION_TOKEN и NOTION_DATABASE_ID в переменные окружения Vercel.',
    })
  }

  try {
    const notionRes = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page_size: PAGE_SIZE,
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        }),
      },
    )

    const data = await notionRes.json().catch(() => null)

    if (!notionRes.ok) {
      const code = data?.code
      const map = {
        unauthorized: 'Неверный NOTION_TOKEN или у интеграции нет доступа к базе.',
        object_not_found:
          'База Notion не найдена. Проверьте NOTION_DATABASE_ID и доступ интеграции к базе.',
        restricted_resource: 'У интеграции нет прав на эту базу Notion.',
      }
      const message =
        map[code] || data?.message || `Ошибка Notion (${notionRes.status}).`
      console.error('list-meetings error:', notionRes.status, code, data?.message)
      return res
        .status(notionRes.status >= 400 && notionRes.status < 600 ? notionRes.status : 502)
        .json({ error: message })
    }

    const results = Array.isArray(data?.results) ? data.results : []
    const meetings = results
      .filter((page) => page?.object === 'page')
      .map((page) => ({
        id: page.id,
        тема: readTitle(page.properties),
        дата: readDate(page.properties, page.created_time),
        url: page.url || null,
      }))

    return res.status(200).json({ meetings })
  } catch (err) {
    console.error('list-meetings error:', err?.message || err)
    return res.status(502).json({ error: 'Не удалось связаться с Notion. Попробуйте позже.' })
  }
}
