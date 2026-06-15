const FLOW = [
  { n: '01', title: 'Запись / вставка', desc: 'Микрофон в браузере или готовый текст' },
  { n: '02', title: 'Расшифровка', desc: 'Речь → текст, бесплатно и локально' },
  { n: '03', title: 'ИИ-саммари', desc: 'Структурированный JSON по схеме' },
  { n: '04', title: 'Протокол', desc: 'Страница · Word · задачи в Notion' },
]

const SCHEMA_FIELDS = [
  'тема',
  'дата',
  'участники[]',
  'краткое_резюме',
  'цели_встречи[]',
  'ключевые_решения[]',
  'задачи[]',
  'важные_детали[]',
  'открытые_вопросы[]',
  'следующая_встреча',
]

import MeetingHistory from './MeetingHistory.jsx'

export default function Landing({ onStart }) {
  return (
    <section className="landing">
      <div className="landing__hero">
        <span className="eyebrow">ИИ-секретарь совещаний</span>
        <h1>
          Совещание закончилось — <em>протокол готов.</em>
        </h1>
        <p className="landing__lead">
          Запишите встречу или вставьте текст. ИИ соберёт суть, решения и задачи
          с ответственными и сроками — в виде точного реестра, который можно
          скачать в Word.
        </p>
        <div className="landing__cta">
          <button className="btn btn--accent btn--lg" onClick={onStart}>
            ● Начать запись
          </button>
          <button className="btn btn--ghost btn--lg" onClick={onStart}>
            Вставить текст
          </button>
        </div>
      </div>

      <div className="landing__flow">
        {FLOW.map((step) => (
          <div className="flow-step" key={step.n}>
            <span className="flow-step__num">{step.n}</span>
            <span className="flow-step__title">{step.title}</span>
            <span className="flow-step__desc">{step.desc}</span>
          </div>
        ))}
      </div>

      <div className="landing__schema">
        <h3>Что извлекаем из встречи</h3>
        <div className="chip-row">
          {SCHEMA_FIELDS.map((f) => (
            <span className="chip" key={f}>
              {f}
            </span>
          ))}
        </div>
      </div>

      <MeetingHistory />
    </section>
  )
}
