// Клиентские вызовы serverless-функций Notion/Telegram.
// Токены живут только на сервере — здесь их нет.

// «Завершить совещание»: сохранить протокол + задачи + рассылка в Telegram.
// Возвращает единый объект результата (см. /api/finish-meeting).
export async function finishMeeting(protocol) {
  let res
  try {
    res = await fetch('/api/finish-meeting', {
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
    meetingSaved: Boolean(data?.meetingSaved),
    meetingUrl: data?.meetingUrl || null,
    meetingError: data?.meetingError || null,
    tasksCreated: data?.tasksCreated || 0,
    tasksError: data?.tasksError || null,
    telegramSent: data?.telegramSent || 0,
    telegramRecipients: Array.isArray(data?.telegramRecipients) ? data.telegramRecipients : [],
    telegramError: data?.telegramError || null,
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
