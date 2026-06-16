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
  return {
    url: data?.url || null,
    tasks: data?.tasks || { configured: false, created: 0, total: 0, error: null },
  }
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

// Рассылка задач ответственным в Telegram. Возвращает { sent, recipients }.
export async function notifyTelegram(protocol) {
  let res
  try {
    res = await fetch('/api/notify-telegram', {
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
  return {
    sent: data?.sent || 0,
    recipients: Array.isArray(data?.recipients) ? data.recipients : [],
    skipped: Array.isArray(data?.skipped) ? data.skipped : [],
  }
}
