// Экспорт протокола в Word (.doc через Blob) и текстовое саммари для копирования.

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function liList(items) {
  if (!items || items.length === 0) return '<p style="color:#888">— нет —</p>'
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
}

// Собираем самодостаточный HTML, который Word открывает как документ.
export function buildDocHtml(p) {
  const tasksRows =
    p.задачи && p.задачи.length
      ? p.задачи
          .map(
            (t, i) => `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${esc(t.задача)}</td>
        <td>${esc(t.ответственный)}</td>
        <td>${esc(t.срок)}</td>
        <td>${esc(t.приоритет)}</td>
        <td>${esc(t.статус)}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="6" style="color:#888">— задач нет —</td></tr>`

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Протокол — ${esc(p.тема || 'совещание')}</title>
<style>
  body { font-family: 'Calibri', sans-serif; color:#1c1c1e; font-size:11pt; line-height:1.5; }
  h1 { font-size:20pt; margin:0 0 4pt; }
  h2 { font-size:12pt; color:#c8862a; text-transform:uppercase; letter-spacing:1px; margin:18pt 0 6pt; border-bottom:1px solid #d8d2c4; padding-bottom:3pt; }
  .meta { font-size:10pt; color:#555; margin-bottom:10pt; }
  table { border-collapse:collapse; width:100%; font-size:10pt; }
  th, td { border:1px solid #c4bdac; padding:6pt 8pt; text-align:left; vertical-align:top; }
  th { background:#f1ede3; }
  ul { margin:0; padding-left:18pt; }
  li { margin-bottom:3pt; }
</style>
</head>
<body>
  <h1>${esc(p.тема || 'Протокол совещания')}</h1>
  <div class="meta">
    Дата: ${esc(p.дата || 'не указана')}${
      p.участники && p.участники.length
        ? ' &nbsp;•&nbsp; Участники: ' + esc(p.участники.join(', '))
        : ''
    }
  </div>

  <h2>Краткое резюме</h2>
  <p>${esc(p.краткое_резюме || '—')}</p>

  <h2>Цели встречи</h2>
  ${liList(p.цели_встречи)}

  <h2>Ключевые решения</h2>
  ${liList(p.ключевые_решения)}

  <h2>Задачи</h2>
  <table>
    <thead>
      <tr><th>№</th><th>Задача</th><th>Ответственный</th><th>Срок</th><th>Приоритет</th><th>Статус</th></tr>
    </thead>
    <tbody>${tasksRows}</tbody>
  </table>

  <h2>Важные детали</h2>
  ${liList(p.важные_детали)}

  <h2>Открытые вопросы</h2>
  ${liList(p.открытые_вопросы)}

  <h2>Следующая встреча</h2>
  <p>${esc(p.следующая_встреча || 'не запланирована')}</p>
</body>
</html>`
}

function slugify(text) {
  return (
    String(text || 'protokol')
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'protokol'
  )
}

export function downloadDoc(protocol) {
  const html = buildDocHtml(protocol)
  const blob = new Blob(['﻿', html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `protokol-${slugify(protocol.тема)}.doc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Текстовое саммари для буфера обмена.
export function buildSummaryText(p) {
  const lines = []
  const block = (title, items) => {
    lines.push('', title.toUpperCase())
    if (!items || items.length === 0) {
      lines.push('  — нет —')
    } else {
      items.forEach((i) => lines.push(`  • ${i}`))
    }
  }

  lines.push(`ПРОТОКОЛ: ${p.тема || 'совещание'}`)
  lines.push(`Дата: ${p.дата || 'не указана'}`)
  if (p.участники?.length) lines.push(`Участники: ${p.участники.join(', ')}`)

  lines.push('', 'КРАТКОЕ РЕЗЮМЕ', `  ${p.краткое_резюме || '—'}`)
  block('Цели встречи', p.цели_встречи)
  block('Ключевые решения', p.ключевые_решения)

  lines.push('', 'ЗАДАЧИ')
  if (!p.задачи?.length) {
    lines.push('  — нет —')
  } else {
    p.задачи.forEach((t, i) => {
      lines.push(
        `  ${i + 1}. ${t.задача}`,
        `     ответственный: ${t.ответственный} | срок: ${t.срок} | приоритет: ${t.приоритет} | статус: ${t.статус}`,
      )
    })
  }

  block('Важные детали', p.важные_детали)
  block('Открытые вопросы', p.открытые_вопросы)
  lines.push('', 'СЛЕДУЮЩАЯ ВСТРЕЧА', `  ${p.следующая_встреча || 'не запланирована'}`)

  return lines.join('\n')
}

export async function copySummary(protocol) {
  const text = buildSummaryText(protocol)
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Фолбэк для старых браузеров.
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}
