/* i18n: dictionaries and t(). Язык выбирается по navigator.languages; можно переопределить в «Деталях».
   Добавить язык = добавить словарь. */
import { storageGet, storageSet } from './util.js';

const STORAGE_KEY = 'ui:lang';
export const LANG_NAMES = { en:'English', ru:'Русский', uk:'Українська' };
const LANG_ALIASES = { be:'ru', kk:'ru', ky:'ru' }; // why: русскоязычным пользователям этих локалей привычнее ru, чем en
export const I18N = {
  en: {
    'meta.description':'BMS monitor for JK / JBD via Web Bluetooth: voltage, current, SOC, cells, charts.',
    'btn.connect':'Connect', 'btn.disconnect':'Disconnect', 'btn.connecting':'Connecting…',
    'btn.btTitle':'Bluetooth: connect / disconnect',
    'gauge.label':'charge', 'gauge.aria':'State of charge {soc}%', 'gauge.ariaUnknown':'State of charge unknown',
    'flow.charge':'Charging', 'flow.discharge':'Discharging', 'flow.idle':'Idle', 'flow.none':'No data',
    'eta.discharge':'Until empty', 'eta.charge':'Until full', 'eta.none':'Time', 'eta.idle':'stopped', 'eta.charging':'charging',
    'unit.h':'h', 'unit.m':'m',
    'tile.voltage':'Voltage', 'tile.current':'Current', 'tile.remaining':'Remaining', 'tile.capOf':'of {cap} Ah',
    'cap.estimate':'(estimate)', 'tile.imbalance':'Cell imbalance', 'tile.temp':'Temperature', 'tile.tempMax':'(max)',
    'tile.cycles':'Cycles', 'cycles.total':'≈ {ah} Ah total',
    'chip.balOn':'Balancing on', 'chip.balOff':'Balancing off', 'chip.noErrors':'No errors',
    'tab.cells':'Cells', 'tab.chart':'Chart', 'tab.details':'Details',
    'cells.emptyTitle':'No cell data', 'cells.emptyText':'Connect to a JK or JBD BMS via Bluetooth.',
    'cells.min':'Min', 'cells.avg':'Avg', 'cells.max':'Max', 'cells.sum':'Σ cells', 'cells.aria':'Cell voltages',
    'chart.metricAria':'Chart metric', 'chart.aria':'Chart', 'chart.now':'Now:', 'chart.noData':'No data',
    'metric.w':'Power', 'metric.i':'Current', 'metric.v':'Voltage', 'metric.soc':'SOC',
    'det.device':'Device', 'det.name':'Name', 'det.protocol':'Protocol', 'det.model':'Model', 'det.capacity':'Capacity',
    'det.data':'Data', 'det.notConnected':'not connected', 'det.fresh':'pack {pack}, cells {cells}',
    'det.settings':'Settings', 'det.language':'Language', 'det.langAuto':'Automatic ({lang})',
    'det.wake':'Keep screen on', 'det.wakeSub':'On phones BLE often drops when the screen turns off',
    'det.raw':'Raw data', 'det.copy':'Copy', 'det.copied':'Copied', 'det.copyFailed':'Failed',
    'ago.now':'just now', 'ago.s':'{n} s ago', 'ago.min':'{n} min ago', 'ago.h':'{n} h ago',
    'dlg.title':'Connect JK / JBD',
    'dlg.text':'Pick your BMS in the system dialog. If asked for a PIN, it is usually 123456. Web Bluetooth cannot scan in the background — only the system device picker.',
    'dlg.choose':'Choose device…', 'dlg.recent':'Recent', 'dlg.close':'Close',
    'picker.failed':'Could not connect: {msg}', 'picker.noRecentSupport':'This browser does not support quick access to recent devices.',
    'picker.noRecent':'No recent devices', 'picker.unnamed':'(unnamed)', 'picker.opening':'Opening the system picker…',
    'picker.cancelled':'Cancelled', 'picker.needClick':'Click “Choose device…”',
    'picker.autoFailed':'Auto-connect to {name} failed: {msg}', 'picker.hint':'Press “Choose device…” (the browser requires a user gesture).',
    'status.idle':'Not connected', 'status.disconnected':'Disconnected', 'status.noLink':'No connection to the BMS',
    'status.retry':'Connection lost — retrying in {s} s ({n}/{max})', 'status.connecting':'Connecting to {name}…',
    'status.connected':'{name} · {kind}', 'status.error':'Error: {msg}', 'status.btOff':'Bluetooth unavailable (adapter off?)',
    'status.unsupported':'Web Bluetooth is not supported — use Chrome / Edge', 'status.needHttps':'Web Bluetooth requires HTTPS',
    'btn.add':'Add', 'bat.all':'All', 'status.multi':'{n} of {total} connected', 'unit.s':'s',
    'tab.session':'Session', 'det.disconnectAll':'Disconnect all', 'det.allName':'All batteries ({n})',
    'ov.offline':'no link', 'ov.connecting':'connecting…',
    'ses.energy':'Energy', 'ses.extremes':'Extremes', 'ses.duration':'Duration', 'ses.since':'since {time}',
    'ses.charged':'Charged', 'ses.discharged':'Discharged', 'ses.net':'Net', 'ses.peakChg':'Peak charge', 'ses.peakDis':'Peak discharge',
    'ses.packV':'Pack voltage min / max', 'ses.cellV':'Cell min / max', 'ses.soc':'SOC start → now', 'ses.tMax':'Max temperature',
    'ses.deltaMax':'Max imbalance', 'ses.reset':'Reset', 'ses.empty':'Session counters start once a BMS is connected.',
    'ses.allNote':'Totals for all connected batteries.',
    'off.title':'Work offline', 'off.text':'Save the app on this device so it opens without a network — handy in a garage or at the cottage.',
    'off.enable':'Enable', 'off.later':'Not now', 'off.ready':'Done — the app now works offline.', 'off.install':'Install app',
    'off.failed':'Could not enable offline mode: {msg}', 'off.settingSub':'Keeps a copy of the app on this device',
    'off.installSub':'Add to the home screen or desktop',
    'err.noServices':'No supported services found', 'err.timeout':'Connection timeout',
  },
  ru: {
    'meta.description':'Монитор BMS JK / JBD через Web Bluetooth: напряжение, ток, SOC, ячейки, графики.',
    'btn.connect':'Подключить', 'btn.disconnect':'Отключить', 'btn.connecting':'Подключение…',
    'btn.btTitle':'Bluetooth: подключить / отключить',
    'gauge.label':'заряд', 'gauge.aria':'Уровень заряда {soc}%', 'gauge.ariaUnknown':'Уровень заряда неизвестен',
    'flow.charge':'Заряд', 'flow.discharge':'Разряд', 'flow.idle':'Ожидание', 'flow.none':'Нет данных',
    'eta.discharge':'До разряда', 'eta.charge':'До заряда', 'eta.none':'Время', 'eta.idle':'стоп', 'eta.charging':'заряд',
    'unit.h':'ч', 'unit.m':'м',
    'tile.voltage':'Напряжение', 'tile.current':'Ток', 'tile.remaining':'Остаток', 'tile.capOf':'из {cap} Ah',
    'cap.estimate':'(оценка)', 'tile.imbalance':'Разбаланс ячеек', 'tile.temp':'Температура', 'tile.tempMax':'(макс.)',
    'tile.cycles':'Циклы', 'cycles.total':'≈ {ah} Ah всего',
    'chip.balOn':'Балансировка вкл.', 'chip.balOff':'Балансировка выкл.', 'chip.noErrors':'Ошибок нет',
    'tab.cells':'Ячейки', 'tab.chart':'График', 'tab.details':'Детали',
    'cells.emptyTitle':'Нет данных по ячейкам', 'cells.emptyText':'Подключитесь к BMS JK или JBD по Bluetooth.',
    'cells.min':'Мин', 'cells.avg':'Сред', 'cells.max':'Макс', 'cells.sum':'Σ ячеек', 'cells.aria':'Поклеточные напряжения',
    'chart.metricAria':'Показатель графика', 'chart.aria':'График', 'chart.now':'Сейчас:', 'chart.noData':'Нет данных',
    'metric.w':'Мощность', 'metric.i':'Ток', 'metric.v':'Напряжение', 'metric.soc':'SOC',
    'det.device':'Устройство', 'det.name':'Имя', 'det.protocol':'Протокол', 'det.model':'Модель', 'det.capacity':'Ёмкость',
    'det.data':'Данные', 'det.notConnected':'не подключено', 'det.fresh':'пакет {pack}, ячейки {cells}',
    'det.settings':'Настройки', 'det.language':'Язык', 'det.langAuto':'Автоматически ({lang})',
    'det.wake':'Не гасить экран', 'det.wakeSub':'На телефоне BLE часто рвётся, когда экран выключается',
    'det.raw':'Сырые данные', 'det.copy':'Копировать', 'det.copied':'Скопировано', 'det.copyFailed':'Не удалось',
    'ago.now':'только что', 'ago.s':'{n} с назад', 'ago.min':'{n} мин назад', 'ago.h':'{n} ч назад',
    'dlg.title':'Подключение JK / JBD',
    'dlg.text':'Выберите BMS в системном окне. PIN, если спросят, обычно 123456. Web Bluetooth не умеет фоновое сканирование — только системный выбор устройства.',
    'dlg.choose':'Выбрать устройство…', 'dlg.recent':'Недавние', 'dlg.close':'Закрыть',
    'picker.failed':'Не удалось подключиться: {msg}', 'picker.noRecentSupport':'Браузер не поддерживает быстрый доступ к недавним.',
    'picker.noRecent':'Недавних устройств нет', 'picker.unnamed':'(без имени)', 'picker.opening':'Открытие системного выбора…',
    'picker.cancelled':'Отменено', 'picker.needClick':'Требуется клик по кнопке «Выбрать устройство…»',
    'picker.autoFailed':'Автоподключение к {name} не удалось: {msg}', 'picker.hint':'Нажмите «Выбрать устройство…» (браузеру нужен пользовательский жест).',
    'status.idle':'Не подключено', 'status.disconnected':'Отключено', 'status.noLink':'Нет связи с BMS',
    'status.retry':'Связь потеряна — повтор через {s} с ({n}/{max})', 'status.connecting':'Подключение к {name}…',
    'status.connected':'{name} · {kind}', 'status.error':'Ошибка: {msg}', 'status.btOff':'Bluetooth недоступен (адаптер выключен?)',
    'status.unsupported':'Web Bluetooth не поддерживается — нужен Chrome / Edge', 'status.needHttps':'Web Bluetooth требует HTTPS',
    'btn.add':'Добавить', 'bat.all':'Все', 'status.multi':'{n} из {total} на связи', 'unit.s':'с',
    'tab.session':'Сессия', 'det.disconnectAll':'Отключить все', 'det.allName':'Все батареи ({n})',
    'ov.offline':'нет связи', 'ov.connecting':'подключение…',
    'ses.energy':'Энергия', 'ses.extremes':'Экстремумы', 'ses.duration':'Длительность', 'ses.since':'с {time}',
    'ses.charged':'Заряжено', 'ses.discharged':'Разряжено', 'ses.net':'Баланс', 'ses.peakChg':'Пик заряда', 'ses.peakDis':'Пик разряда',
    'ses.packV':'Напряжение мин / макс', 'ses.cellV':'Ячейка мин / макс', 'ses.soc':'SOC начало → сейчас', 'ses.tMax':'Макс. температура',
    'ses.deltaMax':'Макс. разбаланс', 'ses.reset':'Сбросить', 'ses.empty':'Счётчики сессии начнутся после подключения BMS.',
    'ses.allNote':'Суммарно по всем подключённым батареям.',
    'off.title':'Работа без интернета', 'off.text':'Сохранить приложение на устройстве, чтобы оно открывалось без сети — удобно в гараже или на даче.',
    'off.enable':'Включить', 'off.later':'Не сейчас', 'off.ready':'Готово — приложение работает без интернета.', 'off.install':'Установить приложение',
    'off.failed':'Не удалось включить работу без интернета: {msg}', 'off.settingSub':'Хранит копию приложения на устройстве',
    'off.installSub':'Добавить на главный экран или рабочий стол',
    'err.noServices':'Поддерживаемые сервисы не найдены', 'err.timeout':'Таймаут подключения',
  },
  uk: {
    'meta.description':'Монітор BMS JK / JBD через Web Bluetooth: напруга, струм, SOC, комірки, графіки.',
    'btn.connect':'Підключити', 'btn.disconnect':'Відключити', 'btn.connecting':'Підключення…',
    'btn.btTitle':'Bluetooth: підключити / відключити',
    'gauge.label':'заряд', 'gauge.aria':'Рівень заряду {soc}%', 'gauge.ariaUnknown':'Рівень заряду невідомий',
    'flow.charge':'Заряд', 'flow.discharge':'Розряд', 'flow.idle':'Очікування', 'flow.none':'Немає даних',
    'eta.discharge':'До розряду', 'eta.charge':'До заряду', 'eta.none':'Час', 'eta.idle':'стоп', 'eta.charging':'заряд',
    'unit.h':'год', 'unit.m':'хв',
    'tile.voltage':'Напруга', 'tile.current':'Струм', 'tile.remaining':'Залишок', 'tile.capOf':'з {cap} Ah',
    'cap.estimate':'(оцінка)', 'tile.imbalance':'Розбаланс комірок', 'tile.temp':'Температура', 'tile.tempMax':'(макс.)',
    'tile.cycles':'Цикли', 'cycles.total':'≈ {ah} Ah загалом',
    'chip.balOn':'Балансування увімк.', 'chip.balOff':'Балансування вимк.', 'chip.noErrors':'Помилок немає',
    'tab.cells':'Комірки', 'tab.chart':'Графік', 'tab.details':'Деталі',
    'cells.emptyTitle':'Немає даних по комірках', 'cells.emptyText':'Підключіться до BMS JK або JBD через Bluetooth.',
    'cells.min':'Мін', 'cells.avg':'Сер', 'cells.max':'Макс', 'cells.sum':'Σ комірок', 'cells.aria':'Напруги комірок',
    'chart.metricAria':'Показник графіка', 'chart.aria':'Графік', 'chart.now':'Зараз:', 'chart.noData':'Немає даних',
    'metric.w':'Потужність', 'metric.i':'Струм', 'metric.v':'Напруга', 'metric.soc':'SOC',
    'det.device':'Пристрій', 'det.name':'Ім’я', 'det.protocol':'Протокол', 'det.model':'Модель', 'det.capacity':'Ємність',
    'det.data':'Дані', 'det.notConnected':'не підключено', 'det.fresh':'пакет {pack}, комірки {cells}',
    'det.settings':'Налаштування', 'det.language':'Мова', 'det.langAuto':'Автоматично ({lang})',
    'det.wake':'Не вимикати екран', 'det.wakeSub':'На телефоні BLE часто обривається, коли екран вимикається',
    'det.raw':'Сирі дані', 'det.copy':'Копіювати', 'det.copied':'Скопійовано', 'det.copyFailed':'Не вдалося',
    'ago.now':'щойно', 'ago.s':'{n} с тому', 'ago.min':'{n} хв тому', 'ago.h':'{n} год тому',
    'dlg.title':'Підключення JK / JBD',
    'dlg.text':'Оберіть BMS у системному вікні. PIN, якщо запитають, зазвичай 123456. Web Bluetooth не вміє фонове сканування — лише системний вибір пристрою.',
    'dlg.choose':'Обрати пристрій…', 'dlg.recent':'Недавні', 'dlg.close':'Закрити',
    'picker.failed':'Не вдалося підключитися: {msg}', 'picker.noRecentSupport':'Браузер не підтримує швидкий доступ до недавніх.',
    'picker.noRecent':'Недавніх пристроїв немає', 'picker.unnamed':'(без імені)', 'picker.opening':'Відкриття системного вибору…',
    'picker.cancelled':'Скасовано', 'picker.needClick':'Потрібно натиснути «Обрати пристрій…»',
    'picker.autoFailed':'Автопідключення до {name} не вдалося: {msg}', 'picker.hint':'Натисніть «Обрати пристрій…» (браузеру потрібна дія користувача).',
    'status.idle':'Не підключено', 'status.disconnected':'Відключено', 'status.noLink':'Немає зв’язку з BMS',
    'status.retry':'Зв’язок втрачено — повтор через {s} с ({n}/{max})', 'status.connecting':'Підключення до {name}…',
    'status.connected':'{name} · {kind}', 'status.error':'Помилка: {msg}', 'status.btOff':'Bluetooth недоступний (адаптер вимкнено?)',
    'status.unsupported':'Web Bluetooth не підтримується — потрібен Chrome / Edge', 'status.needHttps':'Web Bluetooth потребує HTTPS',
    'btn.add':'Додати', 'bat.all':'Усі', 'status.multi':'{n} з {total} на зв’язку', 'unit.s':'с',
    'tab.session':'Сесія', 'det.disconnectAll':'Відключити всі', 'det.allName':'Усі батареї ({n})',
    'ov.offline':'немає зв’язку', 'ov.connecting':'підключення…',
    'ses.energy':'Енергія', 'ses.extremes':'Екстремуми', 'ses.duration':'Тривалість', 'ses.since':'з {time}',
    'ses.charged':'Заряджено', 'ses.discharged':'Розряджено', 'ses.net':'Баланс', 'ses.peakChg':'Пік заряду', 'ses.peakDis':'Пік розряду',
    'ses.packV':'Напруга мін / макс', 'ses.cellV':'Комірка мін / макс', 'ses.soc':'SOC початок → зараз', 'ses.tMax':'Макс. температура',
    'ses.deltaMax':'Макс. розбаланс', 'ses.reset':'Скинути', 'ses.empty':'Лічильники сесії почнуться після підключення BMS.',
    'ses.allNote':'Сумарно по всіх підключених батареях.',
    'off.title':'Робота без інтернету', 'off.text':'Зберегти застосунок на пристрої, щоб він відкривався без мережі — зручно в гаражі чи на дачі.',
    'off.enable':'Увімкнути', 'off.later':'Не зараз', 'off.ready':'Готово — застосунок працює без інтернету.', 'off.install':'Встановити застосунок',
    'off.failed':'Не вдалося увімкнути роботу без інтернету: {msg}', 'off.settingSub':'Зберігає копію застосунку на пристрої',
    'off.installSub':'Додати на головний екран або робочий стіл',
    'err.noServices':'Підтримувані сервіси не знайдено', 'err.timeout':'Тайм-аут підключення',
  },
};

export function detectLang(){
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const list = (nav.languages && nav.languages.length) ? nav.languages : [nav.language || 'en'];
  for (const l of list){
    const base = String(l).toLowerCase().split(/[-_]/)[0];
    if (I18N[base]) return base;
    if (LANG_ALIASES[base]) return LANG_ALIASES[base];
  }
  return 'en';
}

let langPref = storageGet(STORAGE_KEY, 'auto');
if (langPref !== 'auto' && !I18N[langPref]) langPref = 'auto';
let LANG = langPref === 'auto' ? detectLang() : langPref;

export function getLang(){ return LANG; }
export function getLangPref(){ return langPref; }
/* pref: 'auto' | language code. Persisted. */
export function setLangPref(pref){
  langPref = I18N[pref] ? pref : 'auto';
  storageSet(STORAGE_KEY, langPref);
  LANG = langPref === 'auto' ? detectLang() : langPref;
}
/* Re-detect after the browser's languagechange event. */
export function refreshAutoLang(){ if (langPref === 'auto') LANG = detectLang(); }

export function t(key, params){
  const s = I18N[LANG]?.[key] ?? I18N.en[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k)=> k in params ? String(params[k]) : m) : s;
}

/* Translates static markup: data-i18n (text), data-i18n-title, data-i18n-aria (aria-label). */
export function applyStaticI18n(root = document){
  document.documentElement.lang = LANG;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
}
