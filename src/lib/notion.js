// Клиентский вызов serverless-функции /api/save-to-notion.
// Токены Notion живут только на сервере — здесь их нет.

export async function saveToNotion(protocol) {
  let res
  try {
    res = await fetch('/api/save-to-notion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(protocol),
    })
  } catch {
    throw new Error('Нет связи с сервером. Проверьте подключение к интернету.')
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    /* тело не JSON */
  }

  if (!res.ok) {
    throw new Error(data?.error || `Ошибка сервера (${res.status}).`)
  }
  return data?.url || null
}

// Список сохранённых встреч из Notion (для «Истории встреч» на лендинге).
export async function listMeetings() {
  let res
  try {
    res = await fetch('/api/list-meetings')
  } catch {
    throw new Error('Нет связи с сервером. Проверьте подключение к интернету.')
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    /* тело не JSON */
  }

  if (!res.ok) {
    throw new Error(data?.error || `Ошибка сервера (${res.status}).`)
  }
  return Array.isArray(data?.meetings) ? data.meetings : []
}
