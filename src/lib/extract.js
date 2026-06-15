// Клиентский вызов serverless-функции /api/extract.
// Ключ Anthropic живёт только на сервере — здесь его нет.

export async function extractProtocol(transcript) {
  let res
  try {
    res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
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
  if (!data?.protocol) {
    throw new Error('Сервер вернул неожиданный ответ.')
  }
  return data.protocol
}
