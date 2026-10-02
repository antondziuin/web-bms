# web-bms

Монитор аккумулятора для BMS **JK** и **JBD** (Xiaoxiang) через **Web Bluetooth** — одна статическая страница, без сборки.

**Онлайн:** https://antondziuin.github.io/web-bms/

## Возможности

- Напряжение, ток, мощность, SOC, остаток ёмкости, время до заряда/разряда
- Напряжения ячеек (до 32), подсветка самой низкой/высокой, разбаланс в mV
- Температуры (T1/T2/MOS), балансировка, ошибки BMS, число циклов
- График мощности (последние 1000 точек)
- Автоподключение к последнему устройству и автоматическое переподключение при обрыве связи
- Опционально: удержание экрана включённым

## Требования

- Chrome / Edge (desktop или Android). Firefox и Safari Web Bluetooth не поддерживают;
  на iOS можно использовать браузер Bluefy.
- HTTPS (GitHub Pages) или `http://localhost`.

## Локальный запуск

```sh
npx http-server -p 8080 .
# открыть http://localhost:8080
```

## Публикация на GitHub Pages

Деплой выполняется workflow `.github/workflows/pages.yml` при каждом push в `main`
(или вручную: *Actions → Deploy to GitHub Pages → Run workflow*).

Один раз нужно включить Pages: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
