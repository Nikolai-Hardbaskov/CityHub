/* CityHub — мобильное приложение жителей города для SillyTavern
 * Данные хранятся отдельно для каждого чата (chat metadata),
 * настройки — глобально (extension settings).
 */
(function () {
    'use strict';

    const MODULE = 'cityhub';
    const OLD_MODULE = 'cityhub_legacy'; // перенос данных со старого названия
    const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    const ctx = () => SillyTavern.getContext();

    /* ───────────────────────── журнал ошибок (для телефонов без консоли) ───────────────────────── */
    const LOG = [];
    function logErr(where, ...args) {
        const text = args.map((a) => a instanceof Error ? `${a.message}\n${String(a.stack || '').split('\n').slice(1, 4).join('\n')}`
            : typeof a === 'object' ? (() => { try { return JSON.stringify(a).slice(0, 400); } catch { return String(a); } })() : String(a)).join(' ');
        LOG.unshift({ t: Date.now(), where: String(where).replace('[CityHub]', '').trim(), text });
        if (LOG.length > 60) LOG.length = 60;
        console.warn('[CityHub]', where, ...args);
    }
    window.addEventListener('error', (e) => {
        if (/CityHub|cityhub|CityHub|studyhub/.test(`${e.filename} ${e.error?.stack || ''}`)) logErr('Ошибка скрипта', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', (e) => {
        if (/CityHub|cityhub|CityHub|studyhub/.test(String(e.reason?.stack || ''))) logErr('Необработанная ошибка', e.reason);
    });

    /* ───────────────────────── настройки ───────────────────────── */

    const DEFAULTS = {
        showFab: true,
        inject: true,
        injectDepth: 2,
        theme: 'pearl',         // тема оформления
        shareDMs: true,         // передавать переписку CityHub в основной чат
        timeMode: 'game',       // для новых чатов: game — часы истории, real — реальное время
        syncHorae: true,        // брать время из расширения Horae, если найдено
        syncAI: true,           // ИИ определяет прошедшее время по тексту ответа
        stepMin: 10,            // иначе — столько минут за каждый ответ истории
        chatContext: 10,        // сколько последних сообщений истории видит персонаж в CityHub
        quarterDays: 360,       // вычисляется из yearMonths
        yearMonths: 12,         // длина «года», после которого счётчик правонарушений обнуляется
        crimeScan: true,        // проверять историю на правонарушения
        maxStrikes: 10,         // правонарушений до ограничения свободы
        lowGpa: 10,            // порог низкого среднего балла
        lowGpaDays: 5,         // сколько дней балл может быть низким
        startBalance: 1500,
        stipend: 0,
        stipendMinGpa: 3.5,
        checkInEarlyMin: 10,    // за сколько минут до пары можно отметиться
        deadlineOffsetMin: 5,   // дедлайн — за N минут до следующей пары
        extraTaskHours: 24,
    };

    function cfg() {
        const es = ctx().extensionSettings;
        if (!es[MODULE]) es[MODULE] = es[OLD_MODULE] ? { ...es[OLD_MODULE] } : {};
        for (const [k, v] of Object.entries(DEFAULTS)) if (es[MODULE][k] === undefined) es[MODULE][k] = v;
        return es[MODULE];
    }
    const yearDays = () => Math.max(1, Math.round((Number(cfg().yearMonths) || 12) * 30));
    const saveCfg = () => ctx().saveSettingsDebounced?.();

    /* ───────────────────────── утилиты ───────────────────────── */

    const uid = () => Math.random().toString(36).slice(2, 10);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
    const money = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₡`;
    const fmtT = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const fmtD = (ts) => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const fmtDay = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const pad = (t) => String(t).trim().padStart(5, '0');
    const TIME_RE = /^\d{1,2}:\d{2}$/;
    const dkey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
    function byId(id) {
        const root = document.getElementById('cityhub-phone');
        let el = null;
        if (root && id !== 'cityhub-phone') { try { el = root.querySelector(`#${CSS.escape(id)}`); } catch { el = null; } }
        return el || document.getElementById(id);
    }
    const val = (id) => (byId(id)?.value ?? '').trim();

    function left(ts, base) {
        const d = ts - (base ?? NOW());
        if (d <= 0) return 'срок истёк';
        const m = Math.floor(d / MIN);
        if (m < 60) return `${m} мин`;
        const h = Math.floor(m / 60);
        if (h < 48) return `${h} ч ${m % 60} мин`;
        return `${Math.floor(h / 24)} дн ${h % 24} ч`;
    }
    // приглушённые мягкие тона в гамме приложения
    const AVA_TONES = [['#5e5484', '#7a6fa3'], ['#4d6573', '#6a8593'], ['#6f6350', '#8f8169'], ['#566a5f', '#72887b'], ['#7d5566', '#9a7283'], ['#4f5a75', '#6c7897'], ['#665574', '#846f93'], ['#4b6664', '#678381']];
    function hash(str) { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
    // иконка по виду: от частного к общему
    const SPECIES_ICONS = [
        [/пантер|кош|тигр|лев|ягуар|рыс/i, 'fa-cat'], [/волк|собак|пёс|пес|шакал/i, 'fa-dog'], [/лис|кицунэ|енот|тануки/i, 'fa-paw'],
        [/сов|ворон|гарпи|птиц|тэнгу|грифон/i, 'fa-crow'], [/дракон|василиск|ламия|наг|змея|змей/i, 'fa-dragon'],
        [/призрак|банши|тень|дух|юки/i, 'fa-ghost'], [/лич|зомби|ревенант|мумия|жнец|скелет/i, 'fa-skull'],
        [/вампир|дампир/i, 'fa-droplet'], [/оборот|перевёрт|перевертыш/i, 'fa-moon'],
        [/сирен|русал|тритон|келпи|кракен|селки/i, 'fa-water'], [/кентавр/i, 'fa-horse'],
        [/ангел|нефилим/i, 'fa-dove'], [/демон|бес|ифрит|суккуб|инкуб|óни|они\b|феникс|огн/i, 'fa-fire'],
        [/эльф|дриад|нимф|сатир/i, 'fa-leaf'], [/фейри|пикси/i, 'fa-wand-magic-sparkles'],
        [/ведьм|колдун|маг\b|джинн/i, 'fa-hat-wizard'], [/голем|автоматон|гомункул/i, 'fa-robot'],
        [/элементал|слайм|мимик|химер/i, 'fa-atom'], [/горгон/i, 'fa-eye'],
        [/гоблин|гном|тролль|огр/i, 'fa-hammer'], [/медвед|олен|кролик|бык|минотавр|полулюд/i, 'fa-paw'],
    ];
    const speciesIcon = (sp) => (sp ? (SPECIES_ICONS.find(([re]) => re.test(sp)) || [])[1] : '') || '';
    const ava = (name, big, species) => {
        const [a, b] = AVA_TONES[hash(name) % AVA_TONES.length];
        const ic = speciesIcon(species);
        const inner = ic ? `<i class="fa-solid ${ic}"></i>` : esc(String(name || '?').trim().charAt(0).toUpperCase());
        return `<span class="sh-ava${big ? ' big' : ''}" style="background:linear-gradient(135deg, ${a}, ${b})">${inner}</span>`;
    };
    const badge = (t, cls = '') => t ? `<span class="sh-badge ${cls}">${esc(t)}</span>` : '';
    const empty = (t) => `<div class="sh-empty">${t}</div>`;
    const head = (title, sub = '') => `<div class="sh-head"><button class="sh-icon" data-act="back" aria-label="Назад"><i class="fa-solid fa-chevron-left"></i></button><div><h3>${esc(title)}</h3>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
    const toast = (type, msg) => { try { toastr[type](msg, 'CityHub'); } catch { /* нет toastr */ } };

    /* ───────────────────────── справочники ───────────────────────── */

    const DEFAULT_MENU = [
        { title: 'Кровь II группы, охлаждённая', place: 'Бар «Ночная смена»', price: 180, tags: ['кровь'] },
        { title: 'Стейк с кровью XXL', place: 'Столовая №1', price: 220, tags: ['мясо', 'сырое'] },
        { title: 'Боул с лунными травами', place: 'Кафе «Фея»', price: 150, tags: ['веган'] },
        { title: 'Нектар полевых цветов', place: 'Кафе «Фея»', price: 90, tags: ['нектар', 'веган'] },
        { title: 'Эктоплазменный смузи', place: 'Спектр-бар', price: 120, tags: ['эктоплазма'] },
        { title: 'Серный пирог', place: 'Кухня «Преисподняя»', price: 160, tags: ['огнеупорное'] },
        { title: 'Борщ с пампушками', place: 'Столовая №1', price: 130, tags: ['обычное'] },
        { title: 'Сырая морская тарелка', place: 'Русалочья лавка', price: 200, tags: ['рыба', 'сырое'] },
        { title: 'Эмоции в банке: радость', place: 'Эмпат-маркет', price: 250, tags: ['эмоции'] },
        { title: 'Двойной эспрессо', place: 'Кофейня у библиотеки', price: 80, tags: ['обычное', 'веган'] },
        { title: 'Кровяной латте', place: 'Бар «Ночная смена»', price: 160, tags: ['кровь'] },
        { title: 'Тёплая кровь с корицей', place: 'Бар «Ночная смена»', price: 170, tags: ['кровь'] },
        { title: 'Карпаччо из оленины', place: 'Столовая №1', price: 240, tags: ['мясо', 'сырое'] },
        { title: 'Рёбрышки на гриле', place: 'Столовая №1', price: 230, tags: ['мясо'] },
        { title: 'Салат из лесных трав', place: 'Кафе «Фея»', price: 120, tags: ['веган'] },
        { title: 'Медовые соты с росой', place: 'Кафе «Фея»', price: 110, tags: ['нектар', 'веган'] },
        { title: 'Туманный чай', place: 'Спектр-бар', price: 90, tags: ['эктоплазма'] },
        { title: 'Лавовые угольки', place: 'Кухня «Преисподняя»', price: 140, tags: ['огнеупорное'] },
        { title: 'Эмоции в банке: восторг', place: 'Эмпат-маркет', price: 280, tags: ['эмоции'] },
        { title: 'Устрицы и водоросли', place: 'Русалочья лавка', price: 210, tags: ['рыба', 'сырое'] },
        { title: 'Пицца с пепперони', place: 'Столовая №1', price: 180, tags: ['обычное'] },
        { title: 'Круассан', place: 'Кофейня у библиотеки', price: 70, tags: ['обычное'] },
    ];
    const DEFAULT_MARKET = [
        { title: '«Анатомия нежити», 3-е изд.', cat: 'Учебники', price: 450, rent: 80, seller: 'Ирвин Кроу', rating: 4.8, verified: true },
        { title: 'Шторы, не пропускающие солнце', cat: 'Мебель', price: 700, rent: 0, seller: 'Мира Ноктюрн', rating: 4.6, verified: true },
        { title: 'Серебростойкие перчатки', cat: 'Оборудование', price: 350, rent: 60, seller: 'Лавка «Полнолуние»', rating: 4.9, verified: true },
        { title: 'Ноутбук с защитой от магических помех', cat: 'Электроника', price: 3200, rent: 400, seller: 'Техно-гоблин Зик', rating: 4.3, verified: false },
        { title: 'Звукоизолированный шкаф для полнолуния', cat: 'Оборудование', price: 1800, rent: 250, seller: 'Грег Ульф', rating: 4.1, verified: true },
        { title: 'Алхимический набор первокурсника', cat: 'Оборудование', price: 950, rent: 150, seller: 'Кафедра алхимии', rating: 5, verified: true },
        { title: 'Кресло-гнездо для крылатых', cat: 'Мебель', price: 1200, rent: 0, seller: 'Селеста Вингс', rating: 4.7, verified: false },
        { title: 'Конспекты по межвидовому праву', cat: 'Учебники', price: 150, rent: 0, seller: 'Оуэн, 4 курс', rating: 4.2, verified: false },
    ];
    const SPECIES_GROUPS = {
        'Люди и полукровки': ['Человек', 'Полукровка', 'Нефилим', 'Полуэльф', 'Полувампир', 'Полуоборотень', 'Полудемон', 'Полуфейри', 'Полудракон', 'Дампир'],
        'Полулюди-звери': ['Кошка-полулюдь', 'Пантера-полулюдь', 'Лиса-полулюдь', 'Волк-полулюдь', 'Кролик-полулюдь', 'Медведь-полулюдь', 'Олень-полулюдь', 'Тигр-полулюдь', 'Лев-полулюдь', 'Змея-полулюдь', 'Сова-полулюдь', 'Ворон-полулюдь', 'Летучая мышь-полулюдь', 'Енот-полулюдь', 'Собака-полулюдь', 'Бык-полулюдь (минотавр)'],
        'Оборотни и перевёртыши': ['Оборотень', 'Оборотень-волк', 'Оборотень-медведь', 'Оборотень-ягуар', 'Перевёртыш', 'Кицунэ', 'Тануки', 'Селки', 'Доппельгангер'],
        'Нежить и тени': ['Вампир', 'Призрак', 'Банши', 'Лич', 'Ревенант', 'Разумный зомби', 'Мумия', 'Тень', 'Жнец'],
        'Фейри и лесной народ': ['Фейри', 'Эльф', 'Тёмный эльф', 'Дриада', 'Нимфа', 'Пикси', 'Сатир', 'Кентавр', 'Гоблин', 'Гном', 'Тролль', 'Огр'],
        'Демоны и небесные': ['Демон', 'Суккуб', 'Инкуб', 'Бес', 'Ангел', 'Падший ангел', 'Джинн', 'Ифрит', 'Óни'],
        'Водные': ['Сирена', 'Русалка', 'Тритон', 'Нага', 'Келпи', 'Кракен (в облике человека)'],
        'Мифические существа': ['Дракон (в облике человека)', 'Феникс (в облике человека)', 'Грифон (в облике человека)', 'Горгона', 'Ламия', 'Гарпия', 'Химера', 'Василиск (в облике человека)', 'Тэнгу', 'Юки-онна', 'Ёкай'],
        'Маги и создания магии': ['Ведьма / колдун', 'Элементаль огня', 'Элементаль воды', 'Элементаль воздуха', 'Элементаль земли', 'Голем', 'Гомункул', 'Автоматон', 'Слайм', 'Мимик'],
    };
    const SPECIES = Object.values(SPECIES_GROUPS).flat();
    // v: true — способность заметна со стороны
    // + в конце названия — способность заметна окружающим (для реакций жителей, в списке не показывается)
    const ABILITY_GROUPS = {
        'Разум и чувства': ['Телепатия', 'Эмпатия', 'Чтение эмоций', 'Внушение', 'Гипноз взглядом+', 'Чтение памяти', 'Стирание памяти', 'Ментальный щит', 'Детектор лжи', 'Сноходчество', 'Проекция мыслей', 'Обострённые чувства', 'Ночное зрение', 'Эхолокация', 'Сверхчуткий нюх'],
        'Прорицание и знание': ['Предвидение', 'Пророческие сны', 'Психометрия (чтение предметов)', 'Ясновидение', 'Видение аур', 'Чтение судьбы', 'Знание языков', 'Разговор с мёртвыми'],
        'Тело и сила': ['Сверхсила', 'Сверхскорость', 'Регенерация', 'Неуязвимость к ядам', 'Бессмертие', 'Каменная кожа+', 'Ловкость и акробатика', 'Выносливость без сна', 'Дыхание под водой', 'Обращение в зверя+', 'Частичное обращение (когти, клыки)+', 'Смена облика+', 'Изменение возраста+'],
        'Стихии': ['Управление огнём+', 'Управление водой+', 'Управление воздухом+', 'Управление землёй+', 'Управление льдом+', 'Управление молнией+', 'Управление погодой+', 'Управление светом+', 'Управление тенями+', 'Звуковые волны+', 'Магнетизм+'],
        'Магия и чары': ['Телекинез+', 'Иллюзии+', 'Невидимость', 'Зачарование предметов', 'Защитные барьеры+', 'Проклятия', 'Снятие проклятий', 'Руническая магия+', 'Алхимический дар', 'Зельеварение', 'Магия крови+', 'Музыкальная магия+', 'Чары голоса', 'Магия удачи', 'Призыв существ+'],
        'Жизнь, смерть и тьма': ['Целительство+', 'Некромантия+', 'Поглощение жизненной силы', 'Питание эмоциями', 'Контроль крови+', 'Изгнание духов+', 'Благословение', 'Насылание кошмаров', 'Ядовитое прикосновение'],
        'Пространство и время': ['Телепортация+', 'Порталы+', 'Замедление времени', 'Остановка времени (на секунды)', 'Хождение сквозь стены+', 'Левитация+', 'Полёт на крыльях+', 'Астральная проекция+', 'Дублирование себя+'],
        'Природа и звери': ['Разговор с животными', 'Управление растениями+', 'Фамильяр-спутник+', 'Общение с духами природы', 'Звериная форма стаи+', 'Власть над насекомыми+'],
        'Облик и особенности': ['Крылья+', 'Рога+', 'Хвост+', 'Чешуя+', 'Светящиеся глаза+', 'Видимая аура+', 'Очарование внешностью+', 'Изменение голоса', 'Маскировка под человека'],
    };
    const ABILITIES = Object.values(ABILITY_GROUPS).flat().map((x) => ({ n: x.replace(/\+$/, ''), v: x.endsWith('+') }));
    const NO_ABIL = 'Отсутствуют';
    const MAX_YEAR = 5;
    const MARKET_CATS = ['Для дома', 'Электроника', 'Одежда и обувь', 'Спорт и отдых', 'Книги', 'Детям', 'Авто и инструменты'];
    const CLUBS = ['Клуб ночных астрономов', 'Хор сирен', 'Лига регби оборотней', 'Кружок зельеварения', 'Дебатный клуб «Меж видов»', 'Фотоклуб «Без отражения»'];
    const ROOMS = ['Лаборатория алхимии', 'Звукоизолированная комната (полнолуние)', 'Читальный зал без окон', 'Бассейн с морской водой', 'Огнеупорный тренировочный зал', 'Переговорная'];
    const MUNDANE_MENU = [
        { title: 'Капучино', place: 'Кофейня «Зерно»', price: 90, tags: ['кофе'] },
        { title: 'Круассан с миндалём', place: 'Кофейня «Зерно»', price: 80, tags: ['выпечка', 'вегетарианское'] },
        { title: 'Бизнес-ланч', place: 'Столовая «Домашняя»', price: 160, tags: ['обычное'] },
        { title: 'Пицца «Маргарита»', place: 'Пиццерия «На углу»', price: 240, tags: ['вегетарианское'] },
        { title: 'Поке с лососем', place: 'Поке-бар', price: 280, tags: ['рыба'] },
        { title: 'Боул с киноа и авокадо', place: 'Зелёная кухня', price: 210, tags: ['веганское'] },
        { title: 'Шаурма', place: 'Шаурма у метро', price: 150, tags: ['обычное'] },
        { title: 'Сет роллов', place: 'Суши-бар', price: 350, tags: ['рыба'] },
        { title: 'Сэндвич без глютена', place: 'Зелёная кухня', price: 170, tags: ['без глютена'] },
        { title: 'Плов', place: 'Кафе «Восток»', price: 170, tags: ['халяль'] },
        { title: 'Латте', place: 'Кофейня «Зерно»', price: 100, tags: ['кофе'] },
        { title: 'Раф ванильный', place: 'Кофейня «Зерно»', price: 120, tags: ['кофе'] },
        { title: 'Айс-латте с карамелью', place: 'Кофейня «Зерно»', price: 130, tags: ['кофе'] },
        { title: 'Синнабон', place: 'Кофейня «Зерно»', price: 110, tags: ['выпечка'] },
        { title: 'Сырники со сметаной', place: 'Столовая «Домашняя»', price: 140, tags: ['завтраки', 'вегетарианское'] },
        { title: 'Омлет с беконом', place: 'Столовая «Домашняя»', price: 150, tags: ['завтраки'] },
        { title: 'Пицца «Пепперони»', place: 'Пиццерия «На углу»', price: 260, tags: ['обычное'] },
        { title: 'Бургер с картошкой', place: 'Гриль «Квадрат»', price: 250, tags: ['обычное'] },
        { title: 'Цезарь с курицей', place: 'Зелёная кухня', price: 200, tags: ['обычное'] },
        { title: 'Фалафель-ролл', place: 'Зелёная кухня', price: 170, tags: ['веганское', 'халяль'] },
        { title: 'Рамен с курицей', place: 'Суши-бар', price: 260, tags: ['обычное'] },
        { title: 'Чизкейк', place: 'Кофейня «Зерно»', price: 150, tags: ['выпечка', 'вегетарианское'] },
    ];
    const MUNDANE_MARKET = [
        { title: 'Диван-кровать, б/у', cat: 'Для дома', price: 3500, rent: 0, seller: 'Ольга, частное лицо', rating: 4.6, verified: true },
        { title: 'Кофемашина капсульная', cat: 'Для дома', price: 2200, rent: 0, seller: 'Магазин «Техно-Дом»', rating: 4.8, verified: true },
        { title: 'Набор посуды на 6 персон', cat: 'Для дома', price: 900, rent: 0, seller: 'Нина Семёновна', rating: 4.9, verified: false },
        { title: 'Смартфон, почти новый', cat: 'Электроника', price: 9000, rent: 0, seller: 'Денис, частное лицо', rating: 4.3, verified: false },
        { title: 'Ноутбук для работы', cat: 'Электроника', price: 12000, rent: 900, seller: 'Прокат «Гаджет»', rating: 4.7, verified: true },
        { title: 'Игровая приставка', cat: 'Электроника', price: 7500, rent: 600, seller: 'Максим, частное лицо', rating: 4.5, verified: true },
        { title: 'Зимний пуховик', cat: 'Одежда и обувь', price: 2500, rent: 0, seller: 'Секонд «Вторая жизнь»', rating: 4.4, verified: true },
        { title: 'Вечернее платье', cat: 'Одежда и обувь', price: 1800, rent: 400, seller: 'Прокат нарядов «Бал»', rating: 4.8, verified: true },
        { title: 'Кроссовки для бега', cat: 'Одежда и обувь', price: 1400, rent: 0, seller: 'Аня, частное лицо', rating: 4.2, verified: false },
        { title: 'Велосипед городской', cat: 'Спорт и отдых', price: 4800, rent: 350, seller: 'Прокат «Колесо»', rating: 4.6, verified: true },
        { title: 'Палатка на 4 человека', cat: 'Спорт и отдых', price: 2600, rent: 300, seller: 'Турклуб «Вершина»', rating: 4.9, verified: true },
        { title: 'Гантели разборные', cat: 'Спорт и отдых', price: 1100, rent: 0, seller: 'Игорь, частное лицо', rating: 4.1, verified: false },
        { title: 'Собрание детективов, 10 книг', cat: 'Книги', price: 700, rent: 0, seller: 'Букинист «Страница»', rating: 4.7, verified: true },
        { title: 'Кулинарная книга', cat: 'Книги', price: 350, rent: 0, seller: 'Лидия Павловна', rating: 5, verified: false },
        { title: 'Детская коляска', cat: 'Детям', price: 3900, rent: 500, seller: 'Марина, мама двоих', rating: 4.8, verified: true },
        { title: 'Конструктор, большой набор', cat: 'Детям', price: 1200, rent: 0, seller: 'Магазин «Игрушкин»', rating: 4.6, verified: true },
        { title: 'Набор инструментов', cat: 'Авто и инструменты', price: 1600, rent: 200, seller: 'Сергей, автомеханик', rating: 4.5, verified: true },
        { title: 'Автомобильное кресло', cat: 'Авто и инструменты', price: 2100, rent: 250, seller: 'Автомагазин «Путь»', rating: 4.4, verified: true },
    ];
    const MUNDANE_CLUBS = ['Студенческий театр', 'Дебатный клуб', 'Фотоклуб', 'Клуб настольных игр', 'Волейбольная секция', 'Студенческое радио'];
    const MUNDANE_ROOMS = ['Переговорная', 'Читальный зал', 'Компьютерный класс', 'Спортзал', 'Музыкальная студия', 'Актовый зал'];
    const MUNDANE_FACULTIES = [
        { name: 'Экономический факультет', desc: 'Экономика, финансы, менеджмент.', source: 'invented' },
        { name: 'Юридический факультет', desc: 'Право, судебная практика, криминалистика.', source: 'invented' },
        { name: 'Медицинский факультет', desc: 'Лечебное дело и анатомия.', source: 'invented' },
        { name: 'Факультет журналистики', desc: 'Медиа, репортажи, редактура.', source: 'invented' },
        { name: 'Факультет информационных технологий', desc: 'Программирование и данные.', source: 'invented' },
        { name: 'Факультет психологии', desc: 'Клиническая и социальная психология.', source: 'invented' },
        { name: 'Филологический факультет', desc: 'Литература, лингвистика, перевод.', source: 'invented' },
        { name: 'Исторический факультет', desc: 'История, архивное дело, археология.', source: 'invented' },
        { name: 'Факультет международных отношений', desc: 'Дипломатия, политология, языки.', source: 'invented' },
        { name: 'Физико-математический факультет', desc: 'Физика, математика, моделирование.', source: 'invented' },
        { name: 'Биологический факультет', desc: 'Биология, экология, генетика.', source: 'invented' },
        { name: 'Факультет искусств и дизайна', desc: 'Графика, дизайн, живопись.', source: 'invented' },
        { name: 'Архитектурный факультет', desc: 'Архитектура и градостроительство.', source: 'invented' },
        { name: 'Факультет социологии', desc: 'Общество, исследования, медиа.', source: 'invented' },
    ];
    // возрастные группы (только совершеннолетние пользователи)
    const AGE_GROUPS = { a18: '18–22', a23: '23–27', a28: '28–34', a35: '35–44', a45: '45–54', a55: '55–64', a65: '65+' };
    const PROFESSION_GROUPS = {
        'Учёба': ['Студент(ка)', 'Аспирант(ка)', 'Стажёр'],
        'Сфера услуг': ['Бариста', 'Официант(ка)', 'Повар', 'Продавец-консультант', 'Кассир', 'Курьер', 'Таксист', 'Парикмахер', 'Уборщик / клининг', 'Администратор отеля', 'Бармен'],
        'Рабочие профессии': ['Строитель', 'Электрик', 'Сантехник', 'Автомеханик', 'Водитель автобуса', 'Дальнобойщик', 'Сварщик', 'Фермер', 'Грузчик'],
        'Экстренные службы': ['Пожарный', 'Полицейский', 'Врач скорой помощи', 'Спасатель МЧС', 'Фельдшер', 'Диспетчер 112', 'Охранник'],
        'Медицина и забота': ['Врач', 'Медсестра / медбрат', 'Хирург', 'Психолог', 'Ветеринар', 'Фармацевт', 'Сиделка'],
        'Образование и спорт': ['Учитель', 'Преподаватель вуза', 'Воспитатель детского сада', 'Тренер', 'Библиотекарь'],
        'Офис и бизнес': ['Офисный менеджер', 'Бухгалтер', 'Юрист', 'Программист', 'Дизайнер', 'Маркетолог', 'HR-специалист', 'Банковский работник', 'Риелтор', 'Предприниматель', 'Директор организации'],
        'Творчество и медиа': ['Журналист', 'Фотограф', 'Музыкант', 'Художник', 'Актёр / актриса', 'Блогер', 'Писатель', 'Модель'],
        'Государство и закон': ['Сотрудник мэрии', 'Судья', 'Прокурор', 'Дипломат', 'Депутат', 'Мэр города', 'Министр по защите природы', 'Министр по делам детей', 'Уполномоченный по правам человека'],
        'Общество': ['Волонтёр', 'Социальный работник', 'Священнослужитель'],
        'Другое': ['Фрилансер', 'Домохозяйка / домохозяин', 'Безработный(ая)', 'Пенсионер(ка)'],
    };
    const isStudent = (p) => /студент|аспирант/i.test(p?.profession || '');
    const noWork = (p) => /безработн|пенсионер|домохоз/i.test(p?.profession || '');
    // доход в неделю по профессии (₡)
    function incomeOf(p) {
        const pr = String(p?.profession || '').toLowerCase();
        const table = [
            [/министр|депутат|мэр|уполномоченн|судья|прокурор|дипломат|директор/, 4200], [/хирург|программист|предприниматель|юрист|риелтор/, 2600],
            [/врач|банков|маркетолог|hr|дизайнер|психолог|модель|блогер/, 1900], [/пожарн|полицейск|спасател|фельдшер|диспетчер|преподаватель вуза|бухгалтер|менеджер|сотрудник мэрии|журналист|ветеринар|фармацевт|медсестр|медбрат/, 1500],
            [/строител|электрик|сантехник|автомеханик|водитель|дальнобой|сварщик|учитель|тренер|актёр|актрис|фотограф|музыкант|художник|писатель|фрилансер|фермер|повар|администратор/, 1200],
            [/бариста|официант|продавец|кассир|курьер|таксист|парикмахер|уборщ|клининг|бармен|грузчик|охранник|воспитател|библиотекар|сиделк|социальн|священн/, 950],
            [/пенсионер/, 800], [/аспирант|стажёр/, 700], [/студент/, 500], [/безработн/, 350], [/домохоз/, 300], [/волонт/, 250],
        ];
        return (table.find(([re]) => re.test(pr)) || [null, 1000])[1];
    }
    function incomeName(p) {
        if (isStudent(p)) return 'Стипендия';
        if (/пенсионер/i.test(p?.profession || '')) return 'Пенсия';
        if (/безработн/i.test(p?.profession || '')) return 'Пособие';
        if (/домохоз|волонт/i.test(p?.profession || '')) return 'Доход';
        return 'Зарплата';
    }
    const G = (title, price, tag, place = 'Минимаркет города') => ({ title, place, price, tags: [tag] });
    const BASE_GROCERIES = [
        G('Молоко 1 л', 45, 'молочное'), G('Яйца, 10 шт', 70, 'молочное'), G('Сливочное масло', 90, 'молочное'), G('Сыр моцарелла', 110, 'молочное'), G('Пармезан', 160, 'молочное'), G('Сметана', 50, 'молочное'),
        G('Говяжий фарш 500 г', 190, 'мясо и рыба'), G('Куриное филе 500 г', 160, 'мясо и рыба'), G('Бекон', 130, 'мясо и рыба'), G('Филе лосося', 280, 'мясо и рыба'),
        G('Листы для лазаньи', 80, 'бакалея'), G('Спагетти', 60, 'бакалея'), G('Рис', 55, 'бакалея'), G('Мука', 40, 'бакалея'), G('Сахар', 45, 'бакалея'), G('Оливковое масло', 150, 'бакалея'), G('Томаты в собственном соку', 70, 'бакалея'),
        G('Помидоры', 60, 'овощи и зелень'), G('Лук', 25, 'овощи и зелень'), G('Чеснок', 20, 'овощи и зелень'), G('Морковь', 25, 'овощи и зелень'), G('Картофель 1 кг', 40, 'овощи и зелень'), G('Базилик', 35, 'овощи и зелень'),
        G('Яблоки', 50, 'фрукты'), G('Бананы', 45, 'фрукты'), G('Лимоны', 40, 'фрукты'),
        G('Хлеб', 35, 'хлеб и сладкое'), G('Шоколад', 70, 'хлеб и сладкое'), G('Печенье', 55, 'хлеб и сладкое'),
        G('Соль и перец', 30, 'специи и напитки'), G('Молотый кофе', 180, 'специи и напитки'), G('Чай', 90, 'специи и напитки'),
    ];
    const MAGIC_GROCERIES = [
        G('Донорская кровь, пакет', 150, 'для видов', 'Лавка «Ночная смена»'), G('Сырая оленина', 220, 'для видов', 'Лавка «Полнолуние»'), G('Мёд диких пчёл', 110, 'для видов', 'Кафе «Фея»'),
        G('Нектар в банке', 90, 'для видов', 'Кафе «Фея»'), G('Эктоплазменный концентрат', 130, 'для видов', 'Спектр-бар'), G('Огнеупорные специи', 80, 'для видов', 'Кухня «Преисподняя»'),
        G('Свежие водоросли', 70, 'для видов', 'Русалочья лавка'), G('Лунная соль', 60, 'для видов', 'Алхимическая лавка'),
    ];
    const defaultGroceries = (s) => [...BASE_GROCERIES, ...(s?.world === 'mundane' ? [] : MAGIC_GROCERIES)].map((x) => ({ ...x, id: uid() }));
    const mundane = () => true;
    const SP = (s, v) => (mundane(s) ? '' : String(v || '').slice(0, 40));
    const CHANNELS = { all: 'Все', general: 'Общее', study: 'Работа и учёба', clubs: 'Хобби', dorms: 'Район', species: 'Мой вид' };
    const CONSEQ = ['Участковый выносит официальное предупреждение.',
        'Куратор вызывает студента в деканат для объяснений.',
        'Назначена отработка в библиотеке в субботу.',
        'В личное дело внесено письменное предупреждение.',
        'Преподаватель сообщил о нарушении старосте курса.',
    ];
    const FALLBACK_FACULTIES = [
        { name: 'Факультет боевой магии', desc: 'Защитные и атакующие чары, тактика.', source: 'invented' },
        { name: 'Факультет алхимии и зельеварения', desc: 'Трансмутация, эликсиры, яды и противоядия.', source: 'invented' },
        { name: 'Факультет межвидовой медицины', desc: 'Лечение людей, нежити и оборотней.', source: 'invented' },
        { name: 'Факультет некромантии и духов', desc: 'Работа с душами, призраками и порогом смерти.', source: 'invented' },
        { name: 'Факультет межвидового права', desc: 'Законы, договоры и дипломатия между видами.', source: 'invented' },
    ];

    /* ───────────────────────── состояние чата ───────────────────────── */

    function freshState() {
        const c = ctx();
        const now = Date.now();
        return {
            v: 1, auth: false, createdAt: now,
            profile: {
                name: c.name1 || 'Житель', species: '', abilities: '', faculty: '', year: 1, bio: '', age: '', profession: '',
                privacy: { species: true, faculty: true, abilities: false, dating: true }, relWithChar: false,
            },
            faculties: [], schedule: [], enforceFrom: 0, attendance: {}, excuses: {},
            tasks: [], strikes: [], grades: [],
            quarter: { n: 1, start: now }, lowGpaSince: 0, expelled: false, expelReason: '',
            wallet: { balance: cfg().startBalance, history: [], lastStipend: now },
            feed: [], threads: [], social: { followers: 40 + Math.floor(Math.random() * 60), following: [], seed: 0 },
            dating: { mode: 'love', profiles: [], matches: [], fSpecies: '', fAbility: '', fGender: '' },
            menu: MUNDANE_MENU.map((x) => ({ ...x, id: uid() })), orders: [],
            market: MUNDANE_MARKET.map((x) => ({ ...x, id: uid() })), listings: [], inventory: [], world: 'mundane',
            events: [], clubs: [], bookings: [], tickets: [], dean: [],
            notes: [], pauses: [], pausedAt: 0,
        };
    }

    const migrated = new WeakSet();
    function hasChat() {
        const c = ctx();
        const who = (c.characterId !== undefined && c.characterId !== null) || c.groupId;
        const id = c.chatId || (typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() : null);
        return !!(c.chatMetadata && who && id);
    }
    function S() {
        if (!hasChat()) return null;
        const md = ctx().chatMetadata;
        if (!md[MODULE] && md[OLD_MODULE]) { md[MODULE] = md[OLD_MODULE]; delete md[OLD_MODULE]; }
        if (!md[MODULE]) md[MODULE] = freshState();
        const s = md[MODULE];
        soc(s);
        if (!migrated.has(s)) {
            const f = freshState();
            for (const k in f) if (s[k] === undefined) s[k] = f[k];
            migrated.add(s);
        }
        return s;
    }

    let saveTimer = null;
    function save(s) {
        if (s && S() !== s) return;
        updateInjection();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { try { ctx().saveMetadata?.(); } catch (e) { logErr('[CityHub] save', e); } }, 400);
    }

    // куда ведёт уведомление, если место не указано явно — по смыслу текста
    const NOTE_ROUTES = [
        [/^(📚|⌛ Доп|✅ «|🩹)|доп\. задание|просроченное задание/i, { tab: 'study', studyTab: 'tasks' }],
        [/^(⚠️|📉|📈|⛔)|четверть/i, { tab: 'study', studyTab: 'rating' }],
        [/^(✅|📝|📋)/, { tab: 'study', studyTab: 'schedule' }],
        [/^(🎯|🏆|⬆️|⌛ Задание|📊|🔥|🚫|🌤️)|подписал/i, { view: 'me' }],
        [/^(📅|⏰|😶|❌ Встреча|💔)/, { view: 'meetings' }],
        [/^(📦|🍽️|🛒)/, { view: 'delivery' }],
        [/^💰/, { view: 'market' }],
        [/^🎓 Начислена/, { view: 'wallet' }],
        [/^👥 В CityHub появились/, { view: 'settings' }],
        [/^💘/, { tab: 'dating' }],
        [/^🕰️/, { view: 'clock' }],
    ];
    function notify(s, text, type = 'info', go = null) {
        if (!go) go = (NOTE_ROUTES.find(([re]) => re.test(text)) || [])[1] || null;
        s.notes.unshift({ id: uid(), text, type, t: Date.now(), read: false, go });
        if (s.notes.length > 120) s.notes.length = 120;
        if (type !== 'social') toast({ warn: 'warning', bad: 'error', important: 'info', info: 'success' }[type] || 'info', text);
    }
    function tx(s, amount, label) {
        s.wallet.balance = Math.round((s.wallet.balance + amount) * 100) / 100;
        s.wallet.history.unshift({ amount, label, t: Date.now() });
        if (s.wallet.history.length > 200) s.wallet.history.length = 200;
    }
    /** Списание с проверкой баланса. Нельзя купить дороже, чем есть на счёте. */
    function pay(s, amount, label) {
        if (s.wallet.balance < amount) {
            toast('error', `Недостаточно средств: нужно ${money(amount)}, на счёте ${money(s.wallet.balance)}.`);
            return false;
        }
        tx(s, -amount, label);
        return true;
    }

    /* ───────────────────────── учёба: расчёты ───────────────────────── */

    const activeStrikes = (s) => s.strikes.filter((k) => !k.fixed && k.q === s.quarter.n);
    const strikeSum = (s) => activeStrikes(s).reduce((a, k) => a + (k.w || 1), 0);
    const rating = (s) => Math.max(5, Math.round((100 - strikeSum(s) * (95 / cfg().maxStrikes)) * 10) / 10);
    const gpa = (s) => (s.grades.length ? s.grades.reduce((a, g) => a + g.grade, 0) / s.grades.length : null);
    const inPause = (s, t) => s.pauses.some(([a, b]) => t >= a && t <= b) || (s.pausedAt && t >= s.pausedAt);

    function inst(cl, day) {
        const [sh, sm] = cl.start.split(':').map(Number);
        const [eh, em] = cl.end.split(':').map(Number);
        const a = new Date(day); a.setHours(sh, sm, 0, 0);
        const b = new Date(day); b.setHours(eh, em, 0, 0);
        return { start: a.getTime(), end: b.getTime() };
    }
    function occurrences(s, from, to) {
        const out = [];
        const d = new Date(from); d.setHours(0, 0, 0, 0);
        while (d.getTime() <= to) {
            const w = (d.getDay() + 6) % 7;
            for (const cl of s.schedule) {
                if (cl.day !== w) continue;
                const o = inst(cl, d);
                if (o.end >= from && o.start <= to) out.push({ cl, ...o, key: `${cl.id}@${dkey(o.start)}` });
            }
            d.setDate(d.getDate() + 1);
        }
        return out.sort((a, b) => a.start - b.start);
    }
    function curNext(s) {
        const now = NOW();
        const occ = occurrences(s, now - 4 * HOUR, now + 8 * DAY);
        return { cur: occ.find((o) => o.start <= now && o.end > now), next: occ.find((o) => o.start > now) };
    }
    function findOcc(s, key) {
        const [, date] = key.split('@');
        const [y, m, d] = date.split('-').map(Number);
        const day = new Date(y, m - 1, d).getTime();
        return occurrences(s, day, day + DAY - 1).find((o) => o.key === key);
    }

    /* ───────────────────────── ИИ ───────────────────────── */

    const SYS = 'Ты — серверная логика мобильного приложения CityHub внутри ролевой игры. Выполняй задание точно, пиши по-русски, без OOC-комментариев и рассуждений.';

    // новые версии ST принимают объект параметров, старые — позиционные аргументы
    const objStyle = (fn) => fn.length === 0 || /^[^(]*\(\s*\{/.test(Function.prototype.toString.call(fn));
    async function aiRaw(prompt) {
        const c = ctx();
        try {
            if (typeof c.generateRaw === 'function') {
                if (objStyle(c.generateRaw)) return await c.generateRaw({ prompt, systemPrompt: SYS });
                return await c.generateRaw(prompt, null, false, false, SYS);
            }
            if (typeof c.generateQuietPrompt === 'function') {
                const q = `${SYS}\n\n${prompt}`;
                if (objStyle(c.generateQuietPrompt)) return await c.generateQuietPrompt({ quietPrompt: q });
                return await c.generateQuietPrompt(q, false, true);
            }
        } catch (e) { logErr('[CityHub] AI error', e); }
        return '';
    }
    /** Убирает размышления модели и служебные блоки других расширений (Horae и т.п.). */
    const stripThink = (t) => String(t || '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<(horae|status|state|stats|info|details|summary|meta|tracker|scene|time|location|memory)\b[^>]*>[\s\S]*?(<\/\1>|$)/gi, '')
        .replace(/<\/?(horae|status|state|stats|info|details|summary|meta|tracker|scene)\b[^>]*>/gi, '');
    /** Для текста сообщений: ещё и «шапки», которые модель иногда дописывает. */
    function cleanReply(t) {
        return stripThink(t)
            .split('\n')
            .filter((l) => !/^\s*\**\s*CityHub\s*[—–-]/i.test(l))
            .filter((l) => !/^\s*\**[^\n]{1,40}\s*(→|->)\s*[^\n]{1,40}\**\s*$/.test(l))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    function parseJSON(txt) {
        txt = stripThink(txt).replace(/```(?:json)?/gi, '');
        const cands = [];
        const a = txt.indexOf('['), b = txt.lastIndexOf(']');
        const c = txt.indexOf('{'), d = txt.lastIndexOf('}');
        if (a >= 0 && b > a) cands.push([a, txt.slice(a, b + 1)]);
        if (c >= 0 && d > c) cands.push([c, txt.slice(c, d + 1)]);
        cands.sort((x, y) => x[0] - y[0]);
        for (const [, str] of cands) { try { return JSON.parse(str); } catch { /* следующий */ } }
        return null;
    }
    async function aiJSON(prompt) {
        const raw = await aiRaw(`${prompt}\n\nОтветь ТОЛЬКО валидным JSON, без пояснений и без markdown.`);
        const r = parseJSON(raw);
        if (r === null) logErr('ИИ ответил не в формате JSON', raw ? String(raw).slice(0, 500) : '(пустой ответ — проверьте подключение к API)');
        return r;
    }
    async function aiText(prompt) {
        let t = cleanReply(await aiRaw(prompt));
        t = t.replace(/^["«„]+|["»“]+$/g, '').trim();
        return t.slice(0, 1200);
    }

    function macros(t) {
        const c = ctx();
        t = String(t || '');
        try { if (typeof c.substituteParams === 'function') return c.substituteParams(t); } catch { /* ниже вручную */ }
        return t.replace(/\{\{user\}\}/gi, c.name1 || 'Пользователь').replace(/\{\{char\}\}/gi, c.name2 || 'Персонаж');
    }
    const field = (ch, k) => ch?.[k] || ch?.data?.[k] || '';
    /** Полная карточка персонажа — для переписки с ним самим. */
    function charCard() {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        if (!ch) return '';
        const parts = [`Карточка персонажа ${c.name2}:`];
        const d = field(ch, 'description'), p = field(ch, 'personality'), sc = field(ch, 'scenario'), ex = field(ch, 'mes_example');
        if (d) parts.push(`Описание: ${macros(d).slice(0, 3500)}`);
        if (p) parts.push(`Личность: ${macros(p).slice(0, 1200)}`);
        if (sc) parts.push(`Сценарий: ${macros(sc).slice(0, 900)}`);
        if (ex) parts.push(`Примеры речи персонажа (ориентир для стиля и манеры, не копируй дословно):\n${macros(ex).replace(/<START>/gi, '').trim().slice(0, 1800)}`);
        return parts.join('\n');
    }
    /** Последние сообщения основного чата — чтобы персонаж помнил сюжет. */
    function recentStory(n) {
        const chat = ctx().chat || [];
        const out = [];
        for (let i = chat.length - 1; i >= 0 && out.length < n; i--) {
            const m = chat[i];
            if (!m || m.is_system || !m.mes) continue;
            const txt = String(m.mes).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (txt) out.unshift(`${m.name}: ${txt.length > 600 ? `${txt.slice(0, 600)}…` : txt}`);
        }
        return out.join('\n');
    }
    /** Последнее сообщение истории полностью — «что происходит прямо сейчас». */
    function currentScene() {
        const chat = ctx().chat || [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i];
            if (!m || m.is_system || !m.mes) continue;
            const txt = String(m.mes).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (txt) return `${m.name}: ${txt.length > 2000 ? `…${txt.slice(-2000)}` : txt}`;
        }
        return '';
    }
    /** Записи лорбука, чьи ключи встречаются в тексте, плюс постоянные записи. */
    async function loreFor(text) {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        const books = new Set();
        if (ch?.data?.extensions?.world) books.add(ch.data.extensions.world);
        if (c.chatMetadata?.world_info) books.add(c.chatMetadata.world_info);
        const low = String(text).toLowerCase();
        const out = [];
        const take = (keys, content, constant, disabled) => {
            if (disabled || !content) return;
            const hit = constant || (keys || []).some((k) => { k = String(k).trim().toLowerCase(); return k.length > 1 && low.includes(k); });
            if (hit) out.push(macros(content));
        };
        for (const name of books) {
            try {
                const data = await c.loadWorldInfo?.(name);
                for (const e of Object.values(data?.entries || {})) take(e.key, e.content, e.constant, e.disable);
            } catch (e) { logErr('Лорбук', e); }
        }
        for (const e of ch?.data?.character_book?.entries || []) take(e.keys, e.content, e.constant, e.enabled === false);
        return out.join('\n---\n').slice(0, 3000);
    }
    function charInfo() {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        let out = `Персонаж истории: ${c.name2 || '—'}.`;
        if (ch) {
            if (ch.description) out += `\nОписание персонажа: ${macros(ch.description).slice(0, 2200)}`;
            if (ch.scenario) out += `\nСценарий: ${macros(ch.scenario).slice(0, 700)}`;
        }
        return out;
    }
    function abilityInfo(p) {
        if (!p.abilities) return 'не указаны';
        if (p.abilities === NO_ABIL) return 'отсутствуют';
        return `${p.abilities} (${p.abilityVisible ? 'заметна окружающим' : 'со стороны не видна'})`;
    }
    /** Как окружающие реагируют на вид и способности пользователя. */
    function reactionGuide(s) {
        const p = s.profile, L = [];
        if (mundane(s)) return '';
        if (p.species) L.push(`Жители и преподаватели реагируют на то, что ${p.name} — ${p.species}: в зависимости от своего вида (симпатия, опаска, предрассудки, давнее соперничество видов, любопытство, гастрономический интерес и т.п.)${/^человек$/i.test(p.species) ? '; обычный человек среди сверхъестественных — редкость и повод для удивления' : ''}.`);
        if (p.abilities === NO_ABIL) L.push(`У ${p.name} НЕТ сверхъестественных способностей. Окружающие искренне удивляются этому, переспрашивают, недоумевают, сочувствуют или подшучивают.`);
        else if (p.abilities && p.abilityVisible) L.push(`Способность ${p.name} («${p.abilities}») заметна со стороны: окружающие её видят и реагируют — восхищаются, опасаются, завидуют, задают вопросы.`);
        else if (p.abilities) L.push(`Способность ${p.name} («${p.abilities}») со стороны не видна: окружающие не реагируют на неё, пока она не проявится или ${p.name} сам(а) не расскажет. Если проявилась — реагируют по ситуации.`);
        return L.join(' ');
    }
    const GENDERS = { f: 'Женский', m: 'Мужской', nb: 'Небинарный' };
    /** Жёсткое правило о роде: как писать о пользователе и обращаться к нему. */
    function genderRule(p) {
        if (p.gender === 'f') return `${p.name} — девушка. Пиши о ней и обращайся к ней ТОЛЬКО в женском роде (пришла, задумчивая, «ты такая…»), местоимения она/её.`;
        if (p.gender === 'm') return `${p.name} — парень. Пиши о нём и обращайся к нему ТОЛЬКО в мужском роде (пришёл, задумчивый, «ты такой…»), местоимения он/его.`;
        if (p.gender === 'nb') return `${p.name} — небинарная персона. Избегай родовых форм: используй нейтральные конструкции («ты сегодня в задумчивости», «ты пришёл(ла)» не пиши — перестрой фразу), местоимения они/их.`;
        return `Пол ${p.name} не указан — избегай родовых форм по отношению к ${p.name}.`;
    }
    function world(s) {
        const p = s.profile;
        if (mundane(s)) return `Мир: обычный современный город в реальном мире, без магии и сверхъестественного. В CityHub сидят самые разные люди: жители и школьники, взрослые и родители, пенсионеры, люди любых профессий — от уборщика до министра. Жители разные: есть добрые, отзывчивые и честные, а есть грубияны, сплетники, завистники, хамы, мошенники и хулиганы — как в жизни. Несовершеннолетние (школьники) — только обычные жители: никакого флирта, романтики и знакомств с ними. Всё реалистично: еда, вещи, места, события и задания.\n${charInfo()}\n${genderRule(p)}\nЖитель-пользователь: ${p.name}; пол: ${GENDERS[p.gender] || 'не указан'}; возраст: ${AGE_GROUPS[p.age] || 'не указан'}; профессия: ${p.profession || 'не указана'}${isStudent(p) && p.faculty ? ` (${p.faculty}, ${p.year} курс)` : ''}.`;
        return `Мир: университет, где учатся люди, полулюди и сверхъестественные виды.\n${charInfo()}\n${genderRule(p)}\nСтудент-пользователь: ${p.name}; пол: ${GENDERS[p.gender] || 'не указан'}; вид: ${p.species || 'не указан'}; способности: ${abilityInfo(p)}; факультет: ${p.faculty || 'не выбран'}; курс: ${p.year}.\n${reactionGuide(s)}`;
    }
    async function loreText(filterRe) {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        const books = new Set();
        if (ch?.data?.extensions?.world) books.add(ch.data.extensions.world);
        if (c.chatMetadata?.world_info) books.add(c.chatMetadata.world_info);
        const out = [];
        const take = (keys, content) => {
            const t = `${(keys || []).join(', ')}: ${content || ''}`;
            if (!filterRe || filterRe.test(t)) out.push(t);
        };
        for (const name of books) {
            try {
                const data = await c.loadWorldInfo?.(name);
                for (const e of Object.values(data?.entries || {})) take(e.key, e.content);
            } catch (e) { logErr('[CityHub] lorebook', e); }
        }
        for (const e of ch?.data?.character_book?.entries || []) take(e.keys, e.content);
        return out.join('\n').slice(0, 5000);
    }

    // последовательная очередь фоновых запросов к ИИ
    let queue = Promise.resolve();
    function enqueue(s, fn) {
        queue = queue.then(async () => {
            if (S() !== s) return;
            await fn();
            if (S() === s) { save(s); render(); }
        }).catch((e) => logErr('[CityHub]', e));
        return queue;
    }

    /* ───────────────────────── учёба: логика ───────────────────────── */

    async function loadFaculties(s) {
        const lore = await loreText(/факульт|faculty|кафедр|университет|академи|колледж|институт|school|college|department|major/i);
        const r = await aiJSON(`${world(s)}\n\nЛор (лорбук и карточка):\n${lore || '(нет данных)'}\n\nЗадача: определи список факультетов университета. Если факультеты упомянуты в лоре или описании персонажа — используй ИМЕННО их и пометь source "lore". Если информации нет — придумай 8–10 разнообразных факультетов, подходящих этому миру (гуманитарные, естественные, творческие, прикладные), source "invented". Если в лоре факультетов меньше 4 — дополни их придуманными.\nФормат: [{"name":"...","desc":"одно предложение","source":"lore"}]`);
        const list = Array.isArray(r) ? r.filter((f) => f && f.name).map((f) => ({ name: String(f.name).slice(0, 80), desc: String(f.desc || '').slice(0, 160), source: f.source === 'lore' ? 'lore' : 'invented' })) : [];
        return list.length ? list : (mundane(s) ? MUNDANE_FACULTIES : FALLBACK_FACULTIES);
    }

    function fallbackSchedule(fac) {
        const subj = mundane(S())
            ? [`Введение в профессию: ${fac}`, 'История', 'Философия', 'Иностранный язык', 'Физическая культура', 'Высшая математика', 'Основы права']
            : [`Введение в профессию: ${fac}`, 'История сверхъестественных видов', 'Межвидовая этика', 'Практикум способностей', 'Иностранный язык', 'Физическая подготовка', 'Основы безопасности города'];
        const slots = [['09:00', '10:30'], ['10:45', '12:15'], ['13:00', '14:30'], ['14:45', '16:15']];
        const out = [];
        let i = 0;
        for (let d = 0; d < 5; d++) {
            const n = 2 + (d % 2);
            for (let k = 0; k < n; k++) out.push({ day: d, start: slots[k][0], end: slots[k][1], subject: subj[i++ % subj.length], teacher: 'Преподаватель кафедры', room: `Ауд. ${100 + d * 10 + k}` });
        }
        return out;
    }
    async function genSchedule(s, fac) {
        const lore = await loreText(new RegExp(escRe(fac.slice(0, 30)), 'i'));
        const r = await aiJSON(`${world(s)}\n${lore ? `Лор о факультете:\n${lore}\n` : ''}\nСоставь недельное расписание пар для студента ${s.profile.year}-го курса факультета «${fac}». Дни Пн–Сб (day: 0 = понедельник … 5 = суббота), 2–4 пары в день, время между 08:30 и 19:00, пара 60–95 минут, без пересечений. 6–9 разных профильных предметов, подходящих миру; предметы повторяются в течение недели.\nФормат: [{"day":0,"start":"09:00","end":"10:30","subject":"...","teacher":"...","room":"..."}]`);
        const ok = (Array.isArray(r) ? r : []).filter((c) => c && Number.isInteger(+c.day) && +c.day >= 0 && +c.day <= 6
            && TIME_RE.test(String(c.start).trim()) && TIME_RE.test(String(c.end).trim()) && c.subject && pad(c.end) > pad(c.start));
        const list = ok.length >= 4 ? ok : fallbackSchedule(fac);
        return list.map((c) => ({
            id: uid(), day: +c.day, start: pad(c.start), end: pad(c.end), type: 'study',
            subject: String(c.subject).slice(0, 80), teacher: String(c.teacher || '').slice(0, 60), room: String(c.room || '').slice(0, 40),
        }));
    }
    /** Расписание по профессии: смены, учёба или прогулки и дела. */
    async function genLifeSchedule(s) {
        const p = s.profile;
        if (isStudent(p)) {
            const study = await genSchedule(s, p.faculty);
            return study;
        }
        const idle = noWork(p);
        const r = await aiJSON(`${world(s)}\n\n${idle
            ? `${p.name} — ${p.profession}, не работает. Составь недельный распорядок: 4–7 регулярных дел — прогулки, спорт, кружки, походы на рынок, встречи, занятия по интересам. type: "walk" для прогулок и спорта, "activity" для остального.`
            : `${p.name} работает: ${p.profession}. Составь реалистичный недельный график работы для этой профессии (офис 5/2, смены у пожарных и врачей, ночные у охраны, гибкий у фрилансера и т.п.), плюс 1–2 прогулки или тренировки в свободное время. type: "work" для смен, "walk" для прогулок.`}
Дни 0 = понедельник … 6 = воскресенье. subject — что это (например, «Смена в пожарной части №3», «Вечерняя пробежка»), teacher — начальник или с кем (можно пусто), room — где.
Формат: [{"day":0,"start":"09:00","end":"18:00","type":"work","subject":"","teacher":"","room":""}]`);
        const ok = (Array.isArray(r) ? r : []).filter((c) => c && Number.isInteger(+c.day) && +c.day >= 0 && +c.day <= 6
            && TIME_RE.test(String(c.start).trim()) && TIME_RE.test(String(c.end).trim()) && c.subject && pad(c.end) > pad(c.start));
        const list = ok.length >= 2 ? ok : (idle
            ? [0, 2, 4].map((d) => ({ day: d, start: '10:00', end: '11:30', type: 'walk', subject: 'Прогулка в парке', teacher: '', room: 'Городской парк' }))
            : [0, 1, 2, 3, 4].map((d) => ({ day: d, start: '09:00', end: '18:00', type: 'work', subject: `Работа: ${p.profession}`, teacher: 'Руководитель', room: 'Рабочее место' })));
        return list.map((c) => ({
            id: uid(), day: +c.day, start: pad(c.start), end: pad(c.end), type: ['work', 'walk', 'activity', 'study'].includes(c.type) ? c.type : (idle ? 'activity' : 'work'),
            subject: cleanMsg(c.subject).slice(0, 80), teacher: cleanMsg(c.teacher || '').slice(0, 60), room: cleanMsg(c.room || '').slice(0, 50),
        }));
    }
    const TYPE_WORD = { work: ['на работу', 'смена', 'Отправиться на работу'], study: ['на пару', 'пара', 'Отправиться на учёбу'], walk: ['на прогулку', 'прогулка', 'Отправиться на прогулку'], activity: ['по делам', 'дело', 'Отправиться'] };
    const typeOf = (cl) => cl.type || 'study';

    function genTaskDesc(s, t) {
        enqueue(s, async () => {
            const r = await aiJSON(`${world(s)}\n\nПридумай ${t.work ? `рабочее поручение для профессии «${s.profile.profession}» — реалистичное, как от начальника (отчёт, план, разбор случая, письмо клиенту и т.п.)` : t.extra ? 'дополнительное поручение-подработку для этого жителя с учётом профессии' : `домашнее задание по предмету «${t.subject}»`}. Выполняется письменным ответом на 3–10 предложений: эссе, решение задачи, разбор ситуации, описание ритуала или эксперимента.\nФормат: {"title":"короткое название","desc":"формулировка задания, 2–4 предложения"}`);
            t.title = (r?.title ? `${t.extra ? 'Доп.: ' : ''}${String(r.title).slice(0, 80)}` : t.title);
            t.desc = r?.desc ? String(r.desc).slice(0, 800) : `Письменно ответьте: какие три главные идеи последнего занятия по предмету «${t.subject}» вы усвоили и как примените их на практике?`;
        });
    }

    function issueTask(s, o) {
        const c = cfg();
        const now = NOW();
        const nx = occurrences(s, o.end + MIN, o.end + 15 * DAY).find((x) => x.cl.subject === o.cl.subject && x.start > o.end);
        let deadline = nx ? nx.start - c.deadlineOffsetMin * MIN : o.end + 3 * DAY;
        deadline = Math.max(deadline, o.end + HOUR, now + HOUR);
        const work = typeOf(o.cl) === 'work';
        const t = { id: uid(), src: o.key, subject: work ? 'работа' : o.cl.subject, title: work ? `Поручение: ${o.cl.subject}` : `ДЗ: ${o.cl.subject}`, desc: '', issued: now, deadline, done: false, overdue: false, extra: false, work };
        s.tasks.push(t);
        notify(s, `📚 ${work ? 'Новое рабочее поручение' : `Новое задание по «${o.cl.subject}»`}. Срок: ${fmtD(deadline)}.`);
        genTaskDesc(s, t);
    }

    /** Замечание за прогул или несданное поручение: письмо от начальника/преподавателя и удержание из дохода. */
    function addWarning(s, reason, ty) {
        const fine = Math.round(incomeOf(s.profile) * 0.1);
        s.warnings = (s.warnings || 0) + 1;
        tx(s, -fine, `Удержание: ${reason}`);
        notify(s, `📋 Замечание: ${reason}. Удержано ${money(fine)}.`, 'warn', { tab: 'study', studyTab: 'schedule' });
        enqueue(s, async () => {
            const who = ty === 'study' ? 'преподаватель или куратор' : 'начальник или руководитель';
            const r = await aiJSON(`${world(s)}\n\n${s.profile.name} (${s.profile.profession}): ${reason}. Это уже ${s.warnings}-е замечание. Напиши сообщение, которое присылает ${who} в мессенджере CityHub — в характере этого человека (кто-то строгий, кто-то понимающий, кто-то грубый).\nФормат: {"from":"имя и должность","text":"1–3 предложения"}`);
            if (!r?.text) return;
            const from = cleanName(r.from) || (ty === 'study' ? 'Куратор' : 'Руководитель');
            let th = s.threads.find((t) => t.name.toLowerCase() === from.toLowerCase());
            if (!th) { th = { id: uid(), name: from, species: '', bio: ty === 'study' ? 'преподаватель' : 'начальник по работе', kind: 'dm', msgs: [], t: Date.now(), unread: 0, rel: 0, known: true, status: 'по работе' }; s.threads.unshift(th); }
            th.msgs.push({ me: false, text: cleanMsg(r.text).slice(0, 500), t: Date.now() }); th.unread = (th.unread || 0) + 1; th.t = Date.now();
        });
    }
    function expel(s, reason) {
        if (s.expelled) return;
        s.expelled = true;
        s.expelReason = reason;
        notify(s, `⛔ Ограничение свободы: ${reason}.`, 'bad');
    }

    function addStrike(s, reason, taskId = null, w = 1) {
        if (s.expelled) return;
        const k = { id: uid(), reason, taskId, t: NOW(), q: s.quarter.n, fixed: false, consequence: '', w: clamp(Math.round(w) || 1, 1, 10) };
        s.strikes.push(k);
        const n = strikeSum(s), max = cfg().maxStrikes;
        notify(s, `⚠️ Правонарушение (${n}/${max}): ${reason}. Рейтинг: ${rating(s)}%.`, 'warn');
        if (n >= max) { expel(s, `${reason} — набрано ${n} из ${max} баллов правонарушений`); return; }
        enqueue(s, async () => {
            const r = await aiJSON(`${world(s)}\n\nПолиция и суд реагируют на правонарушение ${s.profile.name}: «${reason}» (тяжесть ${k.w} из 10). Всего набрано ${n} из ${max} баллов, рейтинг ${rating(s)}%. Придумай одно реалистичное последствие по закону: предупреждение, штраф, общественные работы, вызов к участковому, повестка в суд и т.п. — соразмерно тяжести${n <= 2 ? ' (для первого раза — мягче)' : ''}. Всё назначенное станет реальным в приложении.
Формат: {"from":"кто пишет — имя и должность (участковый, следователь, судья, инспектор…)","letter":"официальное сообщение в мессенджере CityHub, 2–4 предложения","summary":"суть последствия одной фразой","fine":0 или сумма штрафа в ₡,"task":null или {"title":"название","desc":"что сделать — объяснительная, отчёт об общественных работах; 1–2 предложения","days":от 1 до 7},"appointment":null или {"inDays":от 0 до 7,"time":"ЧЧ:ММ","place":"где именно"}}`);
            if (S() !== s) return;
            applyConsequence(s, k, r);
        });
    }
    /** Письмо в Чаты, взыскание в Задания, вызов во Встречи. */
    function applyConsequence(s, k, r) {
        const from = cleanName(r?.from) || 'Отдел полиции';
        const fine = clamp(Math.round(+r?.fine || 0), 0, 50000);
        if (fine) tx(s, -fine, `Штраф: ${k.reason}`);
        const letter = cleanMsg(r?.letter || r?.summary || pick(CONSEQ)).slice(0, 900);
        k.consequence = cleanMsg(r?.summary || letter).slice(0, 300);
        let th = s.threads.find((t) => t.name.toLowerCase() === from.toLowerCase());
        if (!th) { th = { id: uid(), name: from, species: '', bio: 'представитель полиции или суда, пишет официально', kind: 'official', msgs: [], t: Date.now(), unread: 0, rel: 0 }; s.threads.unshift(th); }
        th.msgs.push({ me: false, text: `📜 ${letter}`, t: Date.now() });
        th.unread = (th.unread || 0) + 1; th.t = Date.now();
        k.letter = th.id;
        const extras = [];
        if (r?.task && typeof r.task === 'object' && r.task.title) {
            const days = clamp(parseInt(r.task.days, 10) || 3, 1, 7);
            const t = { id: uid(), src: `penalty-${k.id}`, subject: 'Взыскание', title: `По требованию полиции: ${cleanMsg(r.task.title).slice(0, 60)}`, desc: cleanMsg(r.task.desc || '').slice(0, 500), issued: NOW(), deadline: NOW() + days * DAY, done: false, overdue: false, extra: false, penalty: true };
            s.tasks.push(t);
            extras.push(`задание до ${fmtD(t.deadline)}`);
        }
        if (r?.appointment && typeof r.appointment === 'object') {
            const tm = /^(\d{1,2}):(\d{2})$/.exec(String(r.appointment.time || '').trim());
            const d = new Date(NOW()); d.setDate(d.getDate() + clamp(parseInt(r.appointment.inDays, 10) || 1, 0, 7));
            d.setHours(tm ? +tm[1] : 15, tm ? +tm[2] : 0, 0, 0);
            let at = d.getTime();
            if (at < NOW() + HOUR) at += DAY;
            const ov = occurrences(s, at - 3 * HOUR, at + HOUR).find((o) => o.start < at + HOUR && o.end > at);
            if (ov) at = ov.end + 15 * MIN;
            s.meetings.push({ id: uid(), with: from, threadId: th.id, kind: 'official', place: 'custom', placeText: cleanMsg(r.appointment.place || 'кабинет администрации').slice(0, 80), note: '', at, status: 'accepted', created: Date.now() });
            extras.push(`явка ${fmtWhen(at)}`);
        }
        if (fine) extras.unshift(`штраф ${money(fine)}`);
        notify(s, `🏛️ ${from}: ${k.consequence}${extras.length ? ` (${extras.join(', ')})` : ''}`, 'warn', { view: 'thread', param: th.id });
    }

    function tick() {
        const s = S();
        if (!s || !s.auth) return;
        const c = cfg(), now = Date.now(), gnow = NOW();
        let ch = false;

        for (const o of s.orders) {
            if (o.notified || o.kind === 'food' || gnow < o.eta) continue;
            o.notified = true; ch = true;
            notify(s, `📦 Посылка для ${o.to} доставлена.`);
        }
        for (const l of s.listings) if (!l.sold && Math.random() < 1 / 240) {
            l.sold = true; ch = true;
            tx(s, Math.round(l.price * 0.95), `Продажа: ${l.title} (комиссия 5%)`);
            notify(s, `💰 Продано: ${l.title}.`);
        }
        const so = soc(s);
        if (refreshQuests(s)) ch = true;
        for (const q of so.quests) if (q.hook && q.hookAt && now >= q.hookAt) { fireHook(s, q, q.hookDetail); ch = true; }
        if (s.pendingDMs?.length) {
            const due = s.pendingDMs.filter((x) => now >= x.at);
            for (const pd of due) if (startDM(s, pd)) { s.pendingDMs = s.pendingDMs.filter((x) => x !== pd); ch = true; }
        }
        if (tickMeetings(s, gnow)) ch = true;
        if (so.hate > 0) so.hate = Math.max(0, so.hate - 0.05);
        if (so.cancelledUntil && now >= so.cancelledUntil) { so.cancelledUntil = 0; so.hate = Math.min(so.hate, 40); ch = true; notify(s, '🌤️ Волна хейта утихла — вас больше не «отменяют».', 'important'); }
        if (cancelled(s)) so.followers = Math.max(0, so.followers - Math.floor(so.followers * 0.001));
        const lvBoost = 1 + (levelOf(so) - 1) * 0.3;
        for (const p of s.feed) {
            if (!p.mine) continue;
            if ((p.likes || 0) >= 200) questEvent(s, 'likes');
            for (const c of p.comments || []) if (c.at && c.at <= now && !c.seen) {
                c.seen = true; ch = true;
                if (!(ui.open && ui.view === 'post' && ui.param === p.id)) notify(s, `💬 ${c.author}: ${c.text.slice(0, 60)}`, 'social', { view: 'post', param: p.id });
            }
            const age = now - p.t;
            if (age < 2 * DAY) {
                const rate = Math.max(1, Math.round(s.social.followers * (age < HOUR ? 0.04 : 0.008) * (cancelled(s) ? 0.15 : 1)));
                const add = Math.floor(Math.random() * rate);
                if (add) { p.likes = (p.likes || 0) + add; ch = true; }
                if (age < 6 * HOUR && Math.random() < 0.25) {
                    const f = cancelled(s) ? 0 : Math.round((1 + Math.floor(Math.random() * Math.max(1, s.social.followers / 60))) * lvBoost);
                    s.social.followers += f; ch = true;
                }
            }
        }
        if (gnow - s.wallet.lastStipend >= 7 * DAY) {
            s.wallet.lastStipend = gnow; ch = true;
            const pay = Math.round(Number(c.stipend) || incomeOf(s.profile)) - (s.weekWarnings || 0) * 0;
            if (!s.expelled && pay > 0) { tx(s, pay, incomeName(s.profile)); notify(s, `🎓 Начислено: ${incomeName(s.profile).toLowerCase()} ${money(pay)}.`); }
        }

        if (!s.expelled && !(s.pausedAt && !gameMode(s))) {
            if (gnow - s.quarter.start >= yearDays() * DAY) {
                s.quarter = { n: s.quarter.n + 1, start: gnow }; ch = true;
                notify(s, `📅 Начался новый год. Счётчик правонарушений обнулён.`, 'important');
            }
            // посещаемость и выдача домашних заданий
            for (const o of occurrences(s, Math.max(s.enforceFrom, gnow - 14 * DAY), gnow)) {
                if (s.expelled) break;
                if (o.start < s.enforceFrom || o.end > gnow || inPause(s, o.start)) continue;
                if (!s.attendance[o.key]) {
                    ch = true;
                    const ty = typeOf(o.cl);
                    if (ty === 'walk' || ty === 'activity') s.attendance[o.key] = 'skipped';
                    else { s.attendance[o.key] = 'absent'; addWarning(s, `${ty === 'work' ? 'прогул на работе' : 'пропуск занятия'} — ${o.cl.subject}, ${fmtD(o.start)}`, ty); }
                }
                const ty2 = typeOf(o.cl);
                if ((ty2 === 'work' || ty2 === 'study') && s.attendance[o.key] !== 'absent' && !s.tasks.some((t) => t.src === o.key) && Math.random() < (ty2 === 'work' ? 0.5 : 1)) { issueTask(s, o); ch = true; }
            }
            // дедлайны
            for (const t of s.tasks) {
                if (s.expelled) break;
                if (t.done || t.overdue || t.expired || gnow < t.deadline) continue;
                ch = true;
                if (t.extra) { t.expired = true; notify(s, `⌛ Доп. задание «${t.title}» истекло.`); }
                else if (t.penalty) { t.overdue = true; addStrike(s, `не выполнено взыскание — ${t.title}`, t.id); }
                else { t.overdue = true; addWarning(s, `не выполнено вовремя — ${t.title}`, t.subject === 'учёба' ? 'study' : 'work'); }
            }
            // долгое время низкий средний балл
            const g = rating(s);
            if (!s.expelled && g < c.lowGpa) {
                if (!s.lowGpaSince) {
                    s.lowGpaSince = gnow; ch = true;
                    notify(s, `📉 Рейтинг ${g}% ниже ${c.lowGpa}%. Если он останется таким ${c.lowGpaDays} дн., последует ограничение свободы.`, 'warn');
                } else if (gnow - s.lowGpaSince >= c.lowGpaDays * DAY) {
                    expel(s, `рейтинг долгое время ниже ${c.lowGpa}%`); ch = true;
                }
            } else if (s.lowGpaSince) {
                s.lowGpaSince = 0; ch = true;
                notify(s, '📈 Рейтинг восстановлен, угроза ограничения свободы снята.');
            }
        }
        if (ch) save(s);
    }


    /* ───────────────────────── соцсеть: статы, уровни, квесты, отмена ───────────────────────── */

    function soc(s) {
        const d = { followers: 50, following: [], authority: 0, hate: 0, cancelledUntil: 0, quests: [], questDay: '', questHistory: [], level: 1 };
        if (!s.social) s.social = {};
        if (s.social.authority === undefined && (s.social.aura !== undefined || s.social.humor !== undefined)) {
            s.social.authority = Math.round((s.social.aura || 0) + (s.social.humor || 0));
            delete s.social.aura; delete s.social.humor;
        }
        for (const k in d) if (s.social[k] === undefined) s.social[k] = Array.isArray(d[k]) ? [] : d[k];
        if (!s.stories) s.stories = [];
        if (!s.meetings) s.meetings = [];
        for (const k of s.strikes || []) {
            if (!k.consequence || k.letter) continue;
            let th = s.threads?.find((t) => t.kind === 'official' && t.name === 'Отдел полиции');
            if (!th && s.threads) { th = { id: uid(), name: 'Отдел полиции', species: '', bio: 'представитель полиции или суда, пишет официально', kind: 'official', msgs: [], t: Date.now(), unread: 0, rel: 0 }; s.threads.unshift(th); }
            if (th) { th.msgs.push({ me: false, text: `📜 ${k.consequence}`, t: Date.now() }); th.unread = (th.unread || 0) + 1; k.letter = th.id; }
        }
        if (!s.cityGoodsFixed) {
            s.cityGoodsFixed = true;
            const MAGIC = /кровь|сыр(ое|ая) (мясо|оленина)|эктоплазм|нектар|огнеупор|эмоци|лунн|водоросл|русалоч|преисподн|фея|полнолуни|спектр|для видов/i;
            if (!s.menu || s.menu.some((m) => MAGIC.test(`${m.title} ${m.place} ${(m.tags || []).join(' ')}`))) s.menu = MUNDANE_MENU.map((x) => ({ ...x, id: uid() }));
            if (!s.market || s.market.some((m) => !MARKET_CATS.includes(m.cat) || MAGIC.test(`${m.title} ${m.seller}`) || /курс|общаг|кафедр/i.test(`${m.title} ${m.seller}`))) s.market = MUNDANE_MARKET.map((x) => ({ ...x, id: uid() }));
            if (s.groceries && s.groceries.some((g) => MAGIC.test(`${g.title} ${g.place} ${(g.tags || []).join(' ')}`))) s.groceries = null;
            s.world = 'mundane';
        }
        if (!s.clock) s.clock = { mode: cfg().timeMode || 'game', t: Date.now(), source: 'старт' };
        if (!s.jealousy) s.jealousy = [];
        return s.social;
    }
    const LEVELS = [0, 15, 40, 80, 140, 220, 320, 450, 600, 800];
    const PERKS = { 2: 'квесты на сюжеты и встречи', 3: 'квесты на дружбу, подписчики растут быстрее', 4: 'двойной шанс вирусного поста', 5: 'галочка верификации' };
    const xpOf = (so) => Math.max(0, Math.round(so.authority));
    function levelOf(so) { const x = xpOf(so); let l = 1; LEVELS.forEach((v, i) => { if (x >= v) l = i + 1; }); return l; }
    const cancelled = (s) => soc(s).cancelledUntil > Date.now();

    // отслеживаемые действия; rp — задание в основной истории, проверяется по чату
    const QUEST_KINDS = {
        like: 'поставить лайки постам', reply: 'ответить на чужой комментарий', comment: 'оставить комментарии', post: 'опубликовать пост',
        dm: 'написать сообщения в личке', follow: 'подписаться на жителей', meet: 'договориться о встрече через CityHub', story: 'вмешаться в сюжетную линию ленты',
        checkin: 'отметиться на работе, учёбе или прогулке', homework: 'выполнить поручения по работе или учёбе', grade5: 'получить 5 по предмету (param — точное название слабого предмета)',
        order: 'заказать доставку', buy: 'купить или арендовать вещь на маркетплейсе', friend: 'подружиться с кем-то в личке', rp: 'дело в основной истории',
    };
    const FALLBACK_QUESTS = [
        { k: 'like', title: 'Щедрое сердце', desc: 'Поставь лайки трём постам однокурсников.', n: 3, authority: 1, money: 30 },
        { k: 'reply', title: 'Последнее слово', desc: 'Ответь кому-нибудь в комментариях.', n: 1, authority: 2, money: 0 },
        { k: 'rp', title: 'Операция «Чистота»', desc: 'Вынеси мусор из комнаты в общежитии, пока комендант не устроил проверку.', n: 1, authority: 2, money: 40 },
        { k: 'rp', title: 'Генеральная уборка', desc: 'Наведи порядок в комнате — вдруг кто-то зайдёт в гости.', n: 1, authority: 2, money: 50 },
        { k: 'checkin', title: 'Образцовый работник', desc: 'Приди вовремя по распорядку два раза подряд.', n: 2, authority: 2, money: 50 },
        { k: 'rp', title: 'Долг библиотеке', desc: 'Верни просроченную книгу в библиотеку и не попадись на глаза библиотекарю.', n: 1, authority: 2, money: 30 },
        { k: 'follow', title: 'Новые связи', desc: 'Подпишись на двух жителей, которых раньше не знал(а).', n: 2, authority: 1, money: 20 },
    ];
    function weakSubjects(s) {
        const by = {};
        for (const g of s.grades) (by[g.subject] ||= []).push(g.grade);
        return Object.entries(by).map(([k, a]) => [k, a.reduce((x, y) => x + y, 0) / a.length]).filter(([, v]) => v < 4).sort((a, b) => a[1] - b[1]).map(([k]) => k);
    }
    function makeQuest(q, s) {
        const k = QUEST_KINDS[q.k] ? q.k : 'rp';
        const weak = weakSubjects(s);
        if (k === 'grade5' && !weak.includes(q.param)) return null;
        return {
            id: uid(), k, t: cleanMsg(q.title || 'Задание').slice(0, 60), desc: cleanMsg(q.desc || '').slice(0, 260),
            n: clamp(parseInt(q.n, 10) || 1, 1, k === 'rp' ? 1 : 8), p: 0, done: false, param: k === 'grade5' ? q.param : '',
            r: { authority: clamp(parseInt(q.authority, 10) || 2, 1, 6), money: clamp(parseInt(q.money, 10) || 0, 0, 300) },
            hook: q.hook && typeof q.hook === 'object' ? q.hook : null, setup: '',
            trigger: TRIGGERS[q.trigger] ? q.trigger : (TRIGGERS[k] ? k : 'post'),
        };
    }
    const TRIGGERS = { now: 'сразу', post: 'публикация поста', comment: 'комментарий', reply: 'ответ на комментарий', dm: 'сообщение в личке', like: 'лайк', follow: 'подписка', checkin: 'отметка на паре', homework: 'сдача задания', order: 'заказ доставки', buy: 'покупка на маркете', meet: 'договорённость о встрече' };
    /** Зацепка срабатывает в ответ на действие пользователя: ИИ пишет отклик с учётом того, что он(а) сделал(а). */
    function fireHook(s, q, detail) {
        const h = q.hook;
        q.hook = null;
        if (!h) return;
        const act = TRIGGERS[q.trigger] || 'действие';
        if (h.type === 'story') {
            q.setup = cleanMsg(h.event || h.intent || '').slice(0, 300);
            if (q.trigger !== 'now') notify(s, `✨ Кажется, ваше действие запустило что-то в истории…`, 'social');
            return;
        }
        enqueue(s, async () => {
            const who = cleanName(h.from || h.author) || 'Аноним';
            const sp = String(h.species || '').slice(0, 40);
            const base = `${world(s)}\n\nЗадание ${s.profile.name}: «${q.t}» — ${q.desc}\nЗамысел продолжения: ${h.intent || h.text || ''}\nПоводом стало действие ${s.profile.name}: ${act}${detail ? ` — «${String(detail).slice(0, 300)}»` : ''}.`;
            if (h.type === 'dm') {
                const txt = await aiText(`${base}\n\nТеперь ${who}${sp ? ` (${sp})` : ''} пишет ${s.profile.name} в личку CityHub, откликаясь именно на это действие. Напиши первое сообщение: 1–3 предложения, живо, по-русски, только текст.`);
                if (!txt) return;
                let th = s.threads.find((t) => t.name.toLowerCase() === who.toLowerCase());
                if (!th) { th = { id: uid(), name: who, species: sp, bio: String(h.intent || '').slice(0, 200), kind: 'dm', msgs: [], t: Date.now(), unread: 0, rel: 0 }; s.threads.unshift(th); }
                th.msgs.push({ me: false, text: cleanMsg(txt).slice(0, 500), t: Date.now() });
                th.unread = (th.unread || 0) + 1; th.t = Date.now();
                notify(s, `💬 ${who}: ${cleanMsg(txt).slice(0, 70)}`, 'important', { view: 'thread', param: th.id });
            } else if (h.type === 'post') {
                const txt = await aiText(`${base}\n\nТеперь ${who}${sp ? ` (${sp})` : ''} публикует пост в ленте CityHub, откликаясь на это. До 280 символов, живо, по-русски, только текст поста.`);
                if (!txt) return;
                s.feed.unshift({ id: uid(), author: who, species: sp, channel: 'general', text: cleanMsg(txt).slice(0, 500), likes: 5 + Math.floor(Math.random() * 60), t: Date.now(), comments: [] });
                notify(s, `📰 ${who} опубликовал(а) пост — кажется, это про вас`, 'important', { view: 'post', param: s.feed[0]?.id });
            }
        });
    }
    /** Проверяет, не запускает ли действие пользователя чью-то зацепку. Отклик приходит через 1–3 минуты. */
    function armHooks(s, k, detail) {
        for (const q of soc(s).quests) {
            if (!q.hook || q.hookAt || q.trigger !== k) continue;
            q.hookAt = Date.now() + (60 + Math.floor(Math.random() * 120)) * 1000;
            q.hookDetail = String(detail || '').slice(0, 300);
        }
    }
    /** Новые задания раз в день: генерирует ИИ, без повторов. */
    function refreshQuests(s) {
        const so = soc(s), day = dkey(NOW());
        if (so.questDay === day) return false;
        so.questDay = day;
        for (const q of so.quests) if (!q.done && q.k === 'rp') notify(s, `⌛ Задание «${q.t}» так и не выполнено.`, 'social');
        so.quests = [];
        so.questsLoading = true;
        enqueue(s, async () => {
            const weak = weakSubjects(s);
            const past = so.questHistory.slice(-40);
            const story = recentStory(8), scene = currentScene();
            const dms = s.threads.filter((t) => t.msgs.length).slice(0, 6).map((t) => `${t.name}: «${(t.msgs[t.msgs.length - 1].text || '').slice(0, 80)}»`).join('; ');
            const plots = s.stories.slice(-4).map((x) => `«${x.title}»: ${x.summary}`).join('; ');
            const r = await aiJSON(`${world(s)}\n\nПридумай 3 повседневных задания дня для ${s.profile.name} в приложении CityHub (${s.profile.profession || 'житель'}, ${AGE_GROUPS[s.profile.age] || ''} лет). Задания зависят от профессии и от того, что происходит в истории: врачу — осмотреть пациента или дописать карту, пожарному — проверить снаряжение, пенсионеру — сходить на рынок или позвонить внукам, студенту — подготовиться к семинару, всем — бытовые и социальные дела.
Типы (поле "k"):
${Object.entries(QUEST_KINDS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
Правила:
- Минимум одно задание типа rp: конкретное дело в основной истории — бытовое, социальное, учебное или приключенческое (вынести мусор, навести порядок, оплатить счета, помочь соседу, забрать посылку, записаться к врачу, разузнать слух, помириться с кем-то…). Оно должно двигать сюжет и быть связано с миром, персонажами и текущими событиями.
- Задания из разных сфер, живые и конкретные, с юмором или интригой; у каждого короткое яркое название.
- ОПИРАЙСЯ ТОЛЬКО НА ФАКТЫ ниже. Нельзя описывать как уже случившееся то, чего нет: чью-то панику, аварию, чужую просьбу, сообщение в личке, пост в ленте. Нельзя противоречить текущему моменту истории — где находятся персонажи и что делают.
- Задание типа rp — то, что ${s.profile.name} может сделать сам(а) по своей инициативе (убраться, вернуть книгу, приготовить сюрприз, помириться, разузнать).
- Для интриги можно добавить зацепку hook — продолжение, которое наступит ТОЛЬКО В ОТВЕТ на действие ${s.profile.name}. Укажи trigger — какое действие её запускает: ${Object.entries(TRIGGERS).filter(([k]) => k !== 'now').map(([k, v]) => `${k} (${v})`).join(', ')}. Виды зацепок: {"type":"dm","from":"имя или Аноним","species":"вид","intent":"кто это и чего хочет"} — этот студент напишет в личку, откликнувшись на действие; {"type":"post","from":"имя","species":"вид","intent":"о чём пост"} — появится пост-отклик в ленте; {"type":"story","event":"что произойдёт в сюжете"} — рассказчик введёт событие в основную историю (для story можно trigger "now").
- Описание задания начинай с действия ${s.profile.name}, а продолжение подавай как возможность, без спойлеров и гарантий: «Опубликуй пост о пропавшем амулете — вдруг кто-то что-то знает», а НЕ «Тебе написал аноним».
- Для отслеживаемых типов (не rp) описание требует ровно само действие и число раз, без условий, которые нельзя проверить (вид автора, тема комментария и т.п.).
- ${weak.length ? `Слабые предметы (для grade5): ${weak.join(', ')}.` : 'Слабых предметов нет — не давай grade5.'}
- НЕ повторяй и не перефразируй прошлые задания: ${past.length ? past.join('; ') : 'их пока нет'}.
ФАКТЫ:
${scene ? `Текущий момент истории: ${scene}\n` : ''}${story ? `Последние события истории:\n${story}\n` : 'Истории пока нет.\n'}Переписки в CityHub: ${dms || 'нет'}.
Сюжеты ленты: ${plots || 'нет'}.${loreStudentsLine(s, 8)}
Формат: [{"k":"rp","title":"название","desc":"что сделать, 1–2 предложения","n":1,"param":"","authority":2,"money":50,"trigger":"post","hook":null}] — n: сколько раз (для rp всегда 1), authority 1–6, money 0–300; trigger нужен только вместе с hook.`);
            let list = (Array.isArray(r) ? r : []).map((q) => q && makeQuest(q, s)).filter(Boolean).slice(0, 3);
            if (!list.some((q) => q.k === 'rp') || list.length < 3) {
                const pool = FALLBACK_QUESTS.filter((f) => !past.includes(f.title) && !list.some((q) => q.t === f.title));
                while (list.length < 3 && pool.length) list.push(makeQuest(pool.splice(Math.floor(Math.random() * pool.length), 1)[0], s));
            }
            if (so.hate >= 40) list.push({ id: uid(), k: 'redeem', t: 'Вернуть доверие', desc: 'Опубликуй пост, который сообщество примет хорошо.', n: 1, p: 0, done: false, r: { authority: 3, money: 0 } });
            for (const q of list) if (q.hook && q.trigger === 'now') fireHook(s, q, '');
            so.quests = list;
            so.questHistory.push(...list.map((q) => q.t));
            if (so.questHistory.length > 80) so.questHistory = so.questHistory.slice(-80);
            so.questsLoading = false;
            notify(s, `🎯 Новые задания дня: ${list.map((q) => q.t).join(', ')}`, 'social');
        });
        return true;
    }
    function completeQuest(s, q) {
        q.done = true; q.doneAt = NOW();
        if (q.r.authority) addStat(s, 'authority', q.r.authority);
        if (q.r.money) tx(s, q.r.money, `Награда за задание: ${q.t}`);
        notify(s, `🏆 Задание выполнено: ${q.t}${q.r.authority ? ` (авторитет +${q.r.authority}` : ''}${q.r.money ? `, +${money(q.r.money)}` : ''}${q.r.authority ? ')' : ''}`, 'important');
    }
    function addStat(s, k, v) {
        const so = soc(s), before = levelOf(so);
        so[k] = Math.round((so[k] + v) * 10) / 10;
        const after = levelOf(so);
        if (after > before) { so.level = after; notify(s, `⬆️ Уровень CityHub ${after}!${PERKS[after] ? ` Открыто: ${PERKS[after]}.` : ''}`, 'important'); }
    }
    function questEvent(s, k, amt = 1, param = '', detail = '') {
        armHooks(s, k, detail);
        for (const q of soc(s).quests) {
            if (q.k !== k || q.done || (q.param && q.param !== param)) continue;
            q.p = Math.min(q.n, q.p + amt);
            if (q.p >= q.n) completeQuest(s, q);
        }
    }
    function cancelUser(s) {
        const so = soc(s);
        so.cancelledUntil = Date.now() + DAY;
        const lost = Math.round(so.followers * 0.3);
        so.followers -= lost;
        notify(s, `🚫 Вас «отменили» в CityHub! −${kfmt(lost)} подписчиков, охваты рухнули на сутки.`, 'bad');
        enqueue(s, async () => {
            const r = await aiJSON(`${world(s)}\n\nПользователи CityHub устроили травлю ${s.profile.name} за спорные посты и комментарии. Сгенерируй 2 поста разных жителей об этой «отмене»: возмущение, мемы, кто-то заступается. Всё на русском.\nФормат: [{"author":"","species":"","text":"до 250 символов"}]`);
            for (const x of Array.isArray(r) ? r : []) if (x && x.author && x.text) s.feed.unshift({ id: uid(), author: cleanName(x.author), species: SP(s, x.species), channel: 'general', text: cleanMsg(x.text).slice(0, 500), likes: 50 + Math.floor(Math.random() * 500), t: Date.now(), comments: [], story: `Отмена ${s.profile.name}` });
        });
    }
    /** Оценка поста или комментария пользователя сообществом. */
    function applyScore(s, sc, p) {
        if (!sc || typeof sc !== 'object') return;
        const so = soc(s);
        const a = clamp(Math.round(+(sc.authority ?? ((+sc.aura || 0) + (+sc.humor || 0))) || 0), -5, 5), c = clamp(Math.round(+sc.controversy || 0), 0, 10);
        const neg = /neg|негатив/i.test(sc.sentiment || ''), pos = /pos|позитив/i.test(sc.sentiment || '');
        if (a) addStat(s, 'authority', a);
        const dh = neg ? c * 2 + 4 : Math.max(0, c - 5) * 2;
        so.hate = clamp(so.hate + dh - (pos ? 3 : 0), 0, 100);
        if (pos && so.hate >= 30) questEvent(s, 'redeem');
        const parts = [a ? `авторитет ${a > 0 ? '+' : ''}${a}` : '', dh >= 6 ? `хейт +${dh}` : ''].filter(Boolean);
        if (parts.length) notify(s, `📊 ${parts.join(', ')}`, 'social');
        if (so.hate >= 70 && !cancelled(s)) { cancelUser(s); return; }
        if (p && p.mine && pos && !cancelled(s) && a >= 3 && Math.random() < (levelOf(so) >= 4 ? 0.5 : 0.25)) {
            const boost = Math.round(so.followers * (2 + Math.random() * 4));
            const nf = Math.round(so.followers * (0.1 + Math.random() * 0.25)) + 5;
            p.likes = (p.likes || 0) + boost; p.viral = true; so.followers += nf;
            notify(s, `🔥 Пост стал вирусным! +${kfmt(boost)} лайков, +${kfmt(nf)} подписчиков`, 'important');
            questEvent(s, 'viral');
        }
    }

    /* ───────────────────────── отношения в личке ───────────────────────── */

    function relLabel(t) {
        const r = t.rel || 0;
        if (t.kind === 'group' || t.kind === 'official') return '';
        const talked = t.msgs?.some((m) => m.me);
        if (t.conflict && r > -60) return 'в ссоре';
        if (t.known === false && !talked) return 'не знакомы';
        if (t.status && Math.abs(r - (t.relAtSync ?? r)) < 15) return t.status;
        if (t.known === undefined && !talked && t.kind === 'dm' && !t.msgs?.length) return 'не знакомы';
        if (r <= -60) return 'вражда';
        if (r <= -20) return 'неприязнь';
        if ((t.flirt || 0) >= 3 && r >= 40) return r >= 75 ? 'влюблённость' : 'флирт';
        if (r < 20) return 'знакомые';
        if (r < 50) return 'приятели';
        if (r < 80) return 'друзья';
        return 'близкие';
    }
    function updateRel(s, th, delta, flirt, maxStep = 8, why = '') {
        const before = th.rel ?? 0;
        th.rel = clamp(before + clamp(Math.round(delta), -maxStep, maxStep), -100, 100);
        // запоминаем причину конфликта и момент примирения
        if (why && (delta <= -4 || th.rel <= -20)) {
            if (!th.conflict) th.conflict = { why: String(why).slice(0, 220), t: NOW(), low: th.rel };
            else th.conflict.low = Math.min(th.conflict.low ?? th.rel, th.rel);
        }
        if (th.conflict && delta > 0 && th.rel >= (th.conflict.low ?? th.rel) + 15 && th.rel > -40) { th.reconciled = { why: th.conflict.why, t: NOW() }; th.conflict = null; notify(s, `🕊️ Вы с ${th.name} помирились.`, 'social', { view: 'thread', param: th.id }); }
        if (flirt) th.flirt = (th.flirt || 0) + 1; else if (th.flirt) th.flirt = Math.max(0, th.flirt - 0.25);
        if (before < 50 && th.rel >= 50) { notify(s, `🤝 Вы с ${th.name} теперь друзья`, 'social', { view: 'thread', param: th.id }); questEvent(s, 'friend'); }
        if (!th.beef && th.rel <= -60 && th.kind !== 'char') {
            th.beef = true;
            soc(s).hate = clamp(soc(s).hate + 10, 0, 100);
            notify(s, `⚔️ Бифф с ${th.name}! Конфликт выплеснулся в ленту.`, 'warn', { view: 'thread', param: th.id });
            enqueue(s, async () => {
                const x = await aiJSON(`${world(s)}\n\n${th.name}${th.species ? ` (${th.species})` : ''} поссорился(ась) с ${s.profile.name} в личке и выносит конфликт в ленту CityHub: язвительный пост-наезд или прозрачный намёк. Последние сообщения:\n${th.msgs.slice(-6).map((m) => `${m.me ? s.profile.name : th.name}: ${m.text}`).join('\n')}\nФормат: {"text":"до 280 символов","media":"пусто или описание скриншота переписки"}`);
                if (x?.text) s.feed.unshift({ id: uid(), author: th.name, species: th.species || '', channel: 'general', text: cleanMsg(x.text).slice(0, 500), media: String(x.media || '').slice(0, 200), kind: 'photo', likes: 30 + Math.floor(Math.random() * 300), t: Date.now(), comments: [], story: `Бифф: ${th.name} против ${s.profile.name}` });
            });
        }
        if (th.beef && th.rel > -20) th.beef = false;
    }
    /** Кто не знаком нам по лору и не мелькал в истории — синхронизировать нечего. */
    function relevantForSync(s, th) {
        if (th.kind === 'char') return true;
        if (th.kind !== 'dm') return false;
        if (lorePerson(s, th.name)) return true;
        const first = th.name.toLowerCase().split(' ')[0];
        return first.length > 2 && recentStory(30).toLowerCase().includes(first);
    }
    function needsRelSync(s, th) {
        if (th.relSyncing || !relevantForSync(s, th)) return false;
        const len = (ctx().chat || []).length;
        return th.relSyncLen === undefined || len - th.relSyncLen >= 6;
    }
    /** Определяет текущие отношения по карточке, основной истории и переписке (история важнее карточки). */
    async function syncRel(s, th) {
        if (th.relSyncing) return;
        th.relSyncing = true; render();
        try {
            const c = ctx(), ch = c.characters?.[c.characterId];
            const lp = lorePerson(s, th.name);
            const about = th.kind === 'char'
                ? `${charCard()}${field(ch, 'first_mes') ? `\nПервое сообщение истории: ${macros(field(ch, 'first_mes')).slice(0, 1200)}` : ''}`
                : `${th.name}${th.species ? ` (${th.species})` : ''}. ${th.bio || ''}${lp ? ` Из лора: ${lp.bio}${lp.relation ? `; для ${c.name2}: ${lp.relation}` : ''}.` : ''}`;
            const dms = th.msgs.filter((m) => !m.sys).slice(-10).map((m) => `${m.me ? s.profile.name : th.name}: ${m.text}`).join('\n');
            const r = await aiJSON(`${about}\n\nПоследние события основной истории:\n${recentStory(20) || '(истории пока нет)'}\n\nПереписка в CityHub:\n${dms || '(не переписывались)'}\n\nОпредели, какие СЕЙЧАС отношения у ${th.name} с ${s.profile.name}. Опирайся на факты: история и переписка важнее карточки — если по карточке они не знакомы, а в истории уже подружились или начали встречаться, верь истории. Если они ещё ни разу не общались и не знакомы — known: false.\nФормат: {"known":true,"rel":число от −100 (вражда) до 100 (самые близкие),"status":"короткий статус по-русски: не знакомы, знакомые, приятели, друзья, близкие друзья, флирт, пара, соперники, неприязнь, вражда…","pair":true если они сейчас в романтических отношениях,"note":"одной фразой, на чём основан вывод"}`);
            if (S() !== s || !r || typeof r !== 'object') return;
            th.known = r.known !== false;
            th.rel = clamp(Math.round(+r.rel || 0), -100, 100);
            th.relAtSync = th.rel;
            if (th.rel > -10 && th.conflict) { th.reconciled = { why: th.conflict.why, t: NOW() }; th.conflict = null; }
            if (th.rel <= -20 && !th.conflict) th.conflict = { why: cleanMsg(r.note || 'конфликт в истории').slice(0, 220), t: NOW(), low: th.rel };
            th.status = th.known ? cleanMsg(r.status || '').slice(0, 30).toLowerCase() : 'не знакомы';
            th.relNote = cleanMsg(r.note || '').slice(0, 200);
            th.pair = r.pair === true || r.pair === 'true';
            th.relSyncLen = (ctx().chat || []).length;
            if (th.kind === 'char' && th.pair !== !!s.profile.relWithChar) {
                s.profile.relWithChar = th.pair;
                notify(s, th.pair ? `💞 По истории вы с ${th.name} — пара. Отмечено в профиле.` : `По истории вы с ${th.name} сейчас не пара. Отметка в профиле снята.`, 'social');
            }
            save(s);
        } finally { th.relSyncing = false; render(); }
    }
    function jealousNote(s, th) {
        if (th.kind !== 'char') return '';
        const j = s.jealousy.filter((x) => NOW() - x.t < 3 * DAY).slice(-2);
        return j.length ? ` Недавно ${th.name} узнал(а), что ${s.profile.name} ходил(а) на свидание с ${j.map((x) => x.with).join(', ')} (${j[j.length - 1].how}) — это задело, персонаж реагирует в характере.` : '';
    }

    /* ───────────────────────── встречи ───────────────────────── */

    const PLACES = { break: 'на перемене', after: 'после пар', skip: 'вместо пар (прогул)', dorm: 'в общежитии', cafe: 'в кафе города', city: 'в городе' };
    const KINDS = { date: 'Свидание', friends: 'Дружеская встреча', study: 'Совместная учёба' };
    function dayWord(ts) {
        const a = new Date(ts); a.setHours(0, 0, 0, 0);
        const b = new Date(NOW()); b.setHours(0, 0, 0, 0);
        const d = Math.round((a - b) / DAY);
        return d === 0 ? 'сегодня' : d === 1 ? 'завтра' : d === 2 ? 'послезавтра' : new Date(ts).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    }
    const fmtWhen = (ts) => `${dayWord(ts)} в ${fmtT(ts)}`;
    const placeOf = (m) => PLACES[m.place] || m.placeText || '';
    const meetText = (m) => m.kind === 'booking' ? m.note : m.kind === 'official' ? `явка к ${m.with} — ${placeOf(m)}` : `${KINDS[m.kind].toLowerCase()} с ${m.with}, ${placeOf(m)}${m.note ? ` (${m.note})` : ''}`;
    const isoDay = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    /** Возвращает текст ошибки или пустую строку. */
    function meetProblem(s, at, place) {
        if (!Number.isFinite(at) || at < NOW() + 5 * MIN) return 'Выберите время хотя бы через 5 минут.';
        if (s.meetings.some((m) => m.status === 'accepted' && Math.abs(m.at - at) < HOUR)) return 'На это время уже назначена другая встреча.';
        const ov = occurrences(s, at - 3 * HOUR, at + HOUR).find((o) => o.start < at + HOUR && o.end > at);
        if (place === 'skip' && !ov) return 'В это время нет пар. Выберите другой вариант.';
        if (place !== 'skip' && ov) return `Встреча пересекается с парой «${ov.cl.subject}». Выберите «вместо пар», если готовы прогулять, или другое время.`;
        return '';
    }
    function addMeeting(s, th, kind, place, note, at) {
        const m = { id: uid(), with: th.name, threadId: th.id, kind, place, note, at, status: 'accepted', created: Date.now() };
        s.meetings.push(m);
        notify(s, `📅 Встреча добавлена: ${meetText(m)}, ${fmtWhen(at)}`, 'important');
        questEvent(s, 'meet');
        return m;
    }
    function startMeeting(s, m) {
        m.status = 'started';
        notify(s, `⏰ Сейчас: ${meetText(m)}. Встреча начинается в истории.`, 'important');
        if (m.place === 'skip') {
            for (const o of occurrences(s, m.at - 2 * HOUR, m.at + 2 * HOUR)) {
                if (o.start < m.at + 2 * HOUR && o.end > m.at && !s.attendance[o.key] && o.start >= s.enforceFrom) {
                    s.attendance[o.key] = 'absent';
                    addStrike(s, `прогул ради встречи с ${m.with} — ${o.cl.subject}`);
                }
            }
        }
        const ct = s.threads.find((t) => t.kind === 'char');
        if (m.kind === 'date' && s.profile.relWithChar && ct && m.threadId !== ct.id) {
            const chance = { break: 0.45, cafe: 0.4, skip: 0.35, city: 0.3, after: 0.3, dorm: 0.2 }[m.place] ?? 0.3;
            if (Math.random() < chance) {
                const how = pick([`увидел(а) уведомление CityHub на телефоне ${s.profile.name}`, 'кто-то выложил в ленту CityHub фото с этого свидания', 'общий знакомый рассказал', 'случайно оказался(ась) рядом и всё увидел(а) сам(а)']);
                m.caught = how;
                s.jealousy.push({ with: m.with, how, t: NOW() });
                updateRel(s, ct, -30, false, 40, `узнал(а) о свидании ${s.profile.name} с ${m.with}`);
                notify(s, `💔 ${ct.name} узнал(а) о вашем свидании с ${m.with}…`, 'bad');
                enqueue(s, async () => {
                    const txt = await aiText(`${world(s)}\n${charCard()}\n\n${ct.name} и ${s.profile.name} — пара. ${ct.name} только что узнал(а), что ${s.profile.name} пошёл(пошла) на свидание с ${m.with}: ${how}. Напиши сообщение ${ct.name} в мессенджере CityHub строго в характере персонажа (ревность, обида, холод, злость, требование объяснений — как ему/ей свойственно). 1–3 предложения, только текст.`);
                    if (txt) { ct.msgs.push({ me: false, text: cleanMsg(txt).slice(0, 600), t: NOW() }); ct.unread = (ct.unread || 0) + 1; ct.t = NOW(); }
                });
            }
        }
    }
    function tickMeetings(s, now) {
        let ch = false;
        for (const m of s.meetings) {
            if (m.status !== 'accepted' && m.status !== 'started') continue;
            const d0 = new Date(m.at); d0.setHours(0, 0, 0, 0);
            const ds = d0.getTime();
            if (m.status === 'accepted' && now > m.at + 3 * HOUR) {
                m.status = 'missed'; ch = true;
                const th = s.threads.find((t) => t.id === m.threadId);
                if (m.kind === 'official') { addStrike(s, `неявка по вызову — ${m.with}`); continue; }
                if (th) updateRel(s, th, -6, false, 8, `${s.profile.name} не пришёл(ла) на встречу`);
                notify(s, `😶 Встреча с ${m.with} прошла без вас.`, 'warn');
                continue;
            }
            if (!m.nPrev && now >= ds - DAY && now < ds) { m.nPrev = true; ch = true; notify(s, `📅 Завтра в ${fmtT(m.at)}: ${meetText(m)}. Спланируйте день.`, 'important'); }
            if (!m.nDay && now >= ds && now < m.at) { m.nDay = true; ch = true; notify(s, `📅 Сегодня в ${fmtT(m.at)}: ${meetText(m)}. Отменить можно в «Сервисы → Встречи».`, 'important'); }
            if (m.status === 'accepted' && now >= m.at) { startMeeting(s, m); ch = true; }
            if (m.status === 'started' && now >= m.at + 3 * HOUR) { m.status = 'done'; ch = true; }
        }
        return ch;
    }


    /* ───────────────────────── часы истории ───────────────────────── */

    const gameMode = (s) => s?.clock?.mode === 'game';
    /** Текущее время для учёбы, встреч и заданий: часы истории или реальные часы. */
    function NOW() {
        const md = ctx().chatMetadata;
        const s = md && md[MODULE];
        return s && s.clock && s.clock.mode === 'game' ? s.clock.t : Date.now();
    }
    const fmtFull = (ts) => new Date(ts).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    /** Двигает часы истории. back=true разрешает перевод назад (только вручную). */
    function setClock(s, ts, source, back = false) {
        if (!gameMode(s) || !Number.isFinite(ts)) return false;
        if (ts <= s.clock.t && !back) return false;
        const jump = ts - s.clock.t;
        s.clock.t = Math.round(ts);
        s.clock.source = source;
        s.clock.synced = Date.now();
        if (Math.abs(jump) >= 2 * HOUR) notify(s, `🕰️ Время истории: ${fmtFull(s.clock.t)} (${source})`, 'social');
        tick();
        save(s); render();
        return true;
    }
    function nextMorning(ts) { const d = new Date(ts); if (d.getHours() >= 5) d.setDate(d.getDate() + 1); d.setHours(7, 30, 0, 0); return d.getTime(); }

    /** Разбор строки с датой/временем. base — текущее время истории. */
    function parseStoryTime(str, base) {
        str = String(str || '');
        const tm = /(\d{1,2})[:.](\d{2})(?!\d)/.exec(str.replace(/\d{4}-\d{2}-\d{2}/, ' '));
        if (!tm) return null;
        const hh = +tm[1], mi = +tm[2];
        if (hh > 23 || mi > 59) return null;
        const d = new Date(base);
        let dated = false;
        let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
        if (m) { d.setFullYear(+m[1], +m[2] - 1, +m[3]); dated = true; }
        else if ((m = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(str))) { d.setFullYear(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]); dated = true; }
        else if ((m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str))) { d.setFullYear(+m[3], +m[1] - 1, +m[2]); dated = true; }
        d.setHours(hh, mi, 0, 0);
        let ts = d.getTime();
        if (!dated && ts < base - 2 * HOUR) ts += DAY;
        return ts;
    }
    /** Ищет время истории, которое хранит расширение Horae (метаданные чата, данные сообщения или теги в тексте). */
    function readHorae(dump) {
        const c = ctx(), found = [];
        const KEY = /horae/i, TKEY = /(date|time|clock|datetime|timestamp|时间|日期|время|дата)/i;
        const walk = (o, path, depth) => {
            if (!o || depth > 5) return;
            if (typeof o !== 'object') return;
            for (const [k, v] of Object.entries(o)) {
                const p = `${path}.${k}`;
                if (typeof v === 'string' || typeof v === 'number') { if (TKEY.test(k)) found.push([p, String(v)]); }
                else walk(v, p, depth + 1);
            }
        };
        const md = c.chatMetadata || {};
        for (const k of Object.keys(md)) if (KEY.test(k)) walk(md[k], `chatMetadata.${k}`, 0);
        const chat = c.chat || [];
        for (let i = chat.length - 1, n = 0; i >= 0 && n < 3; i--, n++) {
            const m = chat[i];
            if (!m) continue;
            for (const k of Object.keys(m)) if (KEY.test(k)) walk(m[k], `chat[${i}].${k}`, 0);
            for (const k of Object.keys(m.extra || {})) if (KEY.test(k)) walk(m.extra[k], `chat[${i}].extra.${k}`, 0);
            const raw = String(m.mes || '');
            const tag = /<horae[^>]*>([\s\S]*?)<\/horae>/i.exec(raw);
            if (tag) {
                const line = tag[1].split('\n').find((l) => TKEY.test(l)) || tag[1];
                found.push([`chat[${i}].mes<horae>`, line.trim()]);
            }
        }
        if (dump) return found;
        const base = gameMode(S()) ? S().clock.t : Date.now();
        for (const [, v] of found) { const ts = parseStoryTime(v, base); if (ts) return ts; }
        return null;
    }
    let syncing = false;
    /** После каждого ответа истории: Horae → определение ИИ → шаг по умолчанию. */
    /** Раз в несколько ответов проверяет, не совершил ли пользователь правонарушение в истории. */
    let crimeBusy = false;
    async function scanCrimes(s) {
        if (crimeBusy || !cfg().crimeScan || s.expelled) return;
        s.crimeScanAt = (s.crimeScanAt || 0) + 1;
        if (s.crimeScanAt % 3) return;
        crimeBusy = true;
        try {
            const story = recentStory(6);
            if (!story) return;
            const r = await aiJSON(`Последние сообщения истории:\n${story}\n\nСовершил(а) ли ${s.profile.name} в этих сообщениях правонарушение или преступление по законам обычного современного города (вандализм, кража, драка, избиение, угрозы, мошенничество, вождение в нетрезвом виде, убийство и т.п.)? Учитывай только реальные действия ${s.profile.name}, не других персонажей и не шутки. Самооборона и случайности — не правонарушение.
Формат: {"offense":false} или {"offense":true,"type":"вид правонарушения","desc":"что сделал(а), одной фразой","weight":от 1 (мелкое хулиганство) до 10 (убийство),"caught":вероятность от 0 до 1, что об этом узнает полиция (свидетели, камеры, заявление)}`);
            if (S() !== s || !r || r.offense !== true) return;
            const key = `${r.type}|${r.desc}`.slice(0, 120);
            if ((s.crimeSeen || []).includes(key)) return;
            (s.crimeSeen ||= []).push(key); if (s.crimeSeen.length > 30) s.crimeSeen.shift();
            if (Math.random() < clamp(+r.caught || 0.5, 0.05, 1)) addStrike(s, `${cleanMsg(r.type)}: ${cleanMsg(r.desc)}`, null, +r.weight || 1);
            else notify(s, `🤫 Кажется, никто не заметил: ${cleanMsg(r.type)}… пока.`, 'social');
            save(s);
        } catch (e) { logErr('Проверка правонарушений', e); } finally { crimeBusy = false; }
    }
    function onStoryReply() {
        const s = S(), chat = ctx().chat || [];
        const last = chat[chat.length - 1];
        if (!s || !s.auth || !last || last.is_user || last.is_system) return;
        s.replyCount = (s.replyCount || 0) + 1;
        scanCrimes(s);
        for (const o of s.orders) {
            if ((o.kind !== 'food' && o.kind !== 'grocery' && o.kind !== 'service') || o.stage === 'delivered' || !o.injected) continue;
            o.stage = 'delivered'; o.notified = true;
            notify(s, `${o.kind === 'service' ? `🧰 Приехал(а): ${o.title}` : o.kind === 'grocery' ? '🛒 Продукты доставлены' : '🍽️ Заказ доставлен'}${o.kind === 'service' ? '' : `: ${o.title}`}`, 'info', o.kind === 'service' ? { tab: 'study', studyTab: 'help' } : { view: 'delivery' });
        }
        save(s);
    }
    async function onStoryMessage() {
        const s = S();
        if (!s || !s.auth || !gameMode(s) || syncing) return;
        const c = cfg(), chat = ctx().chat || [];
        const last = chat[chat.length - 1];
        if (!last || last.is_user || last.is_system) return;
        if (c.syncHorae) { const ts = readHorae(); if (ts && setClock(s, ts, 'Horae')) return; }
        if (c.syncAI) {
            syncing = true;
            try {
                const text = String(last.mes || '').replace(/<[^>]+>/g, ' ').slice(-2500);
                const r = await aiJSON(`Часы истории сейчас показывают: ${fmtFull(s.clock.t)}.\nНовое сообщение истории:\n${text}\n\nОпредели, сколько времени прошло в истории за это сообщение. Если в тексте явно названо время или переход («наступило утро», «через час», «в 18:00», «на следующий день») — учти это. Обычный диалог без переходов — 1–15 минут.\nФормат: {"minutes":число прошедших минут от 0 до 1440,"time":"ЧЧ:ММ если текст явно называет текущее время, иначе null","nextDay":true если явно наступил следующий день}`);
                if (S() !== s) return;
                if (r && typeof r === 'object') {
                    let ts = s.clock.t + clamp(Math.round(+r.minutes || 0), 0, 1440) * MIN;
                    const tm = /^(\d{1,2}):(\d{2})$/.exec(String(r.time || '').trim());
                    if (tm) {
                        const d = new Date(s.clock.t); if (r.nextDay === true) d.setDate(d.getDate() + 1);
                        d.setHours(+tm[1], +tm[2], 0, 0);
                        let t2 = d.getTime(); if (t2 < s.clock.t) t2 += DAY;
                        ts = t2;
                    } else if (r.nextDay === true && ts < nextMorning(s.clock.t) - 2 * HOUR) ts = nextMorning(s.clock.t);
                    if (setClock(s, ts, 'ИИ по тексту')) return;
                    return;
                }
            } finally { syncing = false; }
        }
        setClock(s, s.clock.t + (Number(c.stepMin) || 10) * MIN, 'шаг за сообщение');
    }

    /* ───────────────────────── люди из лора ───────────────────────── */

    // родня и опекуны — не жители, в приложении им не место
    const FAMILY_RE = /(мать|мама|матер|мачех|отец|отчим|папа|родител|опекун|бабушк|бабк|дедушк|дед(?![а-яё])|дяд|тёт|тет[яи]|прадед|прабаб|mother|father|\bmom\b|\bdad\b|parent|guardian|grand|uncle|aunt)/i;
    function lorePeople(s, role = 'adult') { return (s.lorePeople || []).filter((p) => (p.role === role) || (role === 'adult' && (p.role === 'student' || p.role === 'staff'))); }
    /** Строка для промптов: какие жители из лора есть в мире. */
    function loreStudentsLine(s, max = 10) {
        const list = lorePeople(s).slice(0, max), kids = lorePeople(s, 'minor').slice(0, 5);
        const rule = kids.length ? `\nНесовершеннолетние из лора (${kids.map((p) => p.name).join(', ')}) — только обычные жители: никакого флирта, романтики и анкет знакомств с ними.` : '';
        if (!list.length) return rule;
        return `${rule}\nЖители из лора этого мира (используй их среди авторов и собеседников, сохраняя имена, возраст, профессии и характеры): ${list.map((p) => `${p.name} (${[p.age ? `${p.age} лет` : '', p.faculty].filter(Boolean).join(', ') || 'житель'}${p.relation ? `; для ${ctx().name2}: ${p.relation}` : ''}): ${p.bio}`).join('; ').slice(0, 1800)}.`;
    }
    function lorePerson(s, name) {
        const n = String(name || '').toLowerCase();
        return (s.lorePeople || []).find((p) => p.name.toLowerCase() === n || n.startsWith(p.name.toLowerCase().split(' ')[0] + ' ') || p.name.toLowerCase().startsWith(n.split(' ')[0] + ' '));
    }
    /** Находит в лорбуке и карточке жителей и сотрудников университета, отсекая родных и посторонних. */
    async function extractLorePeople(s) {
        const c = ctx();
        const lore = await loreText(null);
        const card = charCard();
        const r = await aiJSON(`${card}\n\nЛор (лорбук):\n${lore || '(нет)'}\n\nВыпиши всех упомянутых конкретных персонажей, кроме ${c.name2} и ${s.profile.name}: родителей, родственников, друзей, соседей, коллег, начальников — всех жителей города. Для каждого: role — "adult" (18 и старше) или "minor" (младше 18 — школьники, дети); age — возраст числом, если понятен; profession — профессия или занятие.
Формат: [{"name":"имя как в лоре","role":"adult","age":45,"profession":"","bio":"характер и важное, 1–2 предложения","relation":"кем приходится ${c.name2}"}]. Если никого нет — пустой массив.`);
        if (S() !== s) return 0;
        const list = (Array.isArray(r) ? r : []).filter((p) => p && p.name).map((p) => ({
            name: cleanName(p.name).slice(0, 50), species: '', role: p.role === 'minor' || (+p.age && +p.age < 18) ? 'minor' : 'adult',
            age: clamp(parseInt(p.age, 10) || 0, 0, 110), faculty: cleanMsg(p.profession || '').slice(0, 60), year: 0,
            abilities: '', bio: cleanMsg(p.bio || '').slice(0, 300), relation: cleanMsg(p.relation || '').slice(0, 80),
        })).filter((p) => p.name.toLowerCase() !== String(c.name2).toLowerCase() && p.name !== s.profile.name);
        s.lorePeople = list.slice(0, 30);
        s.lorePeopleAt = Date.now();
        save(s);
        return s.lorePeople.length;
    }
    /* ───────────────────────── кампус из лора ───────────────────────── */

    function clubsOf(s) {
        const gen = (s.genClubs || []).map((c) => c.name);
        const base = gen.length ? gen : (mundane(s) ? MUNDANE_CLUBS : CLUBS);
        return [...new Set([...(s.loreClubs || []), ...s.clubs, ...base])];
    }
    const clubDesc = (s, name) => (s.genClubs || []).find((c) => c.name === name)?.desc || '';
    /** ИИ придумывает клубы под мир и факультеты — в дополнение к клубам из лора. */
    async function genClubs(s) {
        const facs = s.faculties.map((f) => f.name).join(', ') || s.profile.faculty;
        const have = [...(s.loreClubs || []), ...s.clubs].join(', ');
        const r = await aiJSON(`${world(s)}\n\nПридумай 6 разнообразных городских клубов по интересам: творческие, спортивные, научные, для родителей, для пожилых, профессиональные сообщества — с учётом профессий горожан (${facs || 'факультеты не указаны'}).${mundane(s) ? ' Только реалистичные клубы обычного вуза, без магии.' : ' Клубы в духе этого сверхъестественного мира.'}${have ? ` Не повторяй уже существующие: ${have}.` : ''}\nФормат: [{"name":"название","desc":"чем занимаются, одно короткое предложение"}]`);
        if (S() !== s) return 0;
        const list = (Array.isArray(r) ? r : []).filter((c) => c && c.name).map((c) => ({ name: cleanMsg(c.name).slice(0, 60), desc: cleanMsg(c.desc || '').slice(0, 140) })).slice(0, 8);
        s.genClubsAt = Date.now();
        if (list.length) s.genClubs = list;
        save(s);
        return list.length;
    }
    /** Клубы, мероприятия и традиции университета, описанные в лорбуке и карточке. */
    async function extractCampusLore(s) {
        const lore = await loreText(/клуб|секци|кружок|обществ|команд|мероприят|праздник|бал|фестивал|турнир|концерт|вечеринк|традици|ярмарк|club|event|society|festival|party|tradition/i);
        s.campusLoreAt = Date.now();
        if (!lore) { save(s); return 0; }
        const r = await aiJSON(`${world(s)}\n\nЛор (лорбук и карточка):\n${lore}\n\nВыпиши ТОЛЬКО то, что реально упомянуто в лоре: клубы, секции и сообщества города, а также городские мероприятия, праздники и традиции. Ничего не придумывай; если чего-то нет — пустой массив.\nФормат: {"clubs":["название"],"events":[{"title":"","when":"когда проходит","place":"","desc":"одно предложение"}]}`);
        if (S() !== s || !r || typeof r !== 'object') return 0;
        s.loreClubs = [...new Set((Array.isArray(r.clubs) ? r.clubs : []).map((x) => cleanMsg(typeof x === 'string' ? x : x?.name || '').slice(0, 60)).filter(Boolean))].slice(0, 12);
        const ev = (Array.isArray(r.events) ? r.events : []).filter((e) => e && e.title).slice(0, 6).map((e) => ({ id: uid(), title: cleanMsg(e.title).slice(0, 80), when: cleanMsg(e.when || '').slice(0, 50), place: cleanMsg(e.place || '').slice(0, 60), desc: cleanMsg(e.desc || '').slice(0, 200), going: false, lore: true }));
        s.events = [...ev, ...s.events.filter((e) => !e.lore)].slice(0, 12);
        save(s);
        return s.loreClubs.length + ev.length;
    }

    /* ───────────────────────── инъекция в промпт ───────────────────────── */

    function buildInjection() {
        const s = S();
        if (!s || !s.auth || !cfg().inject) return '';
        const p = s.profile, g = gpa(s);
        const L = [`[CityHub — статус жителя ${p.name}]`];
        if (s.expelled) L.push(`${p.name} — ОГРАНИЧЕНИЕ СВОБОДЫ (арест или заключение). Причина: ${s.expelReason}. Отрази это в истории: задержание полицией, суд, камера или колония — пока ${p.name} не выйдет на свободу.`);
        if (gameMode(s)) L.push(`Время истории (часы CityHub): ${fmtFull(s.clock.t)}.`);
        L.push(genderRule(p));
        L.push(`Возраст: ${AGE_GROUPS[p.age] || '—'}; профессия: ${p.profession || '—'}${isStudent(p) && p.faculty ? ` (${p.faculty}, ${p.year} курс)` : ''}. Рейтинг законопослушности ${rating(s)}%, правонарушений на ${strikeSum(s)}/${cfg().maxStrikes} баллов, баланс ${money(s.wallet.balance)}.`);
        if (!s.expelled) {
            const { cur, next } = curNext(s);
            if (cur) {
                const st = { present: 'на месте', excused: 'отсутствует по уважительной причине', absent: 'не пришёл(ла)', skipped: 'пропускает' }[s.attendance[cur.key]] || 'ещё не отметился(ась)';
                L.push(`Сейчас по распорядку ${p.name}: «${cur.cl.subject}» (${cur.cl.room || 'аудитория не указана'}, до ${fmtT(cur.end)}); ${p.name} ${st}.`);
            }
            if (next) L.push(`Дальше по распорядку: «${next.cl.subject}» ${DAYS[next.cl.day]} в ${next.cl.start}.`);
            const pend = s.tasks.filter((t) => !t.done && !t.expired).sort((a, b) => a.deadline - b.deadline).slice(0, 3);
            if (pend.length) L.push(`Несданные задания: ${pend.map((t) => `«${t.title}» (${t.overdue ? 'ПРОСРОЧЕНО' : `срок ${fmtD(t.deadline)}`})`).join('; ')}.`);
        }
        if (cfg().shareDMs) {
            const since = Date.now() - DAY;
            const ct = s.threads.find((t) => t.kind === 'char');
            const lines = ct ? ct.msgs.filter((m) => !m.sys && m.t > since).slice(-8) : [];
            if (lines.length) L.push(`Недавняя переписка в CityHub между ${p.name} и ${ct.name} (обоим она известна, на неё можно ссылаться в истории):\n${lines.map((m) => `${m.me ? p.name : ct.name} (${fmtT(m.t)}): ${m.text}`).join('\n')}`);
        }
        // отношения: {{char}} — всегда; остальные — пометки только для рассказчика
        const ctr = s.threads.find((t) => t.kind === 'char');
        if (ctr && (ctr.status || ctr.msgs.some((m) => m.me) || ctr.conflict)) {
            const lbl = relLabel(ctr);
            let line = `Отношения ${ctr.name} и ${p.name} сейчас: ${lbl}${ctr.relNote ? ` (${ctr.relNote})` : ''}.`;
            if (ctr.conflict) line += ` Они В ССОРЕ — причина: ${ctr.conflict.why}. ${ctr.name} ведёт себя соответственно (обида, холодность, колкости, избегание или выяснение отношений — в характере), пока они не помирятся в истории или в CityHub.`;
            else if (ctr.reconciled && NOW() - ctr.reconciled.t < DAY) line += ` Недавно помирились после ссоры (${ctr.reconciled.why}) — лёгкая неловкость ещё может ощущаться.`;
            L.push(line);
        }
        const others = s.threads.filter((t) => t.kind === 'dm' && t.msgs.some((m) => m.me) && (t.conflict || t.beef || (t.rel || 0) >= 50 || ((t.flirt || 0) >= 3 && (t.rel || 0) >= 40))).slice(0, 5);
        if (others.length) L.push(`Для рассказчика — отношения ${p.name} с другими жителями по CityHub (учитывай, только если этот человек появится в сцене; ${ctr ? ctr.name : 'другие персонажи'} об этом не знает, если не был свидетелем и ему не рассказали): ${others.map((t) => `${t.name} — ${t.conflict || t.beef ? `в ссоре с ${p.name}${t.conflict ? ` (${t.conflict.why})` : ''}` : relLabel(t)}`).join('; ')}.`);
        const beefs = s.threads.filter((t) => t.beef);
        if (beefs.length) L.push(`Общеизвестно в городе: публичный бифф в CityHub между ${p.name} и ${beefs.map((t) => t.name).join(', ')} — жители это обсуждают, об этом может знать кто угодно.`);
        const arriving = s.orders.filter((o) => (o.kind === 'food' || o.kind === 'grocery' || o.kind === 'service') && o.stage !== 'delivered' && (o.dueReply !== undefined ? (s.replyCount || 0) + 1 >= o.dueReply : Date.now() >= o.eta));
        if (arriving.length) {
            for (const o of arriving) o.injected = true;
            L.push(`ДОСТАВКА — ОБЯЗАТЕЛЬНО В ЭТОМ ОТВЕТЕ: ${arriving.map((o) => o.kind === 'service' ? (/такси/i.test(o.title) ? `к ${p.name} подъезжает вызванное через CityHub такси, чтобы отвезти: ${o.details}` : `к ${p.name} приезжает/приходит вызванный через CityHub исполнитель — ${o.title} (${o.details})`) : `курьер CityHub приносит ${p.name} заказ: ${o.kind === 'grocery' ? 'пакет с продуктами — ' : ''}${o.title}${o.place ? ` (из: ${o.place})` : ''}`).join('; ')}. Доставка приходит туда, где ${p.name} находится прямо сейчас по сцене (комната, аудитория, двор, кафе и т.д.): курьер${mundane(s) ? '' : ' или доставщик в духе этого мира'} появляется, называет заказ и передаёт его. Впиши это естественно в текущую сцену, не обрывая её.`);
        }
        const so = soc(s), nowT = NOW();
        L.push(`Популярность ${p.name} в CityHub (публично видно): уровень ${levelOf(so)}, ${kfmt(so.followers)} подписчиков.${cancelled(s) ? ` Сейчас ${p.name} «отменяют» в сети — многие жители настроены враждебно и обсуждают это.` : ''}`);
        for (const m of s.meetings) {
            if (m.status === 'started') L.push(`СЕЙЧАС у ${p.name} ${meetText(m)} — договорились через CityHub. Введи эту встречу в повествование в ближайшем ответе (${m.with} ждёт или приходит), если ${p.name} не отменил(а) её словами в чате.`);
            else if (m.status === 'accepted' && m.at - nowT < 36 * HOUR) L.push(`Запланировано через CityHub: ${fmtWhen(m.at)} — ${meetText(m)}. ${p.name} может планировать день с учётом этого.`);
        }
        const rpq = so.quests.filter((q) => q.k === 'rp');
        const openQ = rpq.filter((q) => !q.done), doneQ = rpq.filter((q) => q.done && nowT - q.doneAt < 12 * HOUR);
        if (openQ.length) L.push(`Задания дня ${p.name} в CityHub: ${openQ.map((q) => `«${q.t}» — ${q.desc}`).join('; ')}. Можешь естественно создавать в истории поводы и ситуации, связанные с ними; не выполняй их за ${p.name}.`);
        const setups = openQ.filter((q) => q.setup);
        if (setups.length) L.push(`Предстоящие события (введи их в историю естественно, когда это уместно и не ломает текущую сцену; не всё сразу): ${setups.map((q) => q.setup).join('; ')}.`);
        if (doneQ.length) L.push(`${p.name} недавно выполнил(а): ${doneQ.map((q) => `«${q.t}»`).join(', ')}. Последствия этого могут проявиться в истории (кто-то заметил, поблагодарил, что-то изменилось).`);
        const ctj = s.threads.find((t) => t.kind === 'char');
        for (const j of s.jealousy.filter((x) => nowT - x.t < 3 * DAY).slice(-2)) if (ctj) L.push(`${ctj.name} узнал(а), что ${p.name} ходил(а) на свидание с ${j.with} (${j.how}). Отношения ухудшились — ${ctj.name} реагирует в характере: ревность, обида, холодность или выяснение отношений.`);
        const recent = s.notes.filter((n) => (n.type === 'warn' || n.type === 'bad' || n.type === 'important') && Date.now() - n.t < DAY).slice(0, 3);
        if (recent.length) L.push(`Недавние события: ${recent.map((n) => n.text).join(' | ')}`);
        const rg = reactionGuide(s);
        if (rg) L.push(`Способности: ${abilityInfo(p)}. ${rg}`);
        L.push('Это сведения для рассказчика. Персонажи знают только то, что могли узнать сами: увидели, услышали, им рассказали, это касается их лично или официально объявлено. Учитывай это в повествовании (реакции преподавателей, куратора, окружающих, последствия), не пересказывай статус дословно.');
        return L.join('\n');
    }
    function updateInjection() {
        const c = ctx();
        if (typeof c.setExtensionPrompt !== 'function') return;
        try { c.setExtensionPrompt(OLD_MODULE, '', 1, 0); c.setExtensionPrompt(MODULE, buildInjection(), 1, Number(cfg().injectDepth) || 2, false, 0); }
        catch (e) { logErr('[CityHub] inject', e); }
    }

    /* ───────────────────────── UI: состояние экрана ───────────────────────── */

    const ui = { deliveryTab: 'food', gcat: 'all', open: false, tab: 'feed', view: null, param: null, studyTab: 'schedule', marketTab: 'buy', channel: 'all', diet: 'all', mcat: 'all', schedDay: null, busy: '' };
    let lastKey = '';

    async function withBusy(label, fn) {
        if (ui.busy) { toast('info', 'Подождите, предыдущий запрос ещё выполняется.'); return; }
        ui.busy = label; render();
        try { return await fn(); } finally { ui.busy = ''; render(); }
    }

    /* ───────────────────────── UI: разметка ───────────────────────── */

    function statusBar() {
        const s = S();
        const unread = s ? s.notes.filter((n) => !n.read).length : 0;
        return `<button class="sh-clock" data-act="go" data-view="clock" title="Время">${s && gameMode(s) ? `🕰️ ${fmtT(s.clock.t)}` : fmtT(Date.now())}</button>
        <span class="sh-brand">CityHub</span>
        <span class="sh-sb-right">
          ${s && s.auth ? `<span class="sh-pill" title="Рейтинг">${rating(s)}%</span><button class="sh-pill" data-act="go" data-view="me" title="Авторитет">⭐ ${Math.round(soc(s).authority)}</button><span class="sh-pill" title="Баланс">${money(s.wallet.balance)}</span>` : ''}
          <button class="sh-icon" data-act="go" data-view="notes" aria-label="Уведомления"><i class="fa-solid fa-bell"></i>${unread ? `<b class="sh-dot">${unread}</b>` : ''}</button>
          <button class="sh-icon" data-act="close" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button>
        </span>`;
    }

    const NAV = [['feed', 'fa-house', 'Лента'], ['chats', 'fa-comments', 'Чаты'], ['dating', 'fa-heart', 'Знакомства'], ['study', 'fa-user', 'Кабинет'], ['more', 'fa-grip', 'Сервисы']];
    function navHTML() {
        const s = S();
        if (!s || !s.auth) return '';
        const unreadChats = s.threads.reduce((a, t) => a + (t.unread || 0), 0);
        const overdue = s.tasks.filter((t) => t.overdue && !t.done).length;
        return NAV.map(([k, ic, l]) => {
            const n = k === 'chats' ? unreadChats : k === 'study' ? overdue : 0;
            return `<button class="${!ui.view && ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}"><i class="fa-solid ${ic}"></i><span>${l}</span>${n ? `<b class="sh-dot">${n}</b>` : ''}</button>`;
        }).join('');
    }

    function screenHTML() {
        if (ui.view === 'log') return logView();
        const s = S();
        if (!s) return empty('<i class="fa-solid fa-mobile-screen"></i><br>Откройте чат с персонажем, чтобы войти в CityHub.')
            + '<button class="sh-btn ghost wide" data-act="go" data-view="log"><i class="fa-solid fa-bug"></i> Журнал ошибок</button>';
        if (!s.auth) return authView(s);
        if (ui.view && VIEWS[ui.view]) return VIEWS[ui.view](s, ui.param);
        return (TABS[ui.tab] || TABS.feed)(s);
    }

    /* — вход — */
    function worldChoice() {
        return `<div class="sh-auth">
          <div class="sh-crest"><i class="fa-solid fa-graduation-cap"></i><h2>CityHub</h2><p>Где вы учитесь?</p></div>
          <button class="sh-world" data-act="pickWorld" data-w="magic"><i class="fa-solid fa-wand-magic-sparkles"></i><div><b>Сверхъестественный университет</b><small>Люди, полулюди и магические виды. Способности, лор и магия.</small></div></button>
          <button class="sh-world" data-act="pickWorld" data-w="mundane"><i class="fa-solid fa-building-columns"></i><div><b>Обычный университет</b><small>Реальный мир без магии. Только люди: имя, пол и факультет.</small></div></button>
        </div>`;
    }
    function authView(s) {
        const p = s.profile;
        if (!s.world) s.world = 'mundane';
        const known = s.faculties.some((f) => f.name === p.faculty);
        return `<div class="sh-auth">
          <div class="sh-crest"><i class="fa-solid fa-city"></i><h2>CityHub</h2><p>Приложение жителей города</p></div>
          <label>Имя<input id="sh-a-name" value="${esc(p.name)}"></label>
          ${identityFields('sh-a', p)}
          ${isStudent(p) ? `          <h4>Факультет</h4>
          ${s.faculties.length
        ? `<div class="sh-fac-list">${s.faculties.map((f, i) => `<button class="sh-fac ${p.faculty === f.name ? 'on' : ''}" data-act="pickFac" data-i="${i}"><b>${esc(f.name)}</b>${f.desc ? `<small>${esc(f.desc)}</small>` : ''}${f.source === 'lore' ? '<em>из лора</em>' : ''}</button>`).join('')}</div>`
        : '<p class="sh-muted">Факультеты берутся из лорбука или карточки персонажа. Если там их нет, ИИ предложит свои.</p>'}
          <button class="sh-btn ghost" data-act="loadFac"><i class="fa-solid fa-magnifying-glass"></i> ${s.faculties.length ? 'Обновить список факультетов' : 'Найти факультеты'}</button>
          <label>Или впишите свой<input id="sh-a-fac" placeholder="Название факультета" value="${esc(known ? '' : p.faculty)}"></label>
` : '<p class="sh-muted">Выберите профессию — под неё CityHub составит расписание работы, учёбы или прогулок.</p>'}
          <button class="sh-btn" data-act="login"><i class="fa-solid fa-right-to-bracket"></i> Войти в CityHub</button>
        </div>`;
    }
    /** Варианты для выпадающих списков фильтров: «любой» + из лора + все группы. */
    function speciesOptions(s, cur, anyLabel) {
        const opt = (x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`;
        const lore = s?.loreSpecies || [];
        return `<option value="" ${!cur ? 'selected' : ''}>${esc(anyLabel)}</option>
          ${lore.length ? `<optgroup label="Из вашего мира">${lore.map(opt).join('')}</optgroup>` : ''}
          ${Object.entries(SPECIES_GROUPS).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(opt).join('')}</optgroup>`).join('')}`;
    }
    function abilityOptions(s, cur, anyLabel) {
        const opt = (x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`;
        const lore = (s?.loreAbilities || []).map((a) => a.n);
        return `<option value="" ${!cur ? 'selected' : ''}>${esc(anyLabel)}</option>
          <option value="${NO_ABIL}" ${cur === NO_ABIL ? 'selected' : ''}>Без способностей</option>
          ${lore.length ? `<optgroup label="Из вашего мира">${lore.map(opt).join('')}</optgroup>` : ''}
          ${Object.entries(ABILITY_GROUPS).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((x) => opt(x.replace(/\+$/, ''))).join('')}</optgroup>`).join('')}`;
    }
    function identityFields(pre, p) {
        if (mundane(S())) {
            const all = Object.values(PROFESSION_GROUPS).flat();
            const own = !!p.profession && !all.includes(p.profession);
            return `
          <label>Пол<select id="${pre}-gender"><option value="">— выберите —</option>${Object.entries(GENDERS).map(([k, v]) => `<option value="${k}" ${p.gender === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Возраст<select id="${pre}-age"><option value="">— выберите —</option>${Object.entries(AGE_GROUPS).map(([k, v]) => `<option value="${k}" ${p.age === k ? 'selected' : ''}>${v} лет</option>`).join('')}</select></label>
          <label>Профессия<select id="${pre}-prof" data-change="idSel" data-other="${pre}-prof-o"><option value="">— выберите —</option>
            ${Object.entries(PROFESSION_GROUPS).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((x) => `<option ${x === p.profession ? 'selected' : ''}>${esc(x)}</option>`).join('')}</optgroup>`).join('')}
            <option value="__other" ${own ? 'selected' : ''}>Своя профессия…</option></select></label>
          <div id="${pre}-prof-o" class="sh-other"${own ? '' : ' style="display:none"'}><input id="${pre}-prof-t" placeholder="Например: сомелье, дрессировщик, астроном" value="${esc(own ? p.profession : '')}"></div>
          ${isStudent(p) ? `<label>Курс<select id="${pre}-year">${Array.from({ length: MAX_YEAR }, (_, i) => `<option value="${i + 1}" ${+p.year === i + 1 ? 'selected' : ''}>${i + 1} курс</option>`).join('')}</select></label>` : ''}`;
        }
        const lore = S()?.loreSpecies || [];
        const spKnown = SPECIES.includes(p.species) || lore.includes(p.species);
        const abKnown = p.abilities === NO_ABIL || ABILITIES.some((a) => a.n === p.abilities) || (S()?.loreAbilities || []).some((a) => a.n === p.abilities);
        const spOther = !!p.species && !spKnown;
        const abOther = !!p.abilities && !abKnown;
        const hidden = (b) => (b ? '' : ' style="display:none"');
        return `
          <label>Пол<select id="${pre}-gender"><option value="">— выберите —</option>${Object.entries(GENDERS).map(([k, v]) => `<option value="${k}" ${p.gender === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Вид<select id="${pre}-species" data-change="idSel" data-other="${pre}-species-o">
            <option value="">— выберите —</option>
            ${lore.length ? `<optgroup label="Из вашего мира">${lore.map((x) => `<option ${x === p.species ? 'selected' : ''}>${esc(x)}</option>`).join('')}</optgroup>` : ''}
            ${Object.entries(SPECIES_GROUPS).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((x) => `<option ${x === p.species ? 'selected' : ''}>${esc(x)}</option>`).join('')}</optgroup>`).join('')}
            <option value="__other" ${spOther ? 'selected' : ''}>Другой вид…</option>
          </select></label>
          <button class="sh-link" data-act="loadSpecies" data-pre="${pre}"><i class="fa-solid fa-book"></i> ${lore.length ? 'Обновить виды из лора' : 'Найти виды в лоре и карточке'}</button>
          <div id="${pre}-species-o" class="sh-other"${hidden(spOther)}><input id="${pre}-species-t" placeholder="Название вида" value="${esc(spOther ? p.species : '')}"></div>
          <label>Способности<select id="${pre}-abil" data-change="idSel" data-other="${pre}-abil-o">
            <option value="">— выберите —</option>
            <option value="${NO_ABIL}" ${p.abilities === NO_ABIL ? 'selected' : ''}>Отсутствуют</option>
            ${(S()?.loreAbilities || []).length ? `<optgroup label="Из вашего мира">${S().loreAbilities.map((a) => `<option ${a.n === p.abilities ? 'selected' : ''}>${esc(a.n)}</option>`).join('')}</optgroup>` : ''}
            ${Object.entries(ABILITY_GROUPS).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((x) => x.replace(/\+$/, '')).map((n) => `<option ${n === p.abilities ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}
            <option value="__other" ${abOther ? 'selected' : ''}>Другая способность…</option>
          </select></label>
          <div id="${pre}-abil-o" class="sh-other"${hidden(abOther)}><input id="${pre}-abil-t" placeholder="Опишите способность" value="${esc(abOther ? p.abilities : '')}">
            <label class="sh-toggle"><input type="checkbox" id="${pre}-abil-v" ${abOther && p.abilityVisible ? 'checked' : ''}><span>Способность видна окружающим</span></label></div>
          <button class="sh-link" data-act="loadAbilities" data-pre="${pre}"><i class="fa-solid fa-book"></i> ${(S()?.loreAbilities || []).length ? 'Обновить способности из лора' : 'Найти способности в лоре и карточке'}</button>
          <label>Курс<select id="${pre}-year">${Array.from({ length: MAX_YEAR }, (_, i) => `<option value="${i + 1}" ${+p.year === i + 1 ? 'selected' : ''}>${i + 1} курс</option>`).join('')}</select></label>`;
    }
    function readIdentity(pre, p) {
        const g = val(`${pre}-gender`);
        if (GENDERS[g]) p.gender = g;
        if (mundane(S())) {
            const a = val(`${pre}-age`); if (AGE_GROUPS[a]) p.age = a;
            const pr = val(`${pre}-prof`);
            if (pr === '__other') p.profession = val(`${pre}-prof-t`) || p.profession; else if (pr) p.profession = pr;
            if (byId(`${pre}-year`)) p.year = clamp(parseInt(val(`${pre}-year`), 10) || 1, 1, MAX_YEAR);
            return;
        }
        const sp = val(`${pre}-species`);
        p.species = sp === '__other' ? val(`${pre}-species-t`) : sp;
        const ab = val(`${pre}-abil`);
        if (ab === '__other') { p.abilities = val(`${pre}-abil-t`); p.abilityVisible = !!byId(`${pre}-abil-v`)?.checked; }
        else { p.abilities = ab; p.abilityVisible = !!(ABILITIES.find((a) => a.n === ab) || (S()?.loreAbilities || []).find((a) => a.n === ab))?.v; }
        p.year = clamp(parseInt(val(`${pre}-year`), 10) || 1, 1, MAX_YEAR);
    }
    function readAuth(s) {
        const p = s.profile;
        p.name = val('sh-a-name') || p.name;
        readIdentity('sh-a', p);
    }

    /* — лента — */
    const KIND_ICON = { photo: 'fa-image', video: 'fa-video', reel: 'fa-film', story: 'fa-circle-play' };
    const shownComments = (p) => (p.comments || []).filter((c) => !c.at || c.at <= Date.now());
    const kfmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} млн` : n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace('.', ',')} тыс.` : String(n));
    function personOf(s, name) {
        if (name === s.profile.name) return null;
        const post = s.feed.find((p) => p.author === name);
        let species = post?.species || lorePerson(s, name)?.species || '';
        if (!species) for (const p of s.feed) { const c = (p.comments || []).find((x) => x.author === name); if (c) { species = c.species; break; } }
        let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return { name, species, followers: 20 + (h % 900), following: s.social.following.includes(name) };
    }
    const nameBtn = (name, species) => `<button class="sh-name" data-act="person" data-name="${esc(name)}">${esc(name)}</button>${species ? ` ${badge(species)}` : ''}`;
    function postHTML(p, s, full = false) {
        const n = shownComments(p).length;
        return `<article class="sh-card sh-post ${p.story ? 'story' : ''}">
          <div class="sh-post-h">${ava(p.author, false, p.species)}<div>${p.mine ? `<b>${esc(p.author)}</b>` : nameBtn(p.author, '')}${(p.verified !== false && !p.mine) || (p.mine && levelOf(soc(s)) >= 5) ? ' <i class="fa-solid fa-circle-check sh-verified" title="Верифицирован"></i>' : ''}
          <small>${p.species ? badge(p.species) : ''} ${esc(CHANNELS[p.channel] || '')}, ${fmtD(p.t)}</small></div></div>
          ${p.story ? `<button class="sh-storytag" data-act="channel" data-ch="story:${esc(p.story)}"><i class="fa-solid fa-book-open"></i> ${esc(p.story)}</button>` : ''}${p.viral ? '<span class="sh-storytag hot"><i class="fa-solid fa-fire"></i> в тренде</span>' : ''}
          <div class="sh-post-t">${esc(p.text)}</div>
          ${p.media ? `<div class="sh-media"><i class="fa-solid ${KIND_ICON[p.kind] || 'fa-image'}"></i><span>${esc(p.media)}</span></div>` : ''}
          <div class="sh-post-a">
            <button data-act="like" data-id="${p.id}" class="${p.liked ? 'on' : ''}" aria-label="Нравится"><i class="fa-${p.liked ? 'solid' : 'regular'} fa-heart"></i> ${kfmt(p.likes || 0)}</button>
            ${full ? `<span><i class="fa-regular fa-comment"></i> ${n}</span>` : `<button data-act="go" data-view="post" data-param="${p.id}"><i class="fa-regular fa-comment"></i> ${n ? `Комментарии (${n})` : 'Комментировать'}</button>`}
          </div></article>`;
    }
    function feedTab(s) {
        const my = (s.profile.species || '').toLowerCase();
        const posts = s.feed.filter((p) => {
            if (ui.channel === 'all') return true;
            if (ui.channel === 'mine') return p.mine;
            if (ui.channel === 'stories') return !!p.story;
            if (ui.channel.startsWith('story:')) return p.story === ui.channel.slice(6);
            if (ui.channel === 'following') return s.social.following.includes(p.author);
            if (ui.channel === 'species') {
                const sp = (p.species || '').toLowerCase();
                return p.channel === 'species' && (!my || (sp && (sp.includes(my) || my.includes(sp))));
            }
            return p.channel === ui.channel;
        });
        const authors = [...new Map([...lorePeople(s).map((p) => [p.name, { author: p.name }]), ...s.feed.filter((p) => !p.mine).map((p) => [p.author, p])]).values()].slice(0, 14);
        const chips = { ...CHANNELS, stories: 'Сюжеты', following: 'Подписки', mine: 'Мои посты' };
        if (mundane(s)) delete chips.species;
        if (ui.channel.startsWith('story:')) chips[ui.channel] = `📖 ${ui.channel.slice(6)}`;
        return `
        <button class="sh-me" data-act="go" data-view="me">${ava(s.profile.name, false, s.profile.species)}<div><b>${esc(s.profile.name)}</b><small>Ур. ${levelOf(soc(s))} · ${kfmt(s.social.followers)} подписчиков · авторитет ${Math.round(s.social.authority)}</small></div><i class="fa-solid fa-chevron-right"></i></button>
        ${!s.profile.gender ? '<button class="sh-note warn sh-wide" data-act="go" data-view="profile"><i class="fa-solid fa-venus-mars"></i><span>Укажите свой пол в профиле, чтобы жители обращались к вам правильно.</span></button>' : ''}
        ${cancelled(s) ? `<div class="sh-note bad"><i class="fa-solid fa-ban"></i><span>Вас «отменяют» ещё ${left(s.social.cancelledUntil, Date.now())}: охваты урезаны, подписчики уходят.</span></div>` : ''}
        ${authors.length ? `<div class="sh-stories">${authors.map((p) => `<button class="sh-story" data-act="person" data-name="${esc(p.author)}">${ava(p.author, true, p.species || lorePerson(s, p.author)?.species)}<small>${esc(p.author.split(' ')[0])}</small></button>`).join('')}</div>` : ''}
        <div class="sh-chips">${Object.entries(chips).map(([k, v]) => `<button class="sh-chip ${ui.channel === k ? 'on' : ''}" data-act="channel" data-ch="${k}">${esc(k === 'species' && s.profile.species ? s.profile.species : v)}</button>`).join('')}</div>
        <div class="sh-card sh-compose">
          <textarea id="sh-post" rows="2" placeholder="Что нового, ${esc(s.profile.name)}?"></textarea>
          <div class="sh-row"><select id="sh-post-ch">${Object.entries(CHANNELS).filter(([k]) => k !== 'all').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
          <button class="sh-btn sm" data-act="post">Опубликовать</button></div>
        </div>
        <button class="sh-btn ghost wide" data-act="genFeed"><i class="fa-solid fa-rotate"></i> Обновить ленту</button>
        ${posts.length ? posts.map((p) => postHTML(p, s)).join('') : empty('Здесь пока пусто. Обновите ленту или напишите первый пост.')}`;
    }
    /** Убирает из начала текста @упоминание того, кому отвечают (CityHub ставит его сам). */
    function stripMention(text, name) {
        if (!name) return text;
        const re = new RegExp(`^(\\s*@?${escRe(name)}[,:!]?\\s*)+`, 'i');
        return String(text).replace(re, '').trim() || text;
    }
    function commentHTML(c, p) {
        const to = c.replyTo ? `<span class="sh-at">@${esc(c.replyTo)}</span> ` : '';
        c = { ...c, text: stripMention(c.text, c.replyTo) };
        return `<div class="sh-cmt ${c.replyTo ? 'reply' : ''} ${c.mine ? 'mine' : ''}">${ava(c.author, false, c.mine ? S()?.profile.species : c.species)}
          <div><div class="sh-cmt-b">${c.mine ? `<b>${esc(c.author)}</b>` : nameBtn(c.author, c.species)}<p>${to}${esc(c.text)}</p></div>
          <div class="sh-cmt-a"><span>${fmtT(c.t)}</span>
            <button data-act="cLike" data-post="${p.id}" data-id="${c.id}" class="${c.liked ? 'on' : ''}"><i class="fa-${c.liked ? 'solid' : 'regular'} fa-heart"></i> ${c.likes || 0}</button>
            ${c.mine ? '' : `<button data-act="replyTo" data-name="${esc(c.author)}">Ответить</button>`}</div></div></div>`;
    }
    function postView(s, id) {
        const p = s.feed.find((x) => x.id === id);
        if (!p) return head('Пост') + empty('Пост удалён.');
        if (!p.mine && !p.commentsLoaded && !p.loadingComments) setTimeout(() => ACT.genComments({ id: p.id }, null, s), 0);
        const list = shownComments(p);
        return `${head('Пост', esc(p.author))}${postHTML(p, s, true)}
        <div class="sh-cmts">${list.length ? list.map((c) => commentHTML(c, p)).join('') : ''}
        ${p.loadingComments ? '<div class="sh-sys"><i class="fa-solid fa-ellipsis fa-fade"></i> пишут комментарии…</div>' : ''}
        ${!list.length && !p.loadingComments ? '<div class="sh-sys">Комментариев пока нет.</div>' : ''}</div>
        <div class="sh-composer">
          ${ui.replyTo ? `<div class="sh-replying">Ответ для @${esc(ui.replyTo)} <button data-act="replyTo" data-name="" aria-label="Отменить ответ"><i class="fa-solid fa-xmark"></i></button></div>` : ''}
          <div class="sh-row"><textarea id="sh-cmt" rows="1" placeholder="${ui.replyTo ? `Ответ @${esc(ui.replyTo)}` : 'Комментарий…'}"></textarea><button class="sh-btn sm" data-act="comment" data-id="${p.id}" aria-label="Отправить"><i class="fa-solid fa-paper-plane"></i></button></div>
        </div>`;
    }
    function personView(s, name) {
        const pr = personOf(s, name);
        if (!pr) return meView(s);
        const posts = s.feed.filter((p) => p.author === name);
        return `${head(name)}
        ${(() => { const lp = lorePerson(s, name); return lp ? `<div class="sh-note"><i class="fa-solid fa-book"></i><span>${badge('из лора')} ${esc(lp.bio)}${lp.faculty ? ` · ${esc(lp.faculty)}` : ''}</span></div>` : ''; })()}
        <div class="sh-card sh-person">${ava(name, true, pr.species)}<div><b>${esc(name)}</b>${pr.species ? badge(pr.species) : ''}<small>${kfmt(pr.followers + (pr.following ? 1 : 0))} подписчиков · ${posts.length} постов</small></div></div>
        <div class="sh-row"><button class="sh-btn ${pr.following ? 'ghost' : ''}" data-act="follow" data-name="${esc(name)}">${pr.following ? 'Вы подписаны' : 'Подписаться'}</button>
        <button class="sh-btn ghost" data-act="dm" data-name="${esc(name)}" data-species="${esc(pr.species)}"><i class="fa-regular fa-paper-plane"></i> Личное сообщение</button></div>
        <h4>Публикации</h4>${posts.length ? posts.map((p) => postHTML(p, s)).join('') : empty('Постов в ленте пока нет.')}`;
    }
    function questHTML(q) {
        const rw = [q.r.authority ? `⭐ +${q.r.authority}` : '', q.r.money ? money(q.r.money) : ''].filter(Boolean).join(' · ');
        return `<div class="sh-quest ${q.done ? 'done' : ''}"><i class="fa-solid ${q.done ? 'fa-circle-check' : q.k === 'rp' ? 'fa-book-open' : 'fa-mobile-screen'}"></i>
          <div><b>${esc(q.t)}</b>${q.desc ? `<p>${esc(q.desc)}</p>` : ''}${q.setup && !q.done ? '<small><i class="fa-solid fa-hourglass-half"></i> событие ещё должно случиться в истории</small>' : ''}<small>${q.k === 'rp' ? 'в истории' : `${q.p}/${q.n}`}${rw ? ` · ${rw}` : ''}</small>
          ${q.k === 'rp' && !q.done ? `<button class="sh-btn sm ghost" data-act="checkQuest" data-id="${q.id}"><i class="fa-solid fa-magnifying-glass"></i> Проверить по истории</button>` : ''}</div></div>`;
    }
    function statsBlock(s) {
        const so = soc(s), lv = levelOf(so), x = xpOf(so);
        const lo = LEVELS[lv - 1] ?? 0, hi = LEVELS[lv] ?? lo + 200;
        const pct = clamp(Math.round(((x - lo) / Math.max(1, hi - lo)) * 100), 0, 100);
        const hate = Math.round(so.hate);
        return `<div class="sh-card">
          <div class="sh-lvl"><b>Уровень ${lv}</b><small>${x} / ${hi} авторитета</small></div><div class="sh-bar"><span style="width:${pct}%"></span></div>
          <div class="sh-stats one"><div><b>⭐ ${Math.round(so.authority)}</b><small>авторитет</small></div></div>
          <small>Хейт: ${hate}%${hate >= 50 ? ' — осторожно, при 70% вас «отменят»' : ''}</small><div class="sh-bar"><span class="${hate >= 50 ? 'bad' : hate >= 25 ? 'warn' : ''}" style="width:${hate}%"></span></div>
          ${PERKS[lv + 1] ? `<small>На уровне ${lv + 1}: ${PERKS[lv + 1]}</small>` : ''}
        </div>
        <div class="sh-card"><h4>Задания дня</h4>${so.questsLoading && !so.quests.length ? '<p class="sh-muted"><i class="fa-solid fa-spinner fa-spin"></i> Придумываю задания…</p>' : so.quests.length ? so.quests.map((q) => questHTML(q)).join('') : '<p class="sh-muted">Задания появятся в течение минуты.</p>'}
          ${so.rerollDay !== dkey(NOW()) && so.quests.length ? '<button class="sh-link" data-act="rerollQuests"><i class="fa-solid fa-rotate"></i> Заменить задания (раз в день)</button>' : ''}</div>`;
    }
    function meView(s) {
        const posts = s.feed.filter((p) => p.mine);
        const likes = posts.reduce((a, p) => a + (p.likes || 0), 0);
        return `${head('Мой профиль')}
        <div class="sh-card sh-person">${ava(s.profile.name, true, s.profile.species)}<div><b>${esc(s.profile.name)}</b>${s.profile.privacy.species && s.profile.species ? badge(s.profile.species) : ''}</div></div>
        ${statsBlock(s)}
        <div class="sh-stats"><div><b>${kfmt(s.social.followers)}</b><small>подписчиков</small></div><div><b>${s.social.following.length}</b><small>подписок</small></div><div><b>${posts.length}</b><small>постов</small></div><div><b>${kfmt(likes)}</b><small>лайков</small></div></div>
        ${s.social.following.length ? `<h4>Подписки</h4><div class="sh-stories">${s.social.following.map((n) => `<button class="sh-story" data-act="person" data-name="${esc(n)}">${ava(n, true, personOf(s, n)?.species)}<small>${esc(n.split(' ')[0])}</small></button>`).join('')}</div>` : ''}
        <h4>Мои публикации</h4>${posts.length ? posts.map((p) => postHTML(p, s)).join('') : empty('Опубликуйте первый пост — жители отреагируют в комментариях.')}`;
    }

    /* — чаты — */
    function chatsTab(s) {
        const list = [...s.threads].sort((a, b) => b.t - a.t);
        const typing = (s.pendingDMs || []).map((pd) => `<div class="sh-li static">${ava(pd.from, false, pd.species)}<div><b>${esc(pd.isChar ? (s.threads.find((t) => t.kind === 'char')?.name || pd.from) : pd.from)}</b><small class="sh-typing">✍️ пишет вам…</small></div></div>`).join('');
        return `<h3 class="sh-h">Сообщения <small><i class="fa-solid fa-lock"></i> сквозное шифрование</small></h3>${typing}
        <div class="sh-row sh-card"><input id="sh-newchat" placeholder="Имя человека"><button class="sh-btn sm" data-act="newChat">Написать</button></div>
        ${list.length ? list.map((t) => {
        const last = t.msgs[t.msgs.length - 1];
        return `<button class="sh-li" data-act="go" data-view="thread" data-param="${t.id}">${t.kind === 'official' ? '<span class="sh-ava" style="background:linear-gradient(135deg,#6b4a4f,#8a6168)"><i class="fa-solid fa-building-columns"></i></span>' : t.kind === 'group' ? '<span class="sh-ava" style="background:linear-gradient(135deg,#4f5a75,#6c7897)"><i class="fa-solid fa-users"></i></span>' : ava(t.name, false, t.species)}<div><b>${esc(t.name)}</b> ${t.kind === 'group' ? badge('группа') : t.kind === 'official' ? badge('официально', 'bad') : t.species ? badge(t.species) : ''}<small>${last ? esc((last.me ? 'Вы: ' : '') + last.text).slice(0, 70) : 'Нет сообщений'}</small></div>${t.unread ? `<b class="sh-dot">${t.unread}</b>` : ''}</button>`;
    }).join('') : empty('Диалогов пока нет. Напишите кому-нибудь из ленты или найдите пару в знакомствах.')}`;
    }
    function threadView(s, id) {
        const th = s.threads.find((t) => t.id === id);
        if (!th) return head('Диалог') + empty('Диалог не найден.');
        th.unread = 0;
        if (needsRelSync(s, th)) setTimeout(() => syncRel(s, th).catch((e) => logErr('Отношения', e)), 0);
        const rl = th.relSyncing ? 'определяю отношения…' : relLabel(th), rv = Math.round(th.rel || 0);
        return `${head(th.name, `${th.species ? esc(th.species) + ', ' : ''}<i class="fa-solid fa-lock"></i> зашифровано`)}
        ${th.kind === 'group' || th.kind === 'official' ? '' : `<div class="sh-rel"><div><small>${esc(rl)}${th.beef ? ' · бифф' : ''}${th.kind === 'char' && s.profile.relWithChar && rl !== 'пара' ? ' · вы пара' : ''}${relevantForSync(s, th) && !th.relSyncing ? ` <button class="sh-relsync" data-act="syncRel" data-id="${th.id}" title="${esc(th.relNote || 'Обновить по истории')}" aria-label="Обновить отношения по истории"><i class="fa-solid fa-rotate"></i></button>` : ''}</small><div class="sh-relbar"><span class="${rv < 0 ? 'neg' : ''}" style="width:${Math.abs(rv) / 2}%;${rv < 0 ? 'right:50%' : 'left:50%'}"></span></div></div>
          <button class="sh-btn sm ghost" data-act="go" data-view="meet" data-param="${th.id}"><i class="fa-solid fa-calendar-plus"></i> Встреча</button></div>`}
        ${th.pendingMeet ? `<div class="sh-card sh-pending"><b><i class="fa-solid fa-handshake"></i> Похоже, вы договорились о встрече</b>
          <small>${esc(KINDS[th.pendingMeet.kind])}, ${fmtWhen(th.pendingMeet.at)}, ${esc(PLACES[th.pendingMeet.place])}${th.pendingMeet.note ? ` (${esc(th.pendingMeet.note)})` : ''}</small>
          ${th.pendingMeet.conflict ? `<small class="sh-bad-t"><i class="fa-solid fa-triangle-exclamation"></i> В это время у вас пара «${esc(th.pendingMeet.conflict.subject)}» (${fmtT(th.pendingMeet.conflict.start)}–${fmtT(th.pendingMeet.conflict.end)}).</small>
          <div class="sh-row"><button class="sh-btn sm" data-act="mentionClass" data-id="${th.id}"><i class="fa-regular fa-comment"></i> Написать про пару</button><button class="sh-btn sm ghost" data-act="skipPending" data-id="${th.id}">Прогулять</button></div>` : ''}
          ${th.pendingMeet.problem ? `<small class="sh-bad-t">${esc(th.pendingMeet.problem)}</small>` : ''}
          <div class="sh-row">${th.pendingMeet.problem || th.pendingMeet.conflict ? '' : `<button class="sh-btn sm" data-act="acceptPending" data-id="${th.id}">Добавить встречу</button>`}<button class="sh-btn sm ghost" data-act="go" data-view="meet" data-param="${th.id}">Изменить</button><button class="sh-btn sm ghost" data-act="dropPending" data-id="${th.id}">Нет</button></div></div>` : ''}
        <div class="sh-msgs">${th.msgs.map((m) => m.sys
        ? `<div class="sh-sys">${esc(m.text)}</div>`
        : `<div class="sh-msg ${m.me ? 'me' : ''}">${m.from ? `<b>${esc(m.from)}</b>` : ''}${esc(m.text)}<time>${fmtT(m.t)}</time></div>`).join('')}
        ${th.typing ? `<div class="sh-msg typing">${esc(th.name)} печатает…</div>` : ''}</div>
        <div class="sh-composer"><div class="sh-row"><textarea id="sh-msg" rows="1" placeholder="Сообщение"></textarea><button class="sh-btn sm" data-act="send" data-id="${th.id}" aria-label="Отправить"><i class="fa-solid fa-paper-plane"></i></button></div></div>`;
    }

    /* — знакомства — */
    function datingTab(s) {
        const d = s.dating;
        if (!s.profile.privacy.dating) return `<h3 class="sh-h">Знакомства</h3>${empty('Ваш профиль скрыт из знакомств. Включить можно в профиле, в разделе «Конфиденциальность».')}`;
        return `<h3 class="sh-h">Знакомства <small>только совершеннолетние, профили верифицированы</small></h3>
        <div class="sh-seg"><button class="${d.mode === 'love' ? 'on' : ''}" data-act="dMode" data-mode="love">Свидания</button><button class="${d.mode === 'friends' ? 'on' : ''}" data-act="dMode" data-mode="friends">Друзья</button></div>
        <div class="sh-card sh-form">
          <label>Кого показывать<select id="sh-d-gender"><option value="" ${!d.fGender ? 'selected' : ''}>Всех</option><option value="m" ${d.fGender === 'm' ? 'selected' : ''}>Парней</option><option value="f" ${d.fGender === 'f' ? 'selected' : ''}>Девушек</option><option value="nb" ${d.fGender === 'nb' ? 'selected' : ''}>Небинарных</option></select></label>
          <label>Возраст<select id="sh-d-age"><option value="" ${!d.fAge ? 'selected' : ''}>Любой (18+)</option>${Object.entries(AGE_GROUPS).map(([k, v]) => `<option value="${k}" ${d.fAge === k ? 'selected' : ''}>${v} лет</option>`).join('')}</select></label>
          ${mundane(s) ? '' : `<label>Вид<select id="sh-d-species">${speciesOptions(s, d.fSpecies, 'Любой вид')}</select></label>
          <label>Способности<select id="sh-d-abil">${abilityOptions(s, d.fAbility, 'Любые способности')}</select></label>`}
          <button class="sh-btn" data-act="genDating"><i class="fa-solid fa-wand-magic-sparkles"></i> Подобрать анкеты</button>
        </div>
        ${d.matches.length ? `<h4>Взаимные симпатии</h4><div class="sh-stories">${d.matches.map((m) => `<button class="sh-story" data-act="dm" data-name="${esc(m.name)}" data-species="${esc(m.species)}" data-bio="${esc(m.bio)}">${ava(m.name, true, m.species)}<small>${esc(m.name.split(' ')[0])}</small></button>`).join('')}</div>` : ''}
        ${d.profiles.length ? d.profiles.map((p) => `<article class="sh-card sh-profile">
          <button class="sh-pbtn" data-act="go" data-view="dprofile" data-param="${p.id}"><div class="sh-post-h">${ava(p.name, true, p.species)}<div><b>${esc(p.name)}, ${esc(p.age)}</b>${p.verified ? ' <i class="fa-solid fa-circle-check sh-verified" title="Верифицирован"></i>' : ''}<small>${p.faculty ? badge(p.faculty, 'fac') : ''}</small></div><i class="fa-solid fa-chevron-right sh-pchev"></i></div>
          <p>${esc(p.bio)}</p><small class="sh-link">Открыть анкету</small></button>
          <div class="sh-compat"><span style="width:${clamp(+p.compat || 0, 0, 100)}%"></span></div>
          <small class="sh-muted">${mundane(s) ? 'Совместимость' : 'Совместимость видов'} ${clamp(+p.compat || 0, 0, 100)}%. ${esc(p.compatNote || '')}</small>
          <div class="sh-row"><button class="sh-btn ghost" data-act="dSkip" data-id="${p.id}"><i class="fa-solid fa-xmark"></i> Пропустить</button><button class="sh-btn" data-act="dLike" data-id="${p.id}"><i class="fa-solid fa-heart"></i> Нравится</button></div>
          <button class="sh-link" data-act="dReport" data-id="${p.id}"><i class="fa-solid fa-flag"></i> Пожаловаться и скрыть</button>
        </article>`).join('') : empty('Задайте фильтры и нажмите «Подобрать анкеты».')}`;
    }

    /** Полная анкета знакомств. */
    function dprofileView(s, id) {
        const p = s.dating.profiles.find((x) => x.id === id) || s.dating.matches.find((x) => x.id === id);
        if (!p) return head('Анкета') + empty('Анкета больше недоступна.');
        const row = (ic, label, v) => v ? `<div class="sh-prow"><i class="fa-solid ${ic}"></i><div><small>${label}</small><p>${esc(v)}</p></div></div>` : '';
        return `${head(`${p.name}, ${p.age}`, esc(p.faculty || ''))}
        <div class="sh-card sh-person">${ava(p.name, true, p.species)}<div><b>${esc(p.name)}</b><small>${esc(p.age)} лет${p.faculty ? ` · ${esc(p.faculty)}` : ''}</small>${p.verified ? badge('верифицирован(а)') : ''}</div></div>
        <div class="sh-card">
          ${row('fa-user', 'Внешность', p.looks)}${row('fa-masks-theater', 'Характер', p.character)}${row('fa-briefcase', 'Профессия', p.faculty)}
          ${row('fa-palette', 'Хобби', p.hobbies)}${row('fa-heart', 'Любит', p.likes)}${row('fa-heart-crack', 'Не любит', p.dislikes)}${row('fa-magnifying-glass', 'Ищет в людях', p.seeks)}
          ${row('fa-comment', 'О себе', p.bio)}
        </div>
        <div class="sh-compat"><span style="width:${clamp(+p.compat || 0, 0, 100)}%"></span></div>
        <small class="sh-muted">Совместимость ${clamp(+p.compat || 0, 0, 100)}%. ${esc(p.compatNote || '')}</small>
        ${s.dating.profiles.includes(p) ? `<div class="sh-row"><button class="sh-btn ghost" data-act="dSkip" data-id="${p.id}"><i class="fa-solid fa-xmark"></i> Пропустить</button><button class="sh-btn" data-act="dLike" data-id="${p.id}"><i class="fa-solid fa-heart"></i> ${s.dating.mode === 'friends' ? 'Дружить' : 'Нравится'}</button></div>
        <button class="sh-link" data-act="dReport" data-id="${p.id}"><i class="fa-solid fa-flag"></i> Пожаловаться и скрыть</button>` : ''}`;
    }

    /* — личный кабинет (учёба) — */
    const STUDY_TABS = [['schedule', 'Расписание'], ['tasks', 'Задания'], ['rating', 'Рейтинг'], ['help', 'Помощь']];
    function studyTab(s) {
        const top = `<div class="sh-idcard">
          ${ava(s.profile.name, true, s.profile.species)}
          <div><b>${esc(s.profile.name)}</b><small>${esc(s.profile.profession || '—')}${isStudent(s.profile) && s.profile.faculty ? ` · ${esc(s.profile.faculty)}` : ''}, ${AGE_GROUPS[s.profile.age] || '—'} лет</small>${mundane(s) ? '' : badge(s.profile.species || 'вид не указан')}</div>
          <div class="sh-seal ${rating(s) < 40 ? 'bad' : rating(s) < 70 ? 'warn' : ''}" title="Академический рейтинг"><b>${rating(s)}%</b><small>рейтинг</small></div>
        </div>
        ${s.pausedAt ? '<div class="sh-note warn"><i class="fa-solid fa-pause"></i> Время учёбы на паузе. Пары и дедлайны не идут.</div>' : ''}
        <div class="sh-chips">${STUDY_TABS.map(([k, l]) => `<button class="sh-chip ${ui.studyTab === k ? 'on' : ''}" data-act="studyTab" data-st="${k}">${l}</button>`).join('')}</div>`;
        if (s.expelled) {
            return `${top}<div class="sh-card sh-expelled"><i class="fa-solid fa-handcuffs"></i><h3>Ограничение свободы</h3><p>${esc(s.expelReason)}.</p><p class="sh-muted">Работа, учёба и распорядок недоступны. Когда в истории срок закончится, нажмите «Выйти на свободу»: правонарушения обнулятся, а кошелёк и соцсеть останутся.</p><button class="sh-btn" data-act="reenroll">Выйти на свободу</button></div>`;
        }
        return top + ({ schedule: scheduleView, tasks: tasksView, grades: gradesView, rating: ratingView, help: helpView }[ui.studyTab] || scheduleView)(s);
    }

    function scheduleView(s) {
        const now = NOW();
        const today = (new Date(NOW()).getDay() + 6) % 7;
        const day = ui.schedDay ?? today;
        const monday = new Date(NOW()); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - today);
        const date = new Date(monday); date.setDate(monday.getDate() + day);
        const occ = occurrences(s, date.getTime(), date.getTime() + DAY - 1);
        const early = cfg().checkInEarlyMin * MIN;
        return `<div class="sh-days">${DAYS.map((d, i) => `<button class="${i === day ? 'on' : ''} ${i === today ? 'today' : ''}" data-act="schedDay" data-d="${i}">${d}</button>`).join('')}</div>
        <p class="sh-muted">${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        ${s.meetings.filter((m) => (m.status === 'accepted' || m.status === 'started') && dkey(m.at) === dkey(date.getTime())).map((m) => meetCard(m, true)).join('')}
        ${occ.length ? occ.map((o) => {
        const st = s.attendance[o.key];
        const live = now >= o.start && now < o.end;
        const before = o.start < s.enforceFrom;
        let status = '';
        if (st === 'present') status = badge('присутствовал(а)', 'ok');
        else if (st === 'excused') status = badge('уважительная причина', 'mid');
        else if (st === 'absent') status = badge('прогул', 'bad');
        else if (before) status = badge('до зачисления', 'mid');
        else if (live) status = badge('идёт сейчас', 'live');
        else if (o.end < now) status = badge('ожидает проверки', 'mid');
        const canCheck = !st && !before && now >= o.start - early && now < o.end && !s.pausedAt;
        const canExcuse = !st && !before && now < o.end && !s.excuses[o.key] && !s.pausedAt;
        const canGo = !st && !before && now < o.end && o.start - now < 12 * HOUR;
        return `<div class="sh-card sh-class ${live ? 'live' : ''}">
            <div class="sh-class-t"><b>${o.cl.start}</b><small>${o.cl.end}</small></div>
            <div><b>${esc(o.cl.subject)}</b><small>${esc(o.cl.teacher)}${o.cl.room ? `, ${esc(o.cl.room)}` : ''}</small>${status}
            ${s.excuses[o.key] ? `<small class="sh-muted">Руководство: ${esc(s.excuses[o.key].reply)}</small>` : ''}
            <div class="sh-row">${canGo ? `<button class="sh-btn sm" data-act="goClass" data-key="${o.key}"><i class="fa-solid fa-person-walking"></i> ${TYPE_WORD[typeOf(o.cl)][2]}</button>` : canCheck ? `<button class="sh-btn sm" data-act="checkin" data-key="${o.key}">Отметиться</button>` : ''}${canExcuse ? `<button class="sh-btn sm ghost" data-act="go" data-view="excuse" data-param="${o.key}">Уважительная причина</button>` : ''}</div></div>
          </div>`;
    }).join('') : empty('В этот день пар нет.')}
        <p class="sh-muted">Нажмите «Отправиться…» или отметьтесь за ${cfg().checkInEarlyMin} мин до начала. Пропуск работы или учёбы без уважительной причины — замечание и удержание из дохода; прогулки можно пропускать.</p>
        <button class="sh-link" data-act="regenSchedule"><i class="fa-solid fa-rotate"></i> Составить расписание заново</button>`;
    }
    function excuseView(s, key) {
        const o = findOcc(s, key);
        if (!o) return head('Уважительная причина') + empty('Пара не найдена.');
        return `${head('Уважительная причина', `${esc(o.cl.subject)}, ${fmtD(o.start)}`)}
        <div class="sh-card sh-form"><p class="sh-muted">Причину рассматривает руководство, подать можно один раз. Болезнь, форс-мажор, семейные обстоятельства обычно признаются уважительными, «проспал» — нет.</p>
        <textarea id="sh-excuse" rows="4" placeholder="Опишите причину отсутствия"></textarea>
        <button class="sh-btn" data-act="excuse" data-key="${key}">Отправить руководству</button></div>`;
    }

    function taskRow(t) {
        const cls = t.done ? 'ok' : t.overdue ? 'bad' : t.expired ? 'mid' : t.deadline - NOW() < 3 * HOUR ? 'warn' : '';
        const info = t.done ? `оценка ${t.grade}` : t.expired ? 'истекло' : t.overdue ? 'просрочено, сдайте для исправления' : `осталось ${left(t.deadline)}`;
        return `<button class="sh-li sh-task ${cls}" data-act="go" data-view="task" data-param="${t.id}"><i class="fa-solid ${t.extra ? 'fa-star' : 'fa-book'}"></i><div><b>${esc(t.title)}</b><small>${esc(t.subject)}, ${info}</small></div></button>`;
    }
    function tasksView(s) {
        const pend = s.tasks.filter((t) => !t.done && !t.expired).sort((a, b) => a.deadline - b.deadline);
        const done = s.tasks.filter((t) => t.done || t.expired).sort((a, b) => (b.doneAt || b.deadline) - (a.doneAt || a.deadline)).slice(0, 20);
        const hasExtra = pend.some((t) => t.extra);
        const so = soc(s);
        return `<div class="sh-card"><h4>Задания дня</h4>${so.quests.length ? so.quests.map((q) => questHTML(q)).join('') : '<p class="sh-muted">Задания появятся в течение минуты.</p>'}</div>
        <div class="sh-note"><i class="fa-solid fa-circle-info"></i> Поручения приходят после смен и занятий. Не выполнено вовремя — замечание и удержание из дохода. Сверху — задания дня под вашу жизнь и профессию.</div>
        <h4>Поручения и задания</h4>${pend.length ? pend.map(taskRow).join('') : empty('Все задания сданы.')}
        <button class="sh-btn ghost wide" data-act="extra" ${hasExtra ? 'disabled' : ''}><i class="fa-solid fa-star"></i> ${hasExtra ? 'Доп. задание уже взято' : 'Взять подработку'}</button>
        <p class="sh-muted">Подработка — дополнительное поручение за деньги и авторитет.</p>
        ${done.length ? `<h4>Архив</h4>${done.map(taskRow).join('')}` : ''}`;
    }
    function taskView(s, id) {
        const t = s.tasks.find((x) => x.id === id);
        if (!t) return head('Задание') + empty('Задание не найдено.');
        return `${head(t.title, esc(t.subject))}
        <div class="sh-card"><p>${t.desc ? esc(t.desc) : '<i class="fa-solid fa-spinner fa-spin"></i> Преподаватель формулирует задание…'}</p>
        ${!t.desc ? `<button class="sh-link" data-act="retryTask" data-id="${t.id}">Запросить формулировку ещё раз</button>` : ''}
        <small class="sh-muted">Выдано ${fmtD(t.issued)}. Срок сдачи: ${fmtD(t.deadline)}${!t.done && !t.expired ? ` (${left(t.deadline)})` : ''}.</small></div>
        ${t.done ? `<div class="sh-card"><h4>Ваш ответ</h4><p>${esc(t.answer)}</p><div class="sh-grade g${t.grade}">${t.grade}</div><p>${esc(t.comment)}</p></div>`
        : t.expired ? empty('Срок доп. задания истёк.')
            : `<div class="sh-card sh-form"><textarea id="sh-ans" rows="7" placeholder="Ваш ответ, 3–10 предложений"></textarea>
          ${t.overdue ? '<small class="sh-muted">Срок прошёл: оценка будет не выше 3, но сдача откроет возможность снять нарушение.</small>' : ''}
          <button class="sh-btn" data-act="submit" data-id="${t.id}" ${t.desc ? '' : 'disabled'}>Сдать на проверку</button></div>`}`;
    }
    function gradesView(s) {
        const g = gpa(s);
        const bySubj = {};
        for (const x of s.grades) (bySubj[x.subject] ||= []).push(x.grade);
        return `<div class="sh-card sh-gpa"><b>${g === null ? '—' : g.toFixed(2)}</b><small>средний балл${s.lowGpaSince ? `, ниже порога с ${fmtDay(s.lowGpaSince)}: отчисление через ${left(s.lowGpaSince + cfg().lowGpaDays * DAY)}` : ''}</small></div>
        <div class="sh-card sh-form"><h4>Калькулятор среднего балла</h4><label>Если получу оценки<input id="sh-calc" placeholder="например: 5 4 5"></label><button class="sh-btn sm" data-act="calc">Рассчитать</button><div id="sh-calc-out" class="sh-muted"></div></div>
        ${Object.keys(bySubj).length ? Object.entries(bySubj).map(([sub, arr]) => `<div class="sh-li static"><div><b>${esc(sub)}</b><small>${arr.join(', ')}</small></div><span class="sh-grade sm g${Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)}">${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)}</span></div>`).join('') : empty('Оценок пока нет. Сдавайте задания, чтобы они появились.')}`;
    }
    function ratingView(s) {
        const c = cfg(), act = activeStrikes(s), r = rating(s);
        const qs = s.strikes.filter((k) => k.q === s.quarter.n).reverse();
        return `<div class="sh-card"><div class="sh-bar"><span style="width:${r}%" class="${r < 40 ? 'bad' : r < 70 ? 'warn' : ''}"></span></div>
          <p><b>${r}%</b> — правонарушений на ${strikeSum(s)} из ${c.maxStrikes} баллов. Лёгкие — 1–2 балла, драка — 4, убийство — 10. При ${c.maxStrikes} баллах или рейтинге ниже ${c.lowGpa}% дольше ${c.lowGpaDays} дн. — ограничение свободы.</p>
          <small class="sh-muted">Текущий год: с ${fmtDay(s.quarter.start)} по ${fmtDay(s.quarter.start + yearDays() * DAY)}. В новом году счётчик обнуляется.</small>
          ${s.warnings ? `<small>Замечаний на работе или учёбе: ${s.warnings} (на рейтинг не влияют, но удерживаются из дохода).</small>` : ''}</div>
        <h4>Правонарушения этого года</h4>
        ${qs.length ? qs.map((k) => `<div class="sh-card sh-strike ${k.fixed ? 'fixed' : ''}"><b>${k.fixed ? '<i class="fa-solid fa-check"></i> Погашено' : `<i class="fa-solid fa-triangle-exclamation"></i> Действует · ${k.w || 1} б.`}</b><p>${esc(k.reason)}</p>${k.consequence ? `<small>Последствие: ${esc(k.consequence)}</small>` : ''}<small class="sh-muted">${fmtD(k.t)}</small></div>`).join('') : empty('Правонарушений нет — вы законопослушный житель.')}`;
    }
    // arrive — приходит/приезжает в сцену; contact — пишет в личку
    const SERVICES = {
        taxi: ['Такси', 'arrive', 150, 'Куда едем'], movers: ['Перевозка вещей', 'arrive', 900, 'Что перевезти и куда отвезти'], cleaning: ['Уборка / клининг', 'arrive', 600, 'Квартира, сколько комнат'],
        plumber: ['Сантехник', 'arrive', 500, 'Что случилось'], electric: ['Электрик', 'arrive', 500, 'Что сломалось'], handyman: ['Мастер на час', 'arrive', 400, 'Что починить или собрать'],
        tutor: ['Репетитор', 'contact', 0, 'Предмет и цель'], search: ['Поиск человека', 'contact', 0, 'Кого ищем, приметы'], lawyer: ['Юрист', 'contact', 0, 'Суть вопроса'],
        psych: ['Психолог', 'contact', 0, 'С чем нужна помощь'], nanny: ['Няня', 'contact', 0, 'Возраст ребёнка, когда'], dogs: ['Выгул собак', 'contact', 0, 'Порода, время'],
        repair: ['Ремонт техники', 'contact', 0, 'Что сломалось'], trainer: ['Персональный тренер', 'contact', 0, 'Цель тренировок'],
    };
    /** Услуга «приезжает»: доставка в сцену через 1–2 ответа истории, как у еды. */
    function orderService(s, title, details, price) {
        if (price && !pay(s, price, `Услуга: ${title}`)) { render(); return false; }
        const now = NOW();
        const o = { id: uid(), kind: 'service', title, details: String(details || '').slice(0, 200), price, t: now, eta: now + 30 * MIN, stage: 'cooking' };
        if (gameMode(s)) o.dueReply = (s.replyCount || 0) + (Math.random() < 0.5 ? 1 : 2);
        s.orders.unshift(o);
        toast('success', `${title}: заявка принята${gameMode(s) ? ` — приедут ${o.dueReply - (s.replyCount || 0) === 1 ? 'в следующем сообщении' : 'через одно сообщение'} истории` : ''}.`);
        save(s); render();
        return true;
    }
    function helpView(s) {
        const k = ui.svc || 'taxi', sv = SERVICES[k];
        return `<div class="sh-card sh-form"><h4>Повседневная помощь</h4>
          <label>Что нужно<select id="sh-svc" data-change="svcType">${Object.entries(SERVICES).map(([key, v]) => `<option value="${key}" ${key === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
          <label>${esc(sv[3])}<textarea id="sh-svc-text" rows="2"></textarea></label>
          ${sv[1] === 'arrive' ? `<div class="sh-oline total"><span>Стоимость</span><b>${money(sv[2])}</b></div><small>${k === 'taxi' ? 'Такси подъедет туда, где вы находитесь в истории.' : 'Исполнитель приедет туда, где вы находитесь в истории.'}</small>` : '<small>Исполнитель напишет вам в личку с ценой и условиями.</small>'}
          <button class="sh-btn" data-act="orderSvc">${sv[1] === 'arrive' ? 'Вызвать' : 'Найти исполнителя'}</button></div>`;
    }

    /* — сервисы — */
    function meetView(s, thId) {
        const th = s.threads.find((t) => t.id === thId);
        if (!th) return head('Встреча') + empty('Диалог не найден.');
        const pm = th.pendingMeet;
        const t0 = new Date(NOW()); t0.setHours(0, 0, 0, 0);
        const pmDay = pm ? clamp(Math.round((new Date(pm.at).setHours(0, 0, 0, 0) - t0) / DAY), 0, 6) : 0;
        const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(NOW()); d.setDate(d.getDate() + i); return `<option value="${i}" ${i === pmDay ? 'selected' : ''}>${i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}</option>`; }).join('');
        return `${head(pm ? 'Добавить встречу' : 'Назначить встречу', esc(th.name))}
        ${pm ? `<div class="sh-note important"><i class="fa-solid fa-handshake"></i><span>Поля заполнены по вашей договорённости в переписке. Проверьте и сохраните.</span></div>` : ''}
        <div class="sh-card sh-form">
          <label>Тип<select id="sh-m-kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${pm?.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>День<select id="sh-m-day">${days}</select></label>
          <label>Время<input id="sh-m-time" type="time" value="${pm ? fmtT(pm.at) : '18:00'}"></label>
          <label>Где и когда<select id="sh-m-place">${Object.entries(PLACES).map(([k, v]) => `<option value="${k}" ${pm?.place === k ? 'selected' : ''}>${v[0].toUpperCase()}${v.slice(1)}</option>`).join('')}</select></label>
          <label>Детали<input id="sh-m-note" placeholder="Например: у фонтана, в комнате 214" value="${esc(pm?.note || '')}"></label>
          <p class="sh-muted">Встреча длится около часа. «Вместо пар» засчитывается как прогул. За день до встречи и в сам день придут напоминания, а в назначенное время встреча начнётся в основной истории. Отменить можно до начала.</p>
          ${pm ? `<button class="sh-btn" data-act="proposeMeet" data-id="${th.id}" data-agreed="1"><i class="fa-solid fa-check"></i> Сохранить встречу</button>` : `<button class="sh-btn" data-act="proposeMeet" data-id="${th.id}"><i class="fa-solid fa-paper-plane"></i> Пригласить</button>`}
        </div>`;
    }
    const MEET_ST = { accepted: ['запланирована', 'mid'], started: ['идёт сейчас', 'live'], done: ['состоялась', 'ok'], cancelled: ['отменена', 'mid'], missed: ['пропущена', 'bad'] };
    function meetCard(m, withActions) {
        const [st, cls] = MEET_ST[m.status] || ['', 'mid'];
        return `<div class="sh-card ${m.kind === 'official' ? 'sh-official' : ''}"><b>${m.kind === 'booking' ? `🗓️ ${esc(m.note)}` : m.kind === 'official' ? `🏛️ Вызов: ${esc(m.with)}` : `${esc(KINDS[m.kind])} с ${esc(m.with)}`}</b> ${badge(st, cls)}
          <small>${fmtWhen(m.at)}, ${esc(placeOf(m))}${m.note ? `, ${esc(m.note)}` : ''}</small>${m.kind === 'official' && m.status === 'accepted' ? '<small class="sh-bad-t">Отменить нельзя. Неявка — новое нарушение.</small>' : ''}
          ${m.caught ? `<small class="sh-bad-t">💔 Об этом узнали: ${esc(m.caught)}</small>` : ''}
          ${withActions ? `<div class="sh-row">${m.status === 'accepted' ? `<button class="sh-btn sm" data-act="goMeet" data-id="${m.id}"><i class="fa-solid fa-person-walking"></i> Отправиться на встречу</button>` : ''}${m.status === 'started' ? `<button class="sh-btn sm" data-act="startScene" data-id="${m.id}">Начать сцену в чате</button>` : ''}${m.status === 'accepted' && m.kind !== 'official' ? `<button class="sh-btn sm ghost" data-act="cancelMeet" data-id="${m.id}">Отменить</button>` : ''}</div>` : ''}</div>`;
    }
    function meetingsView(s) {
        const up = s.meetings.filter((m) => m.status === 'accepted' || m.status === 'started').sort((a, b) => a.at - b.at);
        const past = s.meetings.filter((m) => !up.includes(m)).sort((a, b) => b.at - a.at).slice(0, 15);
        return `${head('Встречи')}
        <p class="sh-muted">Встречи назначаются в личных сообщениях кнопкой «Встреча».</p>
        <h4>Предстоящие</h4>${up.length ? up.map((m) => meetCard(m, true)).join('') : empty('Нет запланированных встреч.')}
        ${past.length ? `<h4>Прошедшие</h4>${past.map((m) => meetCard(m, false)).join('')}` : ''}`;
    }
    function clockView(s) {
        const c = cfg(), g = gameMode(s);
        const d = new Date(s.clock.t);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return `${head('Время')}
        <div class="sh-seg"><button class="${g ? 'on' : ''}" data-act="timeMode" data-m="game">Время истории</button><button class="${g ? '' : 'on'}" data-act="timeMode" data-m="real">Реальное время</button></div>
        ${g ? `<div class="sh-card sh-bigclock"><small>Сейчас в истории</small><b>${fmtT(s.clock.t)}</b><span>${new Date(s.clock.t).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span><small>Последнее изменение: ${esc(s.clock.source || '—')}</small></div>
        <div class="sh-grid2"><button class="sh-btn ghost" data-act="clockAdd" data-min="15">+15 мин</button><button class="sh-btn ghost" data-act="clockAdd" data-min="60">+1 час</button><button class="sh-btn ghost" data-act="clockAdd" data-min="180">+3 часа</button><button class="sh-btn ghost" data-act="clockMorning">Следующее утро</button></div>
        <button class="sh-btn wide" data-act="sleep"><i class="fa-solid fa-moon"></i> Лечь спать</button>
        <div class="sh-card sh-form"><h4>Точное время</h4><label>Дата<input id="sh-c-date" type="date" value="${iso}"></label><label>Время<input id="sh-c-time" type="time" value="${fmtT(s.clock.t)}"></label><button class="sh-btn sm ghost" data-act="clockSet">Установить</button></div>
        <div class="sh-card sh-form"><h4>Синхронизация с историей</h4>
          <label class="sh-toggle"><input type="checkbox" data-change="cfgBool" data-k="syncHorae" ${c.syncHorae ? 'checked' : ''}><span>Брать время из Horae</span></label>
          <label class="sh-toggle"><input type="checkbox" data-change="cfgBool" data-k="syncAI" ${c.syncAI ? 'checked' : ''}><span>ИИ определяет время по тексту</span></label>
          <label>Если оба выключены или не сработали — минут за каждый ответ истории<input type="number" min="0" max="120" data-change="cfg" data-k="stepMin" value="${esc(c.stepMin)}"></label>
          <button class="sh-btn sm ghost" data-act="checkHorae"><i class="fa-solid fa-link"></i> Проверить связь с Horae</button>
          <small>Часы идут только вперёд и только когда движется история. Пока вы не играете, пары и дедлайны не наступают.</small></div>`
        : '<div class="sh-note"><i class="fa-solid fa-clock"></i><span>Пары, дедлайны, встречи и задания идут по часам телефона. Подходит, если вы играете синхронно с реальным временем.</span></div>'}`;
    }
    function moreTab(s) {
        const tiles = [['meetings', 'fa-calendar-check', 'Встречи'], ['delivery', 'fa-burger', 'Доставка'], ['market', 'fa-store', 'Маркетплейс'], ['wallet', 'fa-wallet', 'Кошелёк'], ['campus', 'fa-city', 'Город'], ['profile', 'fa-id-badge', 'Профиль'], ['settings', 'fa-sliders', 'Настройки']];
        return `<h3 class="sh-h">Сервисы</h3><div class="sh-tiles">${tiles.map(([v, ic, l]) => `<button data-act="go" data-view="${v}"><i class="fa-solid ${ic}"></i><span>${l}</span></button>`).join('')}</div>
        <button class="sh-btn danger wide" data-act="sos"><i class="fa-solid fa-phone"></i> Экстренный вызов 112</button>`;
    }

    function orderStatus(o, s) {
        if ((o.kind === 'food' || o.kind === 'grocery' || o.kind === 'service') && o.dueReply !== undefined) {
            if (o.stage === 'delivered') return ['Доставлено', 100];
            const leftN = o.dueReply - (s?.replyCount || 0);
            if (leftN >= 2) return ['Готовится — доставят через одно сообщение истории', 30];
            if (leftN === 1) return ['Курьер в пути — доставят в следующем сообщении истории', 70];
            return ['Курьер у вас — доставка в этом ответе истории', 95];
        }
        const p = (NOW() - o.t) / (o.eta - o.t);
        if (p >= 1) return ['Доставлено', 100];
        if (p < 0.3) return [o.kind === 'parcel' ? 'Курьер забирает' : 'Готовится', Math.round(p * 100)];
        return ['Курьер в пути', Math.round(p * 100)];
    }
    /** Разбор свободного заказа: «2 капучино, круассан, пицца маргарита». */
    function parseOrder(s, text, list = s.menu) {
        const stem = (w) => w.toLowerCase().replace(/[«»"'().,!]/g, '').slice(0, 5);
        const words = (t) => String(t).toLowerCase().replace(/[«»"'()]/g, ' ').split(/[\s-]+/).filter((w) => w.length >= 3).map(stem);
        const lines = [], missing = [];
        for (let part of String(text).split(/[,;\n]+/)) {
            part = part.trim();
            if (!part) continue;
            let qty = 1;
            let m = /^(\d+)\s*(шт\.?|x|х|×)?\s+/i.exec(part);
            if (m) { qty = +m[1]; part = part.slice(m[0].length); }
            else if ((m = /\s*(x|х|×)\s*(\d+)\s*$/i.exec(part))) { qty = +m[2]; part = part.slice(0, m.index); }
            qty = clamp(qty, 1, 20);
            const low = part.toLowerCase(), pw = words(part);
            let best = null, bestScore = 0;
            for (const it of list) {
                const t = it.title.toLowerCase();
                let score = t.includes(low) || low.includes(t) ? 10 : 0;
                const tw = words(it.title);
                score += pw.filter((w) => tw.includes(w)).length * 2;
                if (score > bestScore) { bestScore = score; best = it; }
            }
            if (best && bestScore >= Math.min(2, pw.length * 2)) {
                const ex = lines.find((l) => l.item.id === best.id);
                if (ex) ex.qty += qty; else lines.push({ item: best, qty });
            } else missing.push(part);
        }
        return { lines, missing, total: lines.reduce((a, l) => a + l.item.price * l.qty, 0) };
    }
    const deliveryList = (s) => (ui.deliveryTab === 'grocery' ? (s.groceries ||= defaultGroceries(s)) : s.menu);
    function orderPreview(s, text) {
        if (!String(text).trim()) return '';
        const { lines, missing, total } = parseOrder(s, text, deliveryList(s));
        return `${lines.map((l) => `<div class="sh-oline"><span>${l.qty > 1 ? `${l.qty} × ` : ''}${esc(l.item.title)}</span><b>${money(l.item.price * l.qty)}</b></div>`).join('')}
          ${missing.length ? `<small class="sh-bad-t">Нет ${ui.deliveryTab === 'grocery' ? 'в магазине' : 'в меню'}: ${esc(missing.join(', '))}</small><button class="sh-btn sm ghost sh-find" data-act="findMissing"><i class="fa-solid fa-magnifying-glass"></i> Найти под заказ</button>` : ''}
          ${lines.length ? `<div class="sh-oline total"><span>Итого</span><b>${money(total)}</b></div>` : ''}`;
    }
    /** Оформляет заказ еды: доставка в историю через 1–2 ответа (в режиме времени истории). */
    function placeFoodOrder(s, lines, kind = 'food') {
        const total = lines.reduce((a, l) => a + l.item.price * l.qty, 0);
        const title = lines.map((l) => `${l.qty > 1 ? `${l.qty} × ` : ''}${l.item.title}`).join(', ');
        if (!pay(s, total, `${kind === 'grocery' ? 'Продукты' : 'Доставка'}: ${title}`)) { render(); return false; }
        const now = NOW();
        const places = [...new Set(lines.map((l) => l.item.place).filter(Boolean))].join(', ');
        const o = { id: uid(), kind, title, place: places, price: total, t: now, eta: now + (15 + Math.floor(Math.random() * 20)) * MIN, stage: 'cooking' };
        if (gameMode(s)) o.dueReply = (s.replyCount || 0) + (Math.random() < 0.5 ? 1 : 2);
        s.orders.unshift(o);
        questEvent(s, 'order');
        toast('success', `Заказ оформлен: ${title} — ${money(total)}.${gameMode(s) ? ` Доставят ${o.dueReply - (s.replyCount || 0) === 1 ? 'в следующем сообщении' : 'через одно сообщение'} истории.` : ''}`);
        save(s); render();
        return true;
    }
    function deliveryView(s) {
        const grocery = ui.deliveryTab === 'grocery';
        const list = deliveryList(s);
        const cur = grocery ? (ui.gcat || 'all') : ui.diet;
        const tags = [...new Set(list.flatMap((m) => m.tags || []))];
        const items = list.filter((m) => cur === 'all' || (m.tags || []).includes(cur));
        const dishes = grocery ? [...new Set(list.map((g) => g.forDish).filter(Boolean))] : [];
        const act = grocery ? 'gcat' : 'diet', key = grocery ? 'c' : 'diet';
        return `${head('Доставка по городу')}
        <div class="sh-seg"><button class="${grocery ? '' : 'on'}" data-act="dTab" data-t="food"><i class="fa-solid fa-utensils"></i> Готовая еда</button><button class="${grocery ? 'on' : ''}" data-act="dTab" data-t="grocery"><i class="fa-solid fa-basket-shopping"></i> Продукты</button></div>
        <div class="sh-card sh-form"><h4>Свой заказ</h4><textarea id="sh-o-text" rows="2" placeholder="${grocery ? 'Через запятую: листы для лазаньи, 2 томаты, фарш, моцарелла' : 'Через запятую: 2 капучино, круассан, пицца маргарита'}"></textarea><div id="sh-o-prev" class="sh-opreview"></div><button class="sh-btn sm" data-act="orderText">Заказать</button></div>
        ${dishes.length ? `<div class="sh-note"><i class="fa-solid fa-eye"></i><span>Продукты для блюд из истории: ${esc(dishes.join(', '))} — отмечены 👀 и стоят вверху.</span></div>` : ''}
        <div class="sh-chips"><button class="sh-chip ${cur === 'all' ? 'on' : ''}" data-act="${act}" data-${key}="all">Всё</button>${tags.map((t) => `<button class="sh-chip ${cur === t ? 'on' : ''}" data-act="${act}" data-${key}="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        ${items.map((m) => `<div class="sh-li static"><div><b>${esc(m.title)}</b>${m.wishedBy ? badge(`💭 хотел(а) ${m.wishedBy}`, 'fac') : ''}${m.forDish ? badge(`👀 для приготовления блюда: ${m.forDish}`, 'fac') : ''}${m.special ? badge('🔎 под заказ') : ''}<small>${esc(m.place)}. ${(m.tags || []).map((t) => esc(t)).join(', ')}</small></div><button class="sh-btn sm" data-act="order" data-id="${m.id}" data-kind="${grocery ? 'grocery' : 'food'}">${money(m.price)}</button></div>`).join('')}
        <button class="sh-btn ghost wide" data-act="${grocery ? 'genGroceries' : 'genMenu'}"><i class="fa-solid fa-rotate"></i> ${grocery ? 'Обновить продукты' : 'Обновить меню'}</button>
        <div class="sh-card sh-form"><h4>Посылка другому человеку</h4><label>Кому<input id="sh-p-to"></label><label>Что внутри<input id="sh-p-what"></label><button class="sh-btn sm" data-act="parcel">Отправить за ${money(60)}</button></div>
        <h4>Отслеживание</h4>
        ${s.orders.length ? s.orders.slice(0, 15).map((o) => { const [st, p] = orderStatus(o, s); return `<div class="sh-card"><b>${o.kind === 'parcel' ? `📦 Для ${esc(o.to)}: ${esc(o.title)}` : o.kind === 'grocery' ? `🛒 ${esc(o.title)}` : `🍽️ ${esc(o.title)}`}</b><small class="sh-muted">${esc(st)}${o.dueReply === undefined && o.stage !== 'delivered' ? `, прибытие ~${fmtT(o.eta)}` : ''}${o.price ? ` · ${money(o.price)}` : ''}</small><div class="sh-bar"><span style="width:${p}%"></span></div></div>`; }).join('') : empty('Заказов пока нет.')}`;
    }

    function marketView(s) {
        const mt = ui.marketTab;
        const seg = `<div class="sh-seg"><button class="${mt === 'buy' ? 'on' : ''}" data-act="mTab" data-t="buy">Купить</button><button class="${mt === 'sell' ? 'on' : ''}" data-act="mTab" data-t="sell">Продать</button><button class="${mt === 'mine' ? 'on' : ''}" data-act="mTab" data-t="mine">Мои вещи</button></div>`;
        let body = '';
        if (mt === 'buy') {
            const q = (ui.mq || '').toLowerCase().trim();
            const qw = q.split(/[\s,]+/).filter((w) => w.length >= 3).map((w) => w.slice(0, 5));
            const items = s.market.filter((m) => (ui.mcat === 'all' || m.cat === ui.mcat) && (!q || qw.some((w) => m.title.toLowerCase().includes(w))));
            body = `<div class="sh-card sh-form"><h4>Что ищете?</h4><div class="sh-row sh-search"><input id="sh-mk-q" placeholder="Например: игровой ноутбук, словарь японского" value="${esc(ui.mq || '')}"><button class="sh-btn sm" data-act="marketSearch"><i class="fa-solid fa-magnifying-glass"></i></button></div>
              ${q ? `<small>Поиск: «${esc(ui.mq)}» — найдено ${items.length}. <button class="sh-link" data-act="marketFind">Спросить у жителей</button> · <button class="sh-link" data-act="marketClear">сбросить</button></small>` : '<small>Если на маркете этого нет — CityHub найдёт жителей, которые продают или сдают это.</small>'}</div>
            <div class="sh-chips"><button class="sh-chip ${ui.mcat === 'all' ? 'on' : ''}" data-act="mcat" data-c="all">Всё</button>${MARKET_CATS.map((c) => `<button class="sh-chip ${ui.mcat === c ? 'on' : ''}" data-act="mcat" data-c="${c}">${c}</button>`).join('')}</div>
            ${items.map((m) => `<div class="sh-card sh-item"><b>${esc(m.title)}</b>${m.found ? badge('🔎 по запросу') : ''}<small>${esc(m.cat)}. Продавец: ${esc(m.seller)} ★ ${(+m.rating || 0).toFixed(1)} ${m.verified ? '<i class="fa-solid fa-circle-check sh-verified" title="Верифицирован"></i>' : ''}</small>
              <div class="sh-row"><button class="sh-btn sm" data-act="buy" data-id="${m.id}">Купить за ${money(m.price)}</button>${m.rent ? `<button class="sh-btn sm ghost" data-act="rent" data-id="${m.id}">Аренда ${money(m.rent)}/нед</button>` : ''}</div></div>`).join('') || empty(q ? 'Здесь такого нет. Нажмите «Спросить у жителей».' : 'В этой категории ничего нет.')}
            <button class="sh-btn ghost wide" data-act="genMarket"><i class="fa-solid fa-rotate"></i> Новые объявления</button>`;
        } else if (mt === 'sell') {
            body = `<div class="sh-card sh-form"><label>Что продаёте<input id="sh-s-title"></label><label>Категория<select id="sh-s-cat">${MARKET_CATS.map((c) => `<option>${c}</option>`).join('')}</select></label><label>Цена, ₡<input id="sh-s-price" type="number" min="1"></label><button class="sh-btn" data-act="sell">Разместить объявление</button><small class="sh-muted">Комиссия площадки — 5%. Деньги придут, когда найдётся покупатель.</small></div>
            ${s.listings.map((l) => `<div class="sh-li static"><div><b>${esc(l.title)}</b><small>${esc(l.cat)}, ${money(l.price)}</small></div>${badge(l.sold ? 'продано' : 'ждёт покупателя', l.sold ? 'ok' : 'mid')}</div>`).join('')}`;
        } else {
            body = s.inventory.length ? s.inventory.map((i) => `<div class="sh-li static"><div><b>${esc(i.title)}</b><small>${i.rentUntil ? `аренда до ${fmtDay(i.rentUntil)}` : `куплено ${fmtDay(i.t)}`}</small></div></div>`).join('') : empty('Покупок пока нет.');
        }
        return `${head('Маркетплейс', `на счёте ${money(s.wallet.balance)}`)}${seg}${body}`;
    }

    function walletView(s) {
        return `${head('Кошелёк')}
        <div class="sh-card sh-balance"><small>Баланс</small><b>${money(s.wallet.balance)}</b><small class="sh-muted">${incomeName(s.profile)}: ${money(Number(cfg().stipend) || incomeOf(s.profile))} раз в неделю${/зарплат/i.test(incomeName(s.profile)) ? ` — ${s.profile.profession}` : ''}.</small></div>
        <div class="sh-card sh-form"><h4>Перевод</h4><label>Получатель<input id="sh-w-to" list="sh-w-list"></label><datalist id="sh-w-list">${s.threads.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>
        <label>Сумма, ₡<input id="sh-w-sum" type="number" min="1"></label><label>Комментарий<input id="sh-w-note"></label><button class="sh-btn" data-act="transfer">Перевести</button></div>
        <h4>История</h4>
        ${s.wallet.history.length ? s.wallet.history.slice(0, 40).map((h) => `<div class="sh-li static"><div><b>${esc(h.label)}</b><small>${fmtD(h.t)}</small></div><span class="sh-amt ${h.amount >= 0 ? 'in' : 'out'}">${h.amount >= 0 ? '+' : '−'}${money(Math.abs(h.amount))}</span></div>`).join('') : empty('Операций пока нет.')}`;
    }


    /* ───────────────────────── бронирование в городе ───────────────────────── */

    const BK_TYPES = { room: 'Помещение или склад', hotel: 'Номер в отеле', flat: 'Квартира', resort: 'База отдыха', flight: 'Билет на самолёт', photo: 'Фотостудия', car: 'Каршеринг', clothes: 'Одежда', tour: 'Экскурсия', table: 'Столик в ресторане' };
    const BK_ROOMS = ['Переговорная', 'Коворкинг', 'Музыкальная студия', 'Спортзал', 'Банкетный зал', 'Склад (на день)'];
    const RESORT_TYPES = { glamping: ['Глэмпинг', 700], dome: ['Купольный отель', 900], villa: ['Вилла', 1800], castle: ['Замок', 3000], tree: ['Дома на деревьях', 1000], boat: ['Плавучие дома', 1200] };
    const RESORT_LOC = { nature: ['на природе', 1], sea: ['у моря', 1.3], river: ['у реки', 1.1] };
    const HOTEL_STARS = { 3: 600, 4: 1100, 5: 2500 };
    const FLIGHT_CLASS = { econ: ['Эконом', 1], comfort: ['Комфорт', 1.5], business: ['Бизнес', 3], first: ['Первый класс', 6] };
    const CAR_CLASS = { econ: ['Эконом', 250], comfort: ['Комфорт', 400], business: ['Бизнес', 700], premium: ['Премиум', 1100], lux: ['Люкс', 2000], sport: ['Спорткар', 3500] };
    const CLOTHES_TIER = { mass: ['Масс-маркет', 300], mid: ['Средний сегмент', 1200], premium: ['Премиум', 4000], lux: ['Люкс', 15000] };
    const OCCASIONS = ['Свидание', 'День рождения', 'Годовщина', 'Деловой ужин', 'Встреча с друзьями', 'Просто так'];
    const dayOf = (v) => { const [y, m, d] = String(v || '').split('-').map(Number); return y ? new Date(y, m - 1, d).getTime() : NaN; };
    const nightsOf = (a, b) => Math.max(0, Math.round((dayOf(b) - dayOf(a)) / DAY));
    const hashN = (str, lo, hi) => lo + (hash(String(str).toLowerCase()) % (hi - lo + 1));
    const isoDate = (ts) => isoDay(ts);
    /** Считывает форму и возвращает детали брони: цену, описание, время начала или ошибку. */
    function bookingDraft(s) {
        const t = ui.bk || 'room', v = (id) => val(`sh-bk-${id}`);
        const at = (d, hh = 12) => { const x = dayOf(d); return Number.isFinite(x) ? x + hh * HOUR : NaN; };
        const dates = () => { const n = nightsOf(v('in'), v('out')); return n > 0 ? n : 0; };
        switch (t) {
            case 'room': { const when = new Date(v('when')).getTime(); const store = /склад/i.test(v('room')); return { price: store ? 500 : 300, title: `${v('room')}`, start: when, need: !when && 'Выберите дату и время.' }; }
            case 'hotel': { const n = dates(), st = +v('stars') || 3; return { price: n * HOTEL_STARS[st], title: `Отель ${st}★, ${v('city') || 'свой город'}: ${n} ноч.`, start: at(v('in'), 14), end: at(v('out'), 12), need: !n && 'Выберите даты заезда и выезда.' }; }
            case 'flat': {
                const rooms = +v('rooms') || 1, city = v('fcity') === 'other' ? (v('city') || 'другой город') : 'свой город', rent = v('deal') !== 'buy';
                if (rent) { const n = dates(); return { price: n * (300 + 200 * rooms), title: `Аренда квартиры (${rooms === 0 ? 'студия' : `${rooms}-комн.`}), ${city}: ${n} ноч.`, start: at(v('in'), 15), end: at(v('out'), 12), owner: true, need: !n && 'Выберите даты вселения и выселения.' }; }
                return { price: 150000 + rooms * 120000, title: `Покупка квартиры (${rooms === 0 ? 'студия' : `${rooms}-комн.`}), ${city}`, start: NOW() + 2 * DAY, owner: true, buy: true };
            }
            case 'resort': { const n = dates(), ty = RESORT_TYPES[v('rtype')] || RESORT_TYPES.glamping, lo = RESORT_LOC[v('rloc')] || RESORT_LOC.nature; return { price: Math.round(n * ty[1] * lo[1]), title: `База отдыха: ${ty[0]} ${lo[0]}, ${n} ноч.`, start: at(v('in'), 15), end: at(v('out'), 12), owner: true, easy: true, need: !n && 'Выберите даты заезда и выезда.' }; }
            case 'flight': { const cl = FLIGHT_CLASS[v('class')] || FLIGHT_CLASS.econ, dest = v('dest'), back = v('ret'); const base = dest ? hashN(dest, 1500, 8000) : 0; return { price: Math.round(base * cl[1] * (back ? 1.9 : 1)), title: `Авиабилет ${cl[0].toLowerCase()} — ${dest || '…'}${back ? ` (туда ${fmtDay(dayOf(v('dep')))}, обратно ${fmtDay(dayOf(back))})` : ''}`, start: at(v('dep'), 10), need: (!dest && 'Укажите, куда летите.') || (!Number.isFinite(dayOf(v('dep'))) && 'Выберите дату вылета.') }; }
            case 'photo': { const h = clamp(+v('hours') || 1, 1, 8), when = new Date(v('when')).getTime(); return { price: h * 400, title: `Фотостудия на ${h} ч`, start: when, need: !when && 'Выберите дату и время.' }; }
            case 'car': { const n = Math.max(1, dates()), cl = CAR_CLASS[v('cclass')] || CAR_CLASS.econ; return { price: n * cl[1], title: `Каршеринг: ${cl[0].toLowerCase()}, ${n} дн.`, start: at(v('in'), 10), end: at(v('out'), 10), need: !Number.isFinite(dayOf(v('in'))) && 'Выберите даты.' }; }
            case 'clothes': { const ti = CLOTHES_TIER[v('tier')] || CLOTHES_TIER.mass; return { price: ti[1], title: `Бронь одежды (${ti[0].toLowerCase()}): ${v('what') || 'образ'}`, start: at(v('day'), 12), need: !Number.isFinite(dayOf(v('day'))) && 'Выберите дату примерки.' }; }
            case 'tour': { const ppl = clamp(+v('ppl') || 1, 1, 10), where = v('where'); return { price: ppl * (where ? hashN(where, 300, 1500) : 0), title: `Экскурсия: ${where || '…'}, ${ppl} чел.`, start: at(v('day'), 11), need: (!where && 'Укажите, куда экскурсия.') || (!Number.isFinite(dayOf(v('day'))) && 'Выберите дату.') }; }
            case 'table': { const g = clamp(+v('guests') || 2, 1, 20), occ = v('occ') || 'Просто так', when = new Date(v('when')).getTime(); return { price: g * 250 + (/рожд|годовщ/i.test(occ) ? 300 : 0), title: `Столик${v('rest') ? ` в «${v('rest')}»` : ''} на ${g} — ${occ.toLowerCase()}`, start: when, need: !when && 'Выберите дату и время.' }; }
        }
        return { need: 'Выберите тип брони.' };
    }
    function bookingForm(s) {
        const t = ui.bk || 'room';
        const inp = (id, label, type = 'text', extra = '') => `<label>${label}<input id="sh-bk-${id}" type="${type}" data-change="bkCalc" ${extra}></label>`;
        const sel = (id, label, opts) => `<label>${label}<select id="sh-bk-${id}" data-change="bkCalc">${opts}</select></label>`;
        const o = (obj) => Object.entries(obj).map(([k, v]) => `<option value="${k}">${Array.isArray(v) ? v[0] : v}</option>`).join('');
        const dates = (a = 'Заезд', b = 'Выезд') => `<div class="sh-grid2">${inp('in', a, 'date')}${inp('out', b, 'date')}</div>`;
        const f = {
            room: sel('room', 'Помещение', BK_ROOMS.map((r) => `<option>${esc(r)}</option>`).join('')) + inp('when', 'Когда', 'datetime-local'),
            hotel: inp('city', 'Город', 'text', 'placeholder="Свой город"') + sel('stars', 'Отель', '<option value="3">3★ — уютный</option><option value="4">4★ — комфорт</option><option value="5">5★ — роскошь</option>') + dates(),
            flat: sel('fcity', 'Город', '<option value="own">Свой город</option><option value="other">Другой город</option>') + (val('sh-bk-fcity') === 'other' ? inp('city', 'Какой город') : '')
                + sel('deal', 'Сделка', '<option value="rent">Аренда</option><option value="buy">Покупка</option>') + sel('rooms', 'Комнат', '<option value="0">Студия</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5+</option>')
                + (val('sh-bk-deal') === 'buy' ? '' : dates('Вселение', 'Выселение')),
            resort: sel('rtype', 'Какая база', o(RESORT_TYPES)) + sel('rloc', 'Где', o(RESORT_LOC)) + dates(),
            flight: sel('class', 'Класс', o(FLIGHT_CLASS)) + inp('dest', 'Куда', 'text', 'placeholder="Например: Париж"') + `<div class="sh-grid2">${inp('dep', 'Вылет туда', 'date')}${inp('ret', 'Обратно (необяз.)', 'date')}</div>`,
            photo: inp('when', 'Когда', 'datetime-local') + sel('hours', 'Сколько часов', [1, 2, 3, 4].map((h) => `<option>${h}</option>`).join('')),
            car: sel('cclass', 'Класс машины', o(CAR_CLASS)) + dates('С', 'По'),
            clothes: sel('tier', 'Сегмент', o(CLOTHES_TIER)) + inp('what', 'Что нужно', 'text', 'placeholder="Вечернее платье, костюм…"') + inp('day', 'Дата примерки', 'date'),
            tour: inp('where', 'Куда', 'text', 'placeholder="Старый город, музей, горы…"') + inp('day', 'Дата', 'date') + sel('ppl', 'Сколько человек', [1, 2, 3, 4, 5, 6].map((h) => `<option>${h}</option>`).join('')),
            table: inp('rest', 'Ресторан (необяз.)') + sel('occ', 'Повод', OCCASIONS.map((x) => `<option>${x}</option>`).join('')) + inp('when', 'Когда', 'datetime-local') + sel('guests', 'Гостей', [1, 2, 3, 4, 5, 6, 8, 10, 12].map((h) => `<option ${h === 2 ? 'selected' : ''}>${h}</option>`).join('')),
        }[t];
        const dr = byId('sh-bk-type') ? bookingDraft(s) : { price: 0 };
        return `<label>Что бронируем<select id="sh-bk-type" data-change="bkType">${Object.entries(BK_TYPES).map(([k, v]) => `<option value="${k}" ${t === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          ${f}
          <div class="sh-oline total"><span>${dr.owner ? 'Стоимость (после согласия хозяина)' : 'Стоимость'}</span><b>${dr.price ? money(dr.price) : '—'}</b></div>
          <button class="sh-btn sm" data-act="book">${dr.owner ? 'Отправить запрос хозяину' : 'Забронировать'}</button>`;
    }
    const BK_ST = { ok: ['подтверждено', 'ok'], wait: ['на рассмотрении', 'mid'], no: ['отказ', 'bad'] };
    function ticketStatus(t) {
        const age = Date.now() - t.t;
        return age < HOUR ? 'Принято' : age < 6 * HOUR ? 'В работе' : 'Решено';
    }
    function campusView(s) {
        const now = Date.now();
        return `${head('Город')}
        <div class="sh-card"><h4>Мероприятия</h4>${s.events.length ? s.events.map((e) => `<div class="sh-li static"><div><b>${esc(e.title)}</b>${e.lore ? badge('из лора') : ''}<small>${esc(e.when)}, ${esc(e.place)}. ${esc(e.desc)}</small></div><div class="sh-col"><button class="sh-btn sm ${e.going ? '' : 'ghost'}" data-act="rsvp" data-id="${e.id}">${e.going ? 'Иду' : 'Пойду'}</button>${e.going ? `<button class="sh-btn sm" data-act="goEvent" data-id="${e.id}">Отправиться</button>` : ''}</div></div>`).join('') : '<p class="sh-muted">Список пуст.</p>'}
          <div class="sh-row"><button class="sh-btn ghost sm" data-act="genEvents"><i class="fa-solid fa-rotate"></i> Найти мероприятия</button><button class="sh-btn ghost sm" data-act="campusLore"><i class="fa-solid fa-book"></i> Из лора</button></div></div>
        <div class="sh-card"><h4>Клубы по интересам</h4>${clubsOf(s).map((c) => [c, (s.loreClubs || []).includes(c)]).map(([c, fromLore]) => `<div class="sh-li static"><div><b>${esc(c)}</b>${fromLore ? badge('из лора') : ''}${clubDesc(s, c) ? `<small>${esc(clubDesc(s, c))}</small>` : ''}</div><div class="sh-col"><button class="sh-btn sm ${s.clubs.includes(c) ? '' : 'ghost'}" data-act="club" data-c="${esc(c)}">${s.clubs.includes(c) ? 'Участник' : 'Вступить'}</button>${s.clubs.includes(c) ? `<button class="sh-btn sm" data-act="goClub" data-c="${esc(c)}">На занятие</button>` : ''}</div></div>`).join('')}
          <div class="sh-row"><button class="sh-btn ghost sm" data-act="findClubs"><i class="fa-solid fa-rotate"></i> Найти клубы</button><button class="sh-btn ghost sm" data-act="campusLore"><i class="fa-solid fa-book"></i> Из лора</button></div>
          <small>Клубы из лора и те, где вы участник, при обновлении не пропадают.</small></div>
        <div class="sh-card sh-form"><h4>Бронирование</h4>${bookingForm(s)}
          ${s.bookings.slice(0, 8).map((b) => `<div class="sh-li static"><div><b>${esc(b.title || b.room)}</b><small>${b.start || b.at ? fmtD(b.start || b.at) : ''}${b.price ? ` · ${money(b.price)}` : ''}${b.reason ? ` · ${esc(b.reason)}` : ''}</small></div>${badge(...(BK_ST[b.status] || BK_ST.ok))}</div>`).join('')}</div>
        <div class="sh-card sh-form"><h4>Заявки и жалобы</h4><label>Тема<select id="sh-t-type" data-change="idSel" data-other="sh-t-own">${['Техническое обслуживание', 'Жалоба', 'Благоустройство города', 'Вызов сантехника', 'Письмо президенту'].map((x) => `<option>${x}</option>`).join('')}<option value="__other">Другое — своя тема…</option></select></label>
          <div id="sh-t-own" class="sh-other" style="display:none"><input id="sh-t-topic" placeholder="Тема обращения"></div>
          <textarea id="sh-t-text" rows="3" placeholder="Опишите проблему"></textarea><button class="sh-btn sm" data-act="ticket">Отправить</button>
          ${s.tickets.slice(0, 8).map((t) => `<div class="sh-li static"><div><b>${esc(t.type)}</b><small>${esc(t.text).slice(0, 80)}</small></div>${badge(ticketStatus(t), ticketStatus(t) === 'Решено' ? 'ok' : 'mid')}</div>`).join('')}</div>
        <button class="sh-btn danger wide" data-act="sos"><i class="fa-solid fa-phone"></i> Экстренный вызов 112</button>`;
    }

    function profileView(s) {
        const p = s.profile, pr = p.privacy;
        const tog = (k, l) => `<label class="sh-toggle"><input type="checkbox" data-change="privacy" data-k="${k}" ${pr[k] ? 'checked' : ''}><span>${l}</span></label>`;
        return `${head('Профиль')}
        <div class="sh-idcard">${ava(p.name, true, p.species)}<div><b>${esc(p.name)}</b><small>${pr.faculty ? esc(p.profession || '—') : 'профессия скрыта'}, ${AGE_GROUPS[p.age] || '—'} лет</small>${pr.abilities && p.abilities ? badge(p.abilities === NO_ABIL ? 'без способностей' : p.abilities) : ''}${mundane(s) ? '' : pr.species ? badge(p.species || 'вид не указан') : badge('вид скрыт')}</div></div>
        <button class="sh-me" data-act="go" data-view="me"><span class="sh-star">⭐</span><div><b>Авторитет: ${Math.round(soc(s).authority)}</b><small>Уровень ${levelOf(soc(s))} · ${kfmt(soc(s).followers)} подписчиков · задания дня</small></div><i class="fa-solid fa-chevron-right"></i></button>
        <div class="sh-card sh-form">
          <label>Имя<input id="sh-pf-name" value="${esc(p.name)}"></label>
          ${identityFields('sh-pf', p)}
          <label>О себе<textarea id="sh-pf-bio" rows="3">${esc(p.bio)}</textarea></label>
          <button class="sh-btn" data-act="saveProfile">Сохранить профиль</button>
        </div>
        <div class="sh-card"><h4>Конфиденциальность</h4>${mundane(s) ? '' : tog('species', 'Показывать вид')}${tog('faculty', 'Показывать профессию')}${mundane(s) ? '' : tog('abilities', 'Показывать способности')}${tog('dating', 'Участвовать в знакомствах')}</div>
        ${ctx().name2 && !ctx().groupId ? `<div class="sh-card"><h4>Отношения</h4><label class="sh-toggle"><input type="checkbox" data-change="relChar" ${p.relWithChar ? 'checked' : ''}><span>В романтических отношениях с ${esc(ctx().name2)}</span></label><small>Если включено, ${esc(ctx().name2)} может узнать о свиданиях с другими через CityHub.</small></div>` : ''}
        <button class="sh-link" data-act="changeFaculty"><i class="fa-solid fa-right-left"></i> Сменить профессию</button>`;
    }

    const THEMES = {
        pearl: ['Лунный жемчуг', ['#1a1824', '#24212f', '#b9a7ec', '#e3b7c8']],
        forest: ['Туманный лес', ['#151b19', '#1f2724', '#9fcbb0', '#d8c79a']],
        rose: ['Сумеречная роза', ['#1d1619', '#2a2024', '#e0a9b8', '#c9b6e4']],
        ocean: ['Полночный океан', ['#121925', '#1b2433', '#8fc3d6', '#b3a8e0']],
        library: ['Светлая библиотека', ['#f6f2ec', '#ffffff', '#7a6aa8', '#5f8f88']],
        classic: ['Классика', ['#14111f', '#1f1a30', '#f0b44c', '#8f7cf0']],
    };
    function applyTheme() { const ph = document.getElementById('cityhub-phone'); if (ph) ph.dataset.theme = THEMES[cfg().theme] ? cfg().theme : 'pearl'; }
    function settingsView(s) {
        const c = cfg();
        const num = (k, l, step = 1) => `<label>${l}<input type="number" step="${step}" data-change="cfg" data-k="${k}" value="${esc(c[k])}"></label>`;
        return `${head('Настройки')}
        <div class="sh-card"><h4>Оформление</h4><div class="sh-themes">${Object.entries(THEMES).map(([k, [n, sw]]) => `<button class="sh-theme ${(cfg().theme || 'pearl') === k ? 'on' : ''}" data-act="setTheme" data-t="${k}"><div class="sw">${sw.map((x) => `<span style="background:${x}"></span>`).join('')}</div>${n}</button>`).join('')}</div></div>
        ${gameMode(s) ? '<div class="sh-card"><h4>Время учёбы</h4><p class="sh-muted">Включено время истории: пока вы не играете, часы стоят. Управление — нажмите на часы вверху.</p></div>' : ''}
        <div class="sh-card" ${gameMode(s) ? 'style="display:none"' : ''}><h4>Время учёбы</h4><p class="sh-muted">Пары и дедлайны идут по реальному времени. На паузе нарушения не начисляются, а сроки заданий сдвигаются на время паузы.</p>
          <button class="sh-btn ${s.pausedAt ? '' : 'ghost'}" data-act="pause">${s.pausedAt ? `<i class="fa-solid fa-play"></i> Продолжить (на паузе с ${fmtD(s.pausedAt)})` : '<i class="fa-solid fa-pause"></i> Поставить на паузу'}</button></div>
        <div class="sh-card sh-form"><h4>Связь с чатом</h4>
          <label class="sh-toggle"><input type="checkbox" data-change="cfgBool" data-k="inject" ${c.inject ? 'checked' : ''}><span>Передавать статус жителя ИИ</span></label>
          <label class="sh-toggle"><input type="checkbox" data-change="cfgBool" data-k="shareDMs" ${c.shareDMs ? 'checked' : ''}><span>Передавать переписку CityHub в основной чат</span></label>
          ${num('chatContext', 'Сколько сообщений истории помнит персонаж в CityHub')}
          ${num('injectDepth', 'Глубина вставки в чат')}</div>
        <div class="sh-card sh-form"><h4>Правила города</h4>
          ${num('yearMonths', 'Длина года, месяцев')}${num('maxStrikes', 'Правонарушений до ограничения свободы (баллов)')}${num('lowGpa', 'Порог низкого рейтинга, %')}${num('lowGpaDays', 'Дней с низким рейтингом до ограничения свободы')}
          ${num('checkInEarlyMin', 'Отметка до начала работы / учёбы / прогулки, мин')}${num('deadlineOffsetMin', 'Срок поручения до следующей смены, мин')}${num('extraTaskHours', 'Срок доп. задания, ч')}
          ${num('stipend', `${incomeName(s.profile)} в неделю, ₡ (0 — по профессии: ${money(incomeOf(s.profile))})`)}${num('startBalance', 'Стартовый баланс (новые чаты), ₡')}
          <label class="sh-toggle"><input type="checkbox" data-change="cfgBool" data-k="crimeScan" ${c.crimeScan ? 'checked' : ''}><span>Следить за правонарушениями в истории</span></label></div>
        <button class="sh-btn ghost wide" data-act="go" data-view="log"><i class="fa-solid fa-bug"></i> Журнал ошибок (${LOG.length})</button>
        <div class="sh-card"><h4>Люди из лора</h4>
          ${lorePeople(s).length ? lorePeople(s).map((p) => `<div class="sh-li static">${ava(p.name, false, p.species)}<div><b>${esc(p.name)}</b><small>${esc([p.age ? `${p.age} лет` : '', p.faculty].filter(Boolean).join(', '))}</small></div></div>`).join('') : '<p class="sh-muted">Жители из лорбука и карточки ещё не найдены.</p>'}
          ${lorePeople(s, 'minor').length ? `<small>Несовершеннолетние: ${esc(lorePeople(s, 'minor').map((p) => p.name).join(', '))}</small>` : ''}
          <small>В CityHub есть все жители из лора — родители, коллеги, соседи. Несовершеннолетние в знакомства не попадают.</small>
          <button class="sh-btn sm ghost" data-act="refreshLorePeople"><i class="fa-solid fa-rotate"></i> Обновить из лора</button></div>
        <div class="sh-card sh-form"><h4>Мастер игры</h4><label>Установить баланс, ₡<input id="sh-gm-bal" type="number" value="${esc(s.wallet.balance)}"></label><button class="sh-btn sm ghost" data-act="gmBalance">Применить</button>
          <button class="sh-btn sm danger" data-act="resetChat">Сбросить данные CityHub в этом чате</button></div>`;
    }

    function logText() {
        const c = ctx();
        const head = `CityHub 1.15.2 | ${navigator.userAgent} | API: ${c.mainApi || c.main_api || '?'} | generateRaw: ${typeof c.generateRaw} | loadWorldInfo: ${typeof c.loadWorldInfo} | setExtensionPrompt: ${typeof c.setExtensionPrompt}`;
        return [head, ...LOG.map((l) => `[${fmtD(l.t)}] ${l.where}: ${l.text}`)].join('\n\n');
    }
    function logView() {
        return `${head('Журнал ошибок', `записей: ${LOG.length}`)}
        <div class="sh-card"><p class="sh-muted">Если что-то не работает: нажмите «Скопировать» и пришлите текст. Если кнопка не сработает — зажмите текст пальцем, «Выделить всё» и «Копировать».</p>
        <textarea id="sh-log" rows="14" readonly>${esc(logText())}</textarea>
        <div class="sh-row"><button class="sh-btn sm" data-act="copyLog"><i class="fa-solid fa-copy"></i> Скопировать</button><button class="sh-btn sm ghost" data-act="clearLog">Очистить</button></div></div>`;
    }

    function notesView(s) {
        const html = `${head('Уведомления')}${s.notes.length ? s.notes.map((n) => n.go
        ? `<button class="sh-note sh-wide ${n.type} ${n.read ? 'read' : ''}" data-act="openNote" data-id="${n.id}"><span>${esc(n.text)}</span><small>${fmtD(n.t)} <i class="fa-solid fa-chevron-right"></i></small></button>`
        : `<div class="sh-note ${n.type} ${n.read ? 'read' : ''}"><span>${esc(n.text)}</span><small>${fmtD(n.t)}</small></div>`).join('') : empty('Уведомлений нет.')}`;
        let changed = false;
        for (const n of s.notes) if (!n.read) { n.read = true; changed = true; }
        if (changed) setTimeout(() => { save(s); render(); }, 0);
        return html;
    }

    const TABS = { feed: feedTab, chats: chatsTab, dating: datingTab, study: studyTab, more: moreTab };
    const VIEWS = {
        dprofile: dprofileView, post: postView, person: personView, me: meView, meet: meetView, meetings: meetingsView, clock: clockView,
        thread: threadView, excuse: excuseView, task: taskView, delivery: deliveryView, market: marketView,
        wallet: walletView, campus: campusView, profile: profileView, settings: settingsView, notes: notesView,
    };

    /* ───────────────────────── рендер ───────────────────────── */

    function updateFab() {
        const fab = null;
        if (!fab) return;
        fab.style.display = cfg().showFab && !ui.open ? 'flex' : 'none';
        const s = S();
        const n = s ? s.notes.filter((x) => !x.read).length + s.threads.reduce((a, t) => a + (t.unread || 0), 0) : 0;
        const b = fab.querySelector('.sh-fab-badge');
        b.textContent = n ? String(Math.min(n, 99)) : '';
        b.style.display = n ? '' : 'none';
    }

    let styleDiagDone = false;
    function styleDiag() {
        if (styleDiagDone) return;
        const root = document.getElementById('cityhub-phone');
        const sel = root?.querySelector('select'), ta = root?.querySelector('textarea'), cb = root?.querySelector('.sh-toggle input');
        if (!sel && !ta && !cb) return;
        styleDiagDone = true;
        const pick = (el, pseudo) => { if (!el) return '—'; const c = getComputedStyle(el, pseudo || null); return `bg=${c.backgroundColor} img=${c.backgroundImage.slice(0, 40)} op=${c.opacity} filter=${c.filter} shadow=${c.boxShadow.slice(0, 40)} blend=${c.mixBlendMode} appearance=${c.appearance || c.webkitAppearance}${pseudo ? ` content=${c.content}` : ''}`; };
        logErr('Стили (диагностика темы)', `select: ${pick(sel)} | textarea: ${pick(ta)} | toggle: ${pick(cb)} | toggle::after: ${pick(cb, '::after')} | toggle::before: ${pick(cb, '::before')} | label::before: ${pick(cb?.parentElement, '::before')}`);
    }
    function render() {
        updateFab();
        const ph = byId('cityhub-phone');
        if (!ph || !ui.open) return;
        const scr = ph.querySelector('.sh-screen');
        const key = [ui.tab, ui.view, ui.param, ui.studyTab, ui.marketTab].join('|');
        const saved = {};
        scr.querySelectorAll('input[id], textarea[id], select[id]').forEach((el) => { saved[el.id] = el.value; });
        const focusId = document.activeElement && scr.contains(document.activeElement) ? document.activeElement.id : null;
        const top = scr.scrollTop;

        ph.querySelector('.sh-status').innerHTML = statusBar();
        scr.innerHTML = screenHTML();
        ph.querySelector('.sh-nav').innerHTML = navHTML();
        ph.querySelector('.sh-overlay').innerHTML = ui.busy ? `<div class="sh-busy"><i class="fa-solid fa-spinner fa-spin"></i><span>${esc(ui.busy)}</span></div>` : '';

        if (key === lastKey) {
            for (const [id, v] of Object.entries(saved)) { const el = byId(id); if (el && scr.contains(el)) el.value = v; }
            scr.scrollTop = top;
            if (focusId) byId(focusId)?.focus();
        } else scr.scrollTop = 0;
        if (ui.view === 'thread') scr.scrollTop = scr.scrollHeight;
        const ot = byId('sh-o-text'), op = byId('sh-o-prev');
        if (ot && op && ot.value) { const s0 = S(); if (s0) op.innerHTML = orderPreview(s0, ot.value); }
        if (ui.view === 'profile' || ui.view === 'settings') setTimeout(() => { try { styleDiag(); } catch { /* нет getComputedStyle */ } }, 300);
        lastKey = key;
    }
    function isTyping() {
        const a = document.activeElement;
        const ph = byId('cityhub-phone');
        return !!(ph && a && ph.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName));
    }

    /* ───────────────────────── действия ───────────────────────── */

    function openThread(s, name, species = '', bio = '', kind = 'dm') {
        name = String(name).trim();
        let th = s.threads.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (!th) {
            const lp = lorePerson(s, name);
            th = { id: uid(), name, species: species || lp?.species || '', bio: [bio, lp ? `${lp.bio}${lp.abilities ? ` Способности: ${lp.abilities}.` : ''}${lp.relation ? ` Для ${ctx().name2}: ${lp.relation}.` : ''}` : ''].filter(Boolean).join(' '), kind, msgs: [], t: Date.now(), unread: 0 };
            s.threads.unshift(th);
        }
        ui.view = 'thread'; ui.param = th.id;
        save(s);
        return th;
    }

    /** Договорённость о встрече, распознанная в переписке. */
    function detectMeet(s, th, mt) {
        const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(mt.date || '').trim());
        const tm = /^(\d{1,2}):(\d{2})$/.exec(String(mt.time || '').trim());
        if (!dm || !tm) return;
        const at = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]).getTime();
        if (!(at > NOW()) || at > NOW() + 7 * DAY) return;
        if (s.meetings.some((m) => m.threadId === th.id && (m.status === 'accepted' || m.status === 'started') && Math.abs(m.at - at) < 2 * HOUR)) return;
        const key = `${isoDay(at)} ${fmtT(at)}`;
        if ((th.dismissedMeets || []).includes(key)) return;
        let place = PLACES[mt.place] ? mt.place : 'after';
        const ov = occurrences(s, at - 3 * HOUR, at + HOUR).find((o) => o.start < at + HOUR && o.end > at);
        if (!ov && place === 'skip') place = 'after';
        th.pendingMeet = { at, key, kind: KINDS[mt.kind] ? mt.kind : 'friends', place, note: cleanMsg(mt.note || '').slice(0, 80), problem: '' };
        if (ov && place !== 'skip') th.pendingMeet.conflict = { subject: ov.cl.subject, start: ov.start, end: ov.end };
        else th.pendingMeet.problem = meetProblem(s, at, place);
        if (!(ui.open && ui.view === 'thread' && ui.param === th.id)) notify(s, `🤝 Похоже, вы договорились с ${th.name} о встрече ${fmtWhen(at)}. Подтвердите в чате.`, 'important', { view: 'thread', param: th.id });
    }
    async function reply(s, th, opts = {}) {
        th.typing = true; render();
        const hist = th.msgs.filter((m) => !m.sys).slice(-14).map((m) => `${m.me ? s.profile.name : (m.from || th.name)}: ${m.text}`).join('\n');
        let extra = '';
        if (th.kind === 'char') {
            const story = recentStory(Number(cfg().chatContext) || 0);
            const lore = await loreFor(`${story}\n${hist}`);
            const scene = currentScene();
            extra = `\n\n${charCard()}${lore ? `\n\nЛор мира, связанный с разговором:\n${lore}` : ''}${story ? `\n\nПоследние события основной истории (${th.name} их помнит):\n${story}` : ''}${scene ? `\n\n=== ТЕКУЩИЙ МОМЕНТ ИСТОРИИ (самое важное) ===\n${scene}\n=== конец ===\nПереписка происходит ПРЯМО СЕЙЧАС, в этот самый момент истории. Строго соблюдай его: где находится ${th.name}, что делает, рядом ли ${s.profile.name}, время суток. Нельзя противоречить сцене — например, писать «я на патруле», если в сцене ${th.name} стоит у двери ${s.profile.name}. Если они сейчас рядом, ${th.name} может удивиться сообщению («я же прямо за дверью»), ответить вслух или написать с учётом этого.` : ''}`;
        }
        const who = th.kind === 'group'
            ? `участников учебной группы «${th.name}» (${th.bio}). Пиши от лица одного из участников в формате "Имя: текст".`
            : th.kind === 'char'
                ? `${th.name} — персонажа текущей истории. Строго сохраняй его характер, отношение к ${s.profile.name}, манеру речи и словечки из карточки и примеров; учитывай события истории. Пиши так, как этот персонаж писал бы в мессенджере.`
                : `${th.name}${th.species ? ` (вид: ${th.species})` : ''}${th.bio ? `. О себе: ${th.bio}` : ''}`;
        const relTxt = th.kind === 'group' ? '' : `\nОтношение ${th.name} к ${s.profile.name}: ${relLabel(th)} (${Math.round(th.rel || 0)} из 100, шкала от −100 вражда до 100 близость).${th.relNote ? ` ${th.relNote}` : ''}${relLabel(th) === 'не знакомы' ? ` Они не знакомы — ${th.name} пишет как незнакомому человеку.` : ''}${th.kind === 'char' && s.profile.relWithChar ? ` ${th.name} и ${s.profile.name} — пара.` : ''}${jealousNote(s, th)}`;
        const raw = await aiRaw(`${world(s)}${extra}${relTxt}\n\nЭто переписка в защищённом мессенджере CityHub. Ты отвечаешь за ${who}\n\nИстория переписки:\n${hist || '(переписки ещё не было)'}\n\n${opts.initiate ? `${opts.initiate}\n\n` : ''}Напиши следующее сообщение собеседника: 1–3 предложения, живо, в стиле мессенджера, по-русски. Реагируй на вид и способности ${s.profile.name} по правилам выше — особенно в начале знакомства, но не в каждом сообщении. Отношения развиваются естественно: грубость портит, забота, юмор и флирт сближают; возможны дружба, роман или вражда.${th.kind === 'group' ? '' : `\nСейчас ${new Date(NOW()).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} (сегодня ${isoDay(NOW())}).\nОтветь JSON: {"reply":"текст сообщения","delta":число от −6 до 6 — как последнее сообщение ${s.profile.name} изменило отношение,"flirt":true если в переписке сейчас флирт, иначе false,"meet":null}\nПоле meet заполняй, ТОЛЬКО если с учётом твоего ответа вы с ${s.profile.name} явно договорились встретиться и понятны день и время: {"date":"ГГГГ-ММ-ДД","time":"ЧЧ:ММ","kind":"date — свидание, friends — дружеская встреча, study — учёба","place":"break — на перемене, after — после пар, skip — вместо пар, dorm — в общежитии, cafe — в кафе города, city — в городе","note":"где именно, коротко"}. Если лишь обсуждаете или время не названо — null.\nЕсли ${s.profile.name} говорит, что в назначенное время у неё/него пара, отреагируй строго в характере персонажа: кто-то подначивает прогулять («да брось, одна пара ничего не решит»), кто-то сразу соглашается перенести и предлагает другое время, кто-то обижается или ворчит. Заполняй meet только когда договорённость снова окончательная: новое время, либо прежнее с place "skip", если ${s.profile.name} согласился(ась) прогулять.`}`);
        th.typing = false;
        if (S() !== s) return;
        const js = th.kind === 'group' ? null : parseJSON(raw);
        let r = cleanReply(js && typeof js.reply === 'string' ? js.reply : raw).replace(/^["«]+|["»]+$/g, '');
        const lastMine = [...th.msgs].reverse().find((m) => m.me);
        if (js && th.kind !== 'group') updateRel(s, th, Number(js.delta) || 0, js.flirt === true || js.flirt === 'true', 8, lastMine ? `переписка в CityHub: ${s.profile.name} написал(а) «${lastMine.text.slice(0, 140)}»` : '');
        if (js?.meet && typeof js.meet === 'object') detectMeet(s, th, js.meet);
        if (r) {
            let from;
            if (th.kind === 'group') { const m = r.match(/^\s*[*_]{0,2}([^:*_\n]{2,30})[*_]{0,2}\s*:\s*[*_]{0,2}\s*/); if (m) { from = m[1].trim(); r = r.slice(m[0].length); } }
            else r = r.replace(new RegExp(`^\\s*[*_]{0,2}${escRe(th.name)}[*_]{0,2}\\s*:?\\s*[*_]{0,2}\\s*`, 'i'), '');
            r = r.replace(/^\s*(\*\*|__)[^*_\n]{1,60}(\*\*|__)\s*:?\s*\n+/, '').replace(/^\s*[A-Za-zА-Яа-яЁё][^:\n]{0,40}:\s*\n+/, '');
            r = cleanMsg(r);
            th.msgs.push({ me: false, from, text: r, t: Date.now() });
            th.t = Date.now();
            if (!(ui.open && ui.view === 'thread' && ui.param === th.id)) { th.unread = (th.unread || 0) + 1; toast('info', `${th.name}: ${r.slice(0, 80)}`); notify(s, `💬 ${th.name}: ${r.slice(0, 70)}`, 'social', { view: 'thread', param: th.id }); }
        } else th.msgs.push({ sys: true, text: 'Сообщение не доставлено: ИИ не ответил. Попробуйте ещё раз.', t: Date.now() });
        save(s); render();
    }

    function cleanName(t) { return String(t || '').replace(/[*_`@]/g, '').trim().slice(0, 50); }
    function cleanMsg(t) { return cleanReply(t).replace(/\*\*|__/g, '').trim(); }
    /** Генерирует комментарии к посту с учётом уже написанных. */
    async function aiComments(s, p, task, scoreWhat) {
        const prev = shownComments(p).slice(-12).map((c) => `${c.author}${c.replyTo ? ` → ${c.replyTo}` : ''}: ${c.text}`).join('\n');
        const st = p.story ? s.stories.find((x) => x.title === p.story) : null;
        const ctxLines = [
            st ? `Пост — часть сюжетной линии «${st.title}» (участники: ${st.cast.join(', ')}): ${st.summary}` : '',
            p.mine && cancelled(s) ? `Сейчас ${s.profile.name} «отменяют» в сети: большинство комментаторов настроены враждебно, лишь пара человек заступается.` : '',
        ].filter(Boolean).join('\n');
        const scoreFmt = scoreWhat ? `\nТакже оцени ${scoreWhat} ${s.profile.name}: authority (−5…5 — насколько это подняло авторитет ${s.profile.name}: остроумие, смелость, поддержка, интересная мысль — плюс; грубость, кринж, глупость — минус), controversy (0…10 — насколько спорно или токсично), sentiment (positive, mixed или negative — как восприняло сообщество). Реакция комментаторов должна соответствовать оценке.\nЕсли кто-то из комментаторов пообещал написать ${s.profile.name} в личку, начал договариваться с ней/ним о встрече или явно хочет продолжить разговор наедине — заполни followup: {"from":"имя этого комментатора","is_char":true если это ${ctx().name2} — персонаж основной истории, иначе false,"intent":"что он(а) напишет в личке — например, уточнит день, время и место встречи"}. Иначе followup: null.` : '';
        const r = await aiJSON(`${world(s)}\n\nЛента соцсети CityHub. Пост от ${p.author}${p.species ? ` (${p.species})` : ''}${p.mine ? ` — это ${s.profile.name}, пользователь; комментаторы реагируют и на сам пост, и на автора по правилам выше` : ''}:\n«${p.text}»${p.media ? `\n[вложение: ${p.media}]` : ''}\n${prev ? `\nУже есть комментарии:\n${prev}\n` : ''}${ctxLines ? `\n${ctxLines}\n` : ''}${loreStudentsLine(s, 8)}\n${task}\nКомментарии живые, как в настоящей соцсети: коротко, эмоционально, с эмодзи и сленгом, у каждого свой характер. Всё на русском, виды тоже на русском. Не повторяй уже написанное.${scoreFmt}\nФормат: ${scoreWhat ? '{"comments":[' : '['}{"author":"Имя","species":"вид","text":"до 200 символов","replyTo":"имя или пустая строка","likes":3}]${scoreWhat ? ',"score":{"authority":1,"controversy":0,"sentiment":"positive"},"followup":null}' : ''}`);
        const arr = Array.isArray(r) ? r : (Array.isArray(r?.comments) ? r.comments : []);
        const list = arr.filter((c) => c && c.author && c.text && cleanName(c.author) !== s.profile.name).slice(0, 8).map((c) => ({
            id: uid(), author: cleanName(c.author), species: SP(s, c.species), text: stripMention(cleanMsg(c.text), cleanName(c.replyTo)).slice(0, 400),
            replyTo: cleanName(c.replyTo), likes: Math.max(0, parseInt(c.likes, 10) || 0), liked: false,
        }));
        list.score = r && !Array.isArray(r) ? r.score : null;
        list.followup = r && !Array.isArray(r) && r.followup && typeof r.followup === 'object' && r.followup.from ? r.followup : null;
        return list;
    }
    /** Кто-то из ленты решил написать в личку — сообщение придёт через 1–2,5 минуты. */
    function scheduleDM(s, fu, species, context) {
        const from = cleanName(fu.from);
        if (!from || from === s.profile.name) return;
        s.pendingDMs ||= [];
        const isChar = fu.is_char === true || fu.is_char === 'true' || looksLikeChar(from);
        if (s.pendingDMs.some((x) => x.from === from || (isChar && x.isChar))) return;
        s.pendingDMs.push({ id: uid(), at: Date.now() + (30 + Math.floor(Math.random() * 60)) * 1000, from, species: species || '', isChar, intent: cleanMsg(fu.intent || '').slice(0, 300), context: String(context || '').slice(0, 900) });
    }
    const ASK_DM = /(напиш|пиши|жду|черкан|стукн|маякн).{0,25}(в\s*)?(личк|лс|личн|директ|dm)|в\s*(личку|лс|личные|директ)/i;
    const PROMISE_DM = /(напишу|пишу|кину|скину|отпишу|стукну|жди).{0,40}(личк|лс|личн|директ|dm)|в\s*(личку|лс|личные)\s*(напишу|пишу|кину|скину)/i;
    /** Похоже ли имя из ленты на персонажа основной истории. */
    function looksLikeChar(name) {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        const first = String(name || '').toLowerCase().split(/\s+/)[0];
        if (!first || first.length < 3) return false;
        const hay = `${c.name2} ${field(ch, 'description')} ${field(ch, 'personality')}`.toLowerCase();
        return hay.includes(first);
    }
    /** Резервное распознавание, если ИИ не отметил followup. */
    function guessFollowup(s, p, myText, replyTo, list) {
        const promise = list.find((c) => (c.replyTo === s.profile.name || c.text.includes(`@${s.profile.name}`)) && PROMISE_DM.test(c.text));
        if (promise) return { from: promise.author, is_char: looksLikeChar(promise.author), intent: 'продолжить разговор из комментариев, как обещал(а)' };
        if (myText && ASK_DM.test(myText)) {
            const target = replyTo || (!p.mine ? p.author : '');
            if (target) return { from: target, is_char: looksLikeChar(target), intent: `${s.profile.name} попросил(а) написать в личку — продолжить разговор` };
        }
        return null;
    }
    function startDM(s, pd) {
        let th;
        if (pd.isChar) {
            th = s.threads.find((t) => t.kind === 'char');
            const c = ctx();
            if (!th && c.name2 && !c.groupId) { th = { id: uid(), name: c.name2, species: '', bio: '', kind: 'char', msgs: [], t: Date.now(), unread: 0, rel: 0 }; s.threads.push(th); }
        }
        if (!th) {
            th = s.threads.find((t) => t.name.toLowerCase() === pd.from.toLowerCase());
            if (!th) { th = { id: uid(), name: pd.from, species: pd.species, bio: '', kind: 'dm', msgs: [], t: Date.now(), unread: 0, rel: 10 }; s.threads.unshift(th); }
        }
        if (th.typing) return false;
        reply(s, th, { initiate: `${th.name} сам(а) пишет ${s.profile.name} первым(ой) в личку — продолжение разговора в комментариях ленты:\n${pd.context}\nЦель сообщения: ${pd.intent || 'продолжить разговор наедине'}. Если в комментариях договаривались встретиться — предложи или уточни конкретные день, время и место.` });
        return true;
    }
    /** Реакция аудитории на пост пользователя: комментарии приходят постепенно, растут лайки и подписчики. */
    function engageMyPost(s, p) {
        enqueue(s, async () => {
            const list = await aiComments(s, p, 'Сгенерируй 5–7 комментариев от разных жителей, которые увидели этот пост. Иногда они отвечают друг другу (replyTo).', 'этот пост');
            applyScore(s, list.score, p);
            if (list.followup) scheduleDM(s, list.followup, list.find((c) => c.author === cleanName(list.followup.from))?.species, `Пост ${s.profile.name}: «${p.text.slice(0, 200)}»\n${list.map((c) => `${c.author}: ${c.text}`).join('\n')}`);
            const now = Date.now();
            let at = now;
            for (const c of list) { at += (40 + Math.floor(Math.random() * 90)) * 1000; p.comments.push({ ...c, t: at, at }); }
        });
    }
    function fillChatInput(text) {
        const ta = byId('send_textarea');
        if (!ta) return;
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
    }

    const ACT = {
        close: () => toggle(false),
        tab: (d) => { ui.tab = d.tab; ui.view = null; ui.param = null; render(); },
        go: (d) => { ui.view = d.view || null; ui.param = d.param || null; ui.replyTo = ''; render(); },
        back: () => { ui.view = null; ui.param = null; render(); },
        copyLog: async () => {
            const ta = byId('sh-log');
            try { await navigator.clipboard.writeText(logText()); toast('success', 'Журнал скопирован.'); }
            catch { if (ta) { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('success', 'Журнал скопирован.'); } catch { toast('info', 'Зажмите текст пальцем и скопируйте вручную.'); } } }
        },
        clearLog: () => { LOG.length = 0; render(); },

        /* вход */
        refreshLorePeople: (d, el, s) => withBusy('Читаю лорбук и карточку…', async () => {
            const n = await extractLorePeople(s);
            toast(n ? 'success' : 'info', n ? `Найдено жителей: ${n}` : 'В лоре не нашлось персонажей.');
        }),
        loadAbilities: (d, el, s) => {
            if (d.pre === 'sh-a') readAuth(s);
            return withBusy('Ищу способности в лоре…', async () => {
                const lore = await loreText(/способн|сил[аы]|магия|дар|ability|power|skill|магич|чары|заклин/i);
                const r = await aiJSON(`${world(s)}\n\nЛор (лорбук и карточка):\n${lore || '(нет данных)'}\n\nВыпиши сверхъестественные способности, которые упоминаются в этом мире (в лоре, описании персонажа, сценарии). Только реально упомянутые, названия по-русски. visible — заметна ли способность окружающим со стороны (крылья, огонь в руках — да; телепатия — нет). Если ничего нет — пустой массив.\nФормат: [{"name":"способность","visible":false}]`);
                const list = (Array.isArray(r) ? r : []).map((x) => typeof x === 'string' ? { n: cleanMsg(x).slice(0, 60), v: false } : { n: cleanMsg(x?.name || '').slice(0, 60), v: x?.visible === true }).filter((x) => x.n);
                const seen = new Set(), uniq = list.filter((x) => !seen.has(x.n) && seen.add(x.n)).slice(0, 40);
                if (!uniq.length) return toast('info', 'В лоре и карточке способности не найдены. Выберите из списка или впишите свою.');
                s.loreAbilities = uniq;
                toast('success', `Найдено способностей: ${uniq.length}. Они вверху списка «Способности».`);
                save(s);
            });
        },
        pickWorld: (d, el, s) => {
            if (s.world && byId('sh-a-name')) readAuth(s);
            const prev = s.world;
            s.world = d.w || null;
            if (s.world && s.world !== prev) {
                s.faculties = []; s.profile.faculty = ''; s.genClubs = []; s.genClubsAt = 0; s.loreClubs = []; s.campusLoreAt = 0;
                if (s.world === 'mundane') {
                    s.profile.species = ''; s.profile.abilities = ''; s.profile.abilityVisible = false;
                    s.menu = MUNDANE_MENU.map((x) => ({ ...x, id: uid() })); s.market = MUNDANE_MARKET.map((x) => ({ ...x, id: uid() })); s.groceries = null;
                } else {
                    s.menu = DEFAULT_MENU.map((x) => ({ ...x, id: uid() })); s.market = DEFAULT_MARKET.map((x) => ({ ...x, id: uid() })); s.groceries = null;
                }
            }
            save(s); render();
        },
        loadSpecies: (d, el, s) => {
            if (d.pre === 'sh-a') readAuth(s);
            return withBusy('Ищу виды в лоре…', async () => {
                const lore = await loreText(/вид|раса|species|race|полулюд|демихьюман|demi|вампир|оборот|эльф|фейри|демон|существ|creature/i);
                const r = await aiJSON(`${world(s)}\n\nЛор (лорбук и карточка):\n${lore || '(нет данных)'}\n\nВыпиши виды и расы разумных существ, которые упоминаются в этом мире (в лоре, описании персонажа, сценарии). Только те, что реально упомянуты, названия по-русски, как в мире. Если ничего нет — пустой массив.\nФормат: ["вид", "вид"]`);
                const list = (Array.isArray(r) ? r : []).map((x) => cleanMsg(typeof x === 'string' ? x : x?.name || '').slice(0, 50)).filter(Boolean);
                const uniq = [...new Set(list)].slice(0, 40);
                if (!uniq.length) return toast('info', 'В лоре и карточке виды не найдены. Выберите из списка или впишите свой.');
                s.loreSpecies = uniq;
                toast('success', `Найдено видов: ${uniq.length}. Они вверху списка «Вид».`);
                save(s);
            });
        },
        loadFac: (d, el, s) => { readAuth(s); return withBusy('Ищу факультеты в лоре…', async () => { s.faculties = await loadFaculties(s); save(s); }); },
        pickFac: (d, el, s) => { readAuth(s); s.profile.faculty = s.faculties[+d.i]?.name || ''; const f = byId('sh-a-fac'); if (f) f.value = ''; save(s); render(); },
        login: (d, el, s) => {
            readAuth(s);
            const fac = isStudent(s.profile) ? (val('sh-a-fac') || s.profile.faculty) : '';
            if (!s.profile.name) return toast('warning', 'Укажите имя.');
            if (!s.profile.gender) return toast('warning', 'Выберите пол.');
            if (!s.profile.age) return toast('warning', 'Выберите возраст.');
            if (!s.profile.profession) return toast('warning', 'Выберите профессию или впишите свою.');
            if (!mundane(s) && !s.profile.species) return toast('warning', 'Выберите вид.');
            if (!mundane(s) && !s.profile.abilities) return toast('warning', 'Выберите способность или «Отсутствуют».');
            if (isStudent(s.profile) && !fac) return toast('warning', 'Выберите факультет или впишите свой.');
            s.profile.faculty = fac;
            return withBusy('Составляю расписание…', async () => {
                s.schedule = await genLifeSchedule(s);
                enqueue(s, async () => { const n = await extractLorePeople(s); if (n) notify(s, `👥 В CityHub появились люди из вашего мира: ${n}`, 'important'); });
                enqueue(s, async () => { await extractCampusLore(s); });
                enqueue(s, async () => { await genClubs(s); });
                s.auth = true; s.enforceFrom = NOW(); s.quarter = { n: 1, start: NOW() };
                s.expelled = false; s.expelReason = '';
                const c = ctx();
                if (c.name2 && !c.groupId && !s.threads.some((t) => t.kind === 'char')) s.threads.push({ id: uid(), name: c.name2, species: '', bio: '', kind: 'char', msgs: [], t: NOW(), unread: 0, rel: 0 });
                notify(s, `🏙️ Добро пожаловать в CityHub, ${s.profile.name}! Расписание готово: ${isStudent(s.profile) ? `учёба на факультете «${fac}»` : noWork(s.profile) ? 'прогулки и дела' : `работа — ${s.profile.profession}`}.`, 'important');
                ui.tab = 'study'; ui.studyTab = 'schedule'; ui.view = null;
                save(s);
            });
        },

        /* лента */
        channel: (d) => { ui.channel = d.ch; render(); },
        post: (d, el, s) => {
            const text = val('sh-post');
            if (!text) return toast('warning', 'Напишите текст поста.');
            const p = { id: uid(), author: s.profile.name, species: s.profile.privacy.species ? s.profile.species : '', channel: val('sh-post-ch') || 'general', text, likes: 0, mine: true, t: Date.now(), comments: [], commentsLoaded: true };
            s.feed.unshift(p);
            byId('sh-post').value = '';
            save(s); render();
            questEvent(s, 'post', 1, '', text);
            engageMyPost(s, p);
        },
        genComments: async (d, el, s) => {
            const p = s.feed.find((x) => x.id === d.id);
            if (!p || p.loadingComments || p.commentsLoaded) return;
            p.loadingComments = true; render();
            const list = await aiComments(s, p, `Сгенерируй 4–6 комментариев к этому посту от разных жителей города разных возрастов и профессий (есть и добрые, и неприятные люди): шутки, поддержка, споры, сплетни, вопросы. Иногда они отвечают друг другу (поле replyTo — имя того, кому отвечают).`);
            p.loadingComments = false;
            if (S() !== s) return;
            p.commentsLoaded = true;
            const now = Date.now();
            (p.comments ||= []).push(...list.map((c, i) => ({ ...c, t: now - (list.length - i) * 3 * MIN })));
            save(s); render();
        },
        replyTo: (d) => { ui.replyTo = d.name || ''; render(); byId('sh-cmt')?.focus(); },
        comment: async (d, el, s) => {
            const p = s.feed.find((x) => x.id === d.id);
            const text = val('sh-cmt');
            if (!p || !text) return;
            const replyTo = ui.replyTo || '';
            (p.comments ||= []).push({ id: uid(), author: s.profile.name, text, t: Date.now(), likes: 0, mine: true, replyTo });
            byId('sh-cmt').value = ''; ui.replyTo = '';
            p.loadingComments = true; save(s); render();
            const target = replyTo || (p.mine ? '' : p.author);
            const list = await aiComments(s, p, `${s.profile.name} только что написал(а) комментарий${replyTo ? ` в ответ ${replyTo}` : ''}: «${text}». Сгенерируй 1–3 ответа в ветке. ${target ? `${target} обязательно отвечает ${s.profile.name} (replyTo: "${s.profile.name}"). ` : 'Ответь от лица других жителей. '}Может подключиться ещё кто-то из комментаторов или новый житель.`, 'этот комментарий');
            p.loadingComments = false;
            applyScore(s, list.score, null);
            const fu = list.followup || guessFollowup(s, p, text, replyTo, list);
            if (fu) scheduleDM(s, fu, list.find((c) => c.author === cleanName(fu.from))?.species || s.feed.find((x) => x.author === cleanName(fu.from))?.species, `Пост ${p.author}: «${p.text.slice(0, 200)}»\n${shownComments(p).slice(-6).map((c) => `${c.author}: ${c.text}`).join('\n')}\n${list.map((c) => `${c.author}: ${c.text}`).join('\n')}`);
            questEvent(s, 'comment', 1, '', text);
            if (replyTo) questEvent(s, 'reply', 1, '', text);
            const st = p.story ? s.stories.find((x) => x.title === p.story) : null;
            if (st) { (st.userActs ||= []).push(text.slice(0, 160)); if (st.userActs.length > 5) st.userActs.shift(); questEvent(s, 'story'); }
            if (S() !== s) return;
            const now = Date.now();
            (p.comments ||= []).push(...list.map((c, i) => ({ ...c, t: now + i * 1000 })));
            if (list.length && !(ui.view === 'post' && ui.param === p.id)) notify(s, `💬 ${list[0].author} ответил(а) на ваш комментарий`, 'social', { view: 'post', param: p.id });
            save(s); render();
        },
        proposeMeet: (d, el, s) => {
            const th = s.threads.find((t) => t.id === d.id);
            if (!th) return;
            const kind = val('sh-m-kind'), place = val('sh-m-place'), note = val('sh-m-note').slice(0, 80);
            const [hh, mm] = (val('sh-m-time') || '18:00').split(':').map(Number);
            const day = new Date(NOW()); day.setDate(day.getDate() + (parseInt(val('sh-m-day'), 10) || 0)); day.setHours(hh || 0, mm || 0, 0, 0);
            const at = day.getTime(), now = NOW();
            const bad = meetProblem(s, at, place);
            if (bad) return toast('warning', bad);
            if (d.agreed) {
                addMeeting(s, th, kind, place, note, at);
                th.pendingMeet = null;
                th.msgs.push({ sys: true, text: `📅 Встреча добавлена: ${KINDS[kind].toLowerCase()}, ${fmtWhen(at)}, ${PLACES[place]}${note ? ` (${note})` : ''}`, t: now });
                updateRel(s, th, 1, kind === 'date');
                ui.view = 'thread'; ui.param = th.id;
                save(s); render();
                return;
            }
            return withBusy(`Ждём ответа от ${th.name}…`, async () => {
                const m = { with: th.name, kind, place, note };
                th.msgs.push({ me: true, text: `📅 Приглашение: ${meetText(m)}, ${fmtWhen(at)}`, t: now });
                const r = await aiJSON(`${world(s)}${th.kind === 'char' ? `
${charCard()}` : ''}

${s.profile.name} приглашает ${th.name}${th.species ? ` (${th.species})` : ''} через CityHub: ${KINDS[kind]}, ${fmtWhen(at)}, ${PLACES[place]}${note ? `, ${note}` : ''}. Отношение ${th.name} к ${s.profile.name}: ${relLabel(th)} (${Math.round(th.rel || 0)} из 100).${th.kind === 'char' && s.profile.relWithChar ? ' Они пара.' : ''} Реши, соглашается ли ${th.name}, учитывая отношения, характер${place === 'skip' ? ', то, что это прогул,' : ''} и тип встречи.
Формат: {"accept":true,"reply":"ответ в мессенджере, 1–2 предложения"}`);
                const accept = r?.accept === true || r?.accept === 'true';
                th.msgs.push({ me: false, text: cleanMsg(r?.reply || (accept ? 'Давай!' : 'Прости, не получится.')).slice(0, 500), t: NOW() });
                th.t = NOW();
                if (accept) {
                    addMeeting(s, th, kind, place, note, at);
                    updateRel(s, th, 2, kind === 'date');
                } else updateRel(s, th, -1, false);
                ui.view = 'thread'; ui.param = th.id;
                save(s);
            });
        },
        mentionClass: (d, el, s) => {
            const th = s.threads.find((t) => t.id === d.id);
            const pm = th?.pendingMeet;
            if (!pm?.conflict || th.typing) return;
            th.msgs.push({ me: true, text: `Ой, подожди… ${dayWord(pm.at)} в это время у меня пара «${pm.conflict.subject}» до ${fmtT(pm.conflict.end)} 😅`, t: Date.now(), classConflict: true });
            th.t = Date.now();
            th.pendingMeet = null;
            save(s); render();
            return reply(s, th);
        },
        skipPending: (d, el, s) => {
            const th = s.threads.find((t) => t.id === d.id);
            const pm = th?.pendingMeet;
            if (!pm) return;
            if (!confirm(`Встреча будет вместо пары «${pm.conflict?.subject || ''}» — это прогул и нарушение. Продолжить?`)) return;
            pm.place = 'skip'; pm.conflict = null; pm.problem = meetProblem(s, pm.at, 'skip');
            save(s); render();
        },
        acceptPending: (d, el, s) => {
            const th = s.threads.find((t) => t.id === d.id);
            const pm = th?.pendingMeet;
            if (!pm) return;
            const bad = meetProblem(s, pm.at, pm.place);
            if (bad) { pm.problem = bad; return render(); }
            addMeeting(s, th, pm.kind, pm.place, pm.note, pm.at);
            th.msgs.push({ sys: true, text: `📅 Встреча добавлена: ${KINDS[pm.kind].toLowerCase()}, ${fmtWhen(pm.at)}, ${PLACES[pm.place]}${pm.note ? ` (${pm.note})` : ''}`, t: Date.now() });
            th.pendingMeet = null;
            save(s); render();
        },
        dropPending: (d, el, s) => {
            const th = s.threads.find((t) => t.id === d.id);
            if (!th?.pendingMeet) return;
            (th.dismissedMeets ||= []).push(th.pendingMeet.key);
            if (th.dismissedMeets.length > 20) th.dismissedMeets.shift();
            th.pendingMeet = null;
            save(s); render();
        },
        cancelMeet: (d, el, s) => {
            const m = s.meetings.find((x) => x.id === d.id);
            if (!m || m.status !== 'accepted') return;
            if (!confirm(`Отменить встречу с ${m.with}?`)) return;
            m.status = 'cancelled';
            const th = s.threads.find((t) => t.id === m.threadId);
            const sameDay = dkey(m.at) === dkey(NOW());
            notify(s, `❌ Встреча с ${m.with} отменена.`, 'social');
            if (th) {
                updateRel(s, th, sameDay ? -5 : -2, false, 8, `${s.profile.name} отменил(а) встречу${sameDay ? ' в последний момент' : ''}`);
                th.msgs.push({ me: true, text: `❌ Прости, не получится ${fmtWhen(m.at)} — отменяю встречу.`, t: NOW() });
                save(s); render();
                return reply(s, th);
            }
            save(s); render();
        },
        startScene: (d, el, s) => {
            const m = s.meetings.find((x) => x.id === d.id);
            if (!m) return;
            fillChatInput(`*${s.profile.name} идёт на встречу с ${m.with} — ${placeOf(m)}${m.note ? `, ${m.note}` : ''}.*`);
            toast('info', 'Начало сцены вставлено в поле ввода чата.');
            toggle(false);
        },
        rerollQuests: (d, el, s) => {
            const so = soc(s), day = dkey(NOW());
            if (so.rerollDay === day) return toast('info', 'Задания уже обновлялись сегодня. Новые появятся завтра.');
            if (!confirm('Заменить задания дня на новые? Сделать это можно раз в день.')) return;
            so.rerollDay = day;
            so.questDay = '';
            so.quests = [];
            refreshQuests(s);
            save(s); render();
        },
        checkQuest: (d, el, s) => {
            const q = soc(s).quests.find((x) => x.id === d.id);
            if (!q || q.done) return;
            const story = recentStory(25);
            if (!story) return toast('warning', 'В основной истории пока нет сообщений.');
            return withBusy('Проверяю историю…', async () => {
                const r = await aiJSON(`Задание для ${s.profile.name}: «${q.t}» — ${q.desc}${q.setup ? ` (Задание связано с событием: ${q.setup}. Если этого события в истории ещё не было — не засчитывай и так и скажи.)` : ''}

Последние сообщения основной истории:
${story}

Выполнил(а) ли ${s.profile.name} это задание в истории? Засчитывай только если действие действительно произошло в тексте, а не просто упомянуто или запланировано.
Формат: {"done":true,"comment":"коротко, почему"}`);
                if (r?.done === true || r?.done === 'true') { completeQuest(s, q); save(s); }
                else toast('info', `Пока не засчитано: ${cleanMsg(r?.comment || 'в истории не видно выполнения')}`);
            });
        },
        setTheme: (d) => { cfg().theme = d.t; saveCfg(); applyTheme(); render(); },
        timeMode: (d, el, s) => {
            if (d.m === 'game' && !gameMode(s)) { s.clock.mode = 'game'; s.clock.t = Math.max(s.clock.t || 0, Date.now()); s.clock.source = 'включено'; }
            else if (d.m === 'real') s.clock.mode = 'real';
            cfg().timeMode = d.m; saveCfg();
            tick(); save(s); render();
        },
        clockAdd: (d, el, s) => { setClock(s, s.clock.t + (+d.min) * MIN, 'вручную'); },
        clockMorning: (d, el, s) => { setClock(s, nextMorning(s.clock.t), 'вручную'); },
        clockSet: (d, el, s) => {
            const [y, mo, da] = val('sh-c-date').split('-').map(Number), [hh, mi] = val('sh-c-time').split(':').map(Number);
            const ts = new Date(y, mo - 1, da, hh, mi).getTime();
            if (!Number.isFinite(ts)) return toast('warning', 'Укажите дату и время.');
            if (ts < s.clock.t && !confirm('Перевести часы истории назад? Уже прошедшие пары и дедлайны останутся как есть.')) return;
            setClock(s, ts, 'вручную', true);
        },
        sleep: (d, el, s) => {
            fillChatInput(`*${s.profile.name} ложится спать.*`);
            setClock(s, nextMorning(s.clock.t), 'сон');
            toast('info', 'Утро наступило в CityHub. Отправьте сообщение в чат, чтобы история тоже перешла к утру.');
            toggle(false);
        },
        checkHorae: () => {
            const found = readHorae(true);
            if (!found.length) { logErr('Horae', 'данные о времени не найдены (метаданные чата, последние 3 сообщения, теги <horae>)'); return toast('warning', 'Время от Horae не найдено. Подробности — в журнале ошибок; пришлите его, и я подстрою связку.'); }
            logErr('Horae: найдено', found.slice(0, 12).map(([p, v]) => `${p} = ${v}`).join(' | '));
            const ts = readHorae();
            toast(ts ? 'success' : 'warning', ts ? `Horae найден: ${fmtFull(ts)}` : 'Horae найден, но время не удалось разобрать. Пришлите журнал ошибок.');
        },
        goClass: (d, el, s) => {
            const o = findOcc(s, d.key);
            if (!o || s.attendance[d.key]) return;
            const tw = TYPE_WORD[typeOf(o.cl)];
            if (gameMode(s) && s.clock.t < o.start) setClock(s, o.start - 2 * MIN, tw[0]);
            s.attendance[d.key] = 'present';
            questEvent(s, 'checkin');
            notify(s, `✅ ${o.cl.subject}: вы на месте.`);
            fillChatInput(`*${s.profile.name} отправляется ${tw[0]}: «${o.cl.subject}»${o.cl.room ? ` (${o.cl.room})` : ''}${o.cl.teacher && typeOf(o.cl) !== 'walk' ? `, ${typeOf(o.cl) === 'study' ? 'ведёт' : 'с'} ${o.cl.teacher}` : ''}.*`);
            save(s); toggle(false);
        },
        goMeet: (d, el, s) => {
            const m = s.meetings.find((x) => x.id === d.id);
            if (!m || m.status !== 'accepted') return;
            if (gameMode(s) && s.clock.t < m.at) setClock(s, m.at, 'на встречу');
            if (m.status === 'accepted') startMeeting(s, m);
            fillChatInput(m.kind === 'official' ? `*${s.profile.name} идёт по вызову к ${m.with} — ${placeOf(m)}.*` : `*${s.profile.name} отправляется на встречу с ${m.with} — ${placeOf(m)}${m.note ? `, ${m.note}` : ''}.*`);
            save(s); toggle(false);
        },
        goEvent: (d, el, s) => {
            const e = s.events.find((x) => x.id === d.id);
            if (!e) return;
            fillChatInput(`*${s.profile.name} отправляется на мероприятие «${e.title}»${e.place ? ` — ${e.place}` : ''}.*`);
            toast('info', 'Если мероприятие позже — переведите часы истории в «Время».');
            toggle(false);
        },
        goClub: (d, el, s) => {
            fillChatInput(`*${s.profile.name} идёт на занятие клуба «${d.c}».*`);
            toggle(false);
        },
        openNote: (d, el, s) => {
            const go = s.notes.find((n) => n.id === d.id)?.go;
            if (!go) return;
            // цель могла исчезнуть: пост удалён из ленты, диалог сброшен
            if (go.view === 'post' && !s.feed.some((p) => p.id === go.param)) return toast('info', 'Этот пост уже пропал из ленты.');
            if (go.view === 'thread' && !s.threads.some((t) => t.id === go.param)) return toast('info', 'Этот диалог больше недоступен.');
            if (go.view === 'task' && !s.tasks.some((t) => t.id === go.param)) { ui.tab = 'study'; ui.studyTab = 'tasks'; ui.view = null; ui.param = null; return render(); }
            if (go.tab) { ui.tab = go.tab; ui.view = null; ui.param = null; }
            if (go.studyTab) ui.studyTab = go.studyTab;
            if (go.view) { ui.view = go.view; ui.param = go.param ?? null; }
            ui.replyTo = '';
            render();
        },
        syncRel: (d, el, s) => { const th = s.threads.find((t) => t.id === d.id); if (th) { th.relSyncLen = undefined; return syncRel(s, th); } },
        cLike: (d, el, s) => {
            const c = s.feed.find((x) => x.id === d.post)?.comments?.find((x) => x.id === d.id);
            if (!c) return;
            c.liked = !c.liked; c.likes = Math.max(0, (c.likes || 0) + (c.liked ? 1 : -1));
            save(s); render();
        },
        person: (d, el, s) => { ui.view = d.name === s.profile.name ? 'me' : 'person'; ui.param = d.name; render(); },
        follow: (d, el, s) => {
            const f = s.social.following;
            s.social.following = f.includes(d.name) ? f.filter((n) => n !== d.name) : [...f, d.name];
            if (!f.includes(d.name)) questEvent(s, 'follow');
            if (!f.includes(d.name) && Math.random() < 0.5) { s.social.followers += 1; notify(s, `👥 ${d.name} подписался(ась) на вас в ответ`, 'social'); }
            save(s); render();
        },
        like: (d, el, s) => { const p = s.feed.find((x) => x.id === d.id); if (!p) return; p.liked = !p.liked; p.likes = Math.max(0, (p.likes || 0) + (p.liked ? 1 : -1)); if (p.liked && !p.mine) questEvent(s, 'like'); save(s); render(); },
        genFeed: (d, el, s) => withBusy('Загружаю ленту…', async () => {
            const now = Date.now(), name = s.profile.name;
            const act = s.stories.filter((x) => now - x.updated < 5 * DAY).slice(-4);
            const storyTxt = act.map((x) => `- «${x.title}» (участники: ${x.cast.join(', ')}): ${x.summary}${x.userActs?.length ? ` Вмешательство ${name}: ${x.userActs.slice(-3).join(' | ')}` : ''}`).join('\n');
            const rels = s.threads.filter((t) => t.kind !== 'group' && (Math.abs(t.rel || 0) >= 40 || (t.flirt || 0) >= 3)).slice(0, 6).map((t) => `${t.name} — ${relLabel(t)}`).join('; ');
            const r = await aiJSON(`${world(s)}\n\nСгенерируй 6 свежих публикаций в ленту CityHub от разных жителей города разных возрастов и профессий (есть и добрые, и неприятные люди).${loreStudentsLine(s)} Весь текст на русском, включая названия видов (имена могут быть любыми). Каналы: general, study, clubs, dorms, species.${s.profile.species ? ` Минимум 1 пост от вида «${s.profile.species}» в канал species.` : ''}
Лента живая: жители общаются МЕЖДУ СОБОЙ. 3–4 поста — сюжетные линии: продолжение активных сюжетов (ссоры, романы, соперничество, розыгрыши, расследования, сплетни) или начало нового. Участники отвечают друг другу постами и упоминают друг друга через @Имя, сюжет развивается от ленты к ленте. Персонажи сюжетов реагируют на вмешательство ${name}.
${storyTxt ? `Активные сюжеты:\n${storyTxt}\n` : ''}${rels ? `Отношения ${name} в CityHub (могут всплывать в ленте — биффы, флирт, сплетни): ${rels}\n` : ''}${cancelled(s) ? `Сейчас ${name} «отменяют» в сети — это активно обсуждают.\n` : ''}1–2 поста могут обсуждать ${name}: реакцию на вид и способности по правилам выше.
Формат: {"posts":[{"author":"Имя","species":"вид","channel":"general","text":"до 300 символов","media":"описание фото или видео, либо пустая строка","kind":"photo|video|reel|story","likes":12,"verified":true,"story":"название сюжета или пустая строка"}],"stories":[{"title":"название сюжета","cast":["Имя","Имя"],"summary":"что происходит сейчас, 1–2 предложения"}]}`);
            const arr = Array.isArray(r) ? r : (Array.isArray(r?.posts) ? r.posts : []);
            if (!arr.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            for (const st of Array.isArray(r?.stories) ? r.stories : []) {
                if (!st || !st.title) continue;
                const title = cleanName(st.title).slice(0, 60);
                let x = s.stories.find((y) => y.title.toLowerCase() === title.toLowerCase());
                if (!x) { x = { id: uid(), title, cast: [], summary: '', userActs: [], updated: now }; s.stories.push(x); }
                const cast = (Array.isArray(st.cast) ? st.cast : []).map(cleanName).filter(Boolean).slice(0, 6);
                if (cast.length) x.cast = cast;
                x.summary = String(st.summary || x.summary).slice(0, 300);
                x.updated = now;
            }
            if (s.stories.length > 12) s.stories = s.stories.slice(-12);
            const posts = arr.filter((p) => p && p.author && p.text).map((p, i) => ({ id: uid(), author: cleanName(p.author), species: SP(s, p.species), channel: CHANNELS[p.channel] && p.channel !== 'all' ? p.channel : 'general', text: cleanMsg(p.text).slice(0, 600), media: String(p.media || '').slice(0, 200), kind: p.kind, likes: Math.max(0, parseInt(p.likes, 10) || 0), verified: p.verified !== false, t: now - i * 7 * MIN, comments: [], story: cleanName(p.story).slice(0, 60) }));
            s.feed = [...posts, ...s.feed].slice(0, 80);
            save(s);
        }),
        dm: (d, el, s) => { openThread(s, d.name, d.species || '', d.bio || ''); render(); },

        /* чаты */
        newChat: (d, el, s) => { const n = val('sh-newchat'); if (!n) return toast('warning', 'Введите имя.'); openThread(s, n); render(); },
        send: (d, el, s) => {
            const th = s.threads.find((t) => t.id === d.id);
            const text = val('sh-msg');
            if (!th || !text || th.typing) return;
            th.msgs.push({ me: true, text, t: Date.now() }); th.t = Date.now();
            byId('sh-msg').value = '';
            questEvent(s, 'dm', 1, '', `${th.name}: ${text}`);
            save(s);
            return reply(s, th);
        },

        /* знакомства */
        dMode: (d, el, s) => { s.dating.mode = d.mode; s.dating.profiles = []; save(s); render(); },
        genDating: (d, el, s) => {
            const dt = s.dating;
            dt.fSpecies = val('sh-d-species'); dt.fAbility = val('sh-d-abil'); dt.fGender = val('sh-d-gender'); dt.fAge = val('sh-d-age');
            dt.profiles = [];
            return withBusy('Подбираю анкеты…', async () => {
                const ages = AGE_GROUPS[dt.fAge] || '18 и старше';
                const r = await aiJSON(`${world(s)}\n\n${loreStudentsLine(s)}\nЕсли среди жителей из лора есть подходящие под фильтры совершеннолетние — включи 1–2 из них с их настоящими данными, остальных придумай.\nСгенерируй 5 анкет жителей города для ${dt.mode === 'friends' ? 'поиска друзей' : 'романтических знакомств'} в CityHub. СТРОГО только совершеннолетние: возраст в пределах ${ages} лет (никогда младше 18). Фильтр по полу: ${{ m: 'только мужчины', f: 'только женщины', nb: 'только небинарные люди' }[dt.fGender] || 'любой'}. Люди разные: разных профессий, характеров, с достоинствами и недостатками — не все идеальные.
Оцени совместимость характеров и интересов с пользователем (compat 0–100) и коротко объясни.
Формат: [{"name":"Имя Фамилия","age":27,"gender":"m, f или nb","profession":"профессия или пусто, если не работает","looks":"внешность, 1–2 предложения","character":"характер, 1–2 предложения","hobbies":"хобби","likes":"что любит","dislikes":"что не любит","seeks":"что ищет в людях","bio":"коротко о себе, до 160 символов","compat":75,"compatNote":"одно предложение","verified":true}]`);
                if (!Array.isArray(r) || !r.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
                dt.profiles = r.filter((p) => p && p.name && (parseInt(p.age, 10) || 18) >= 18).map((p) => ({ id: uid(), name: cleanName(p.name).slice(0, 40), age: Math.max(18, parseInt(p.age, 10) || 25), species: '', faculty: cleanMsg(p.profession || p.faculty || '').slice(0, 60), looks: cleanMsg(p.looks || '').slice(0, 300), character: cleanMsg(p.character || '').slice(0, 300), hobbies: cleanMsg(p.hobbies || '').slice(0, 200), likes: cleanMsg(p.likes || '').slice(0, 200), dislikes: cleanMsg(p.dislikes || '').slice(0, 200), seeks: cleanMsg(p.seeks || '').slice(0, 200), abilities: String(p.abilities || '').slice(0, 120), bio: String(p.bio || '').slice(0, 300), compat: clamp(parseInt(p.compat, 10) || 50, 0, 100), compatNote: String(p.compatNote || '').slice(0, 160), verified: p.verified !== false }));
                save(s);
            });
        },
        dSkip: (d, el, s) => { s.dating.profiles = s.dating.profiles.filter((p) => p.id !== d.id); if (ui.view === 'dprofile') { ui.view = null; ui.tab = 'dating'; } save(s); render(); },
        dLike: (d, el, s) => {
            const p = s.dating.profiles.find((x) => x.id === d.id);
            if (!p) return;
            s.dating.profiles = s.dating.profiles.filter((x) => x.id !== d.id);
            if (Math.random() < 0.15 + (p.compat / 100) * 0.7) {
                s.dating.matches.unshift({ ...p, bio: p.bio });
                const th = openThread(s, p.name, '', `${p.age} лет${p.faculty ? `, ${p.faculty}` : ''}. Внешность: ${p.looks || '—'}. Характер: ${p.character || '—'}. Хобби: ${p.hobbies || '—'}. Любит: ${p.likes || '—'}; не любит: ${p.dislikes || '—'}. ${p.bio} Познакомились через знакомства CityHub (${s.dating.mode === 'friends' ? 'дружба' : 'свидания'}).`);
                if (th.rel === undefined || th.rel < 25) th.rel = 25;
                if (s.dating.mode === 'love') th.flirt = Math.max(th.flirt || 0, 2);
                th.msgs.push({ sys: true, text: s.dating.mode === 'friends' ? 'Вы хотите дружить. Напишите первым!' : 'Взаимная симпатия! Напишите первым.', t: Date.now() });
                notify(s, `💘 Взаимная симпатия с ${p.name}!`, 'important');
            } else toast('info', `${p.name} пока не ответил(а) взаимностью.`);
            save(s); render();
        },
        dReport: (d, el, s) => {
            const p = s.dating.profiles.find((x) => x.id === d.id);
            if (!p) return;
            s.dating.profiles = s.dating.profiles.filter((x) => x.id !== d.id);
            s.tickets.unshift({ id: uid(), type: 'Жалоба', text: `Анкета в знакомствах: ${p.name}`, t: Date.now() });
            toast('success', 'Жалоба отправлена, анкета скрыта.');
            save(s); render();
        },

        /* учёба */
        studyTab: (d) => { ui.studyTab = d.st; render(); },
        schedDay: (d) => { ui.schedDay = +d.d; render(); },
        regenSchedule: (d, el, s) => {
            if (!confirm('Составить расписание заново? Посещаемость прошлых пар сохранится.')) return;
            return withBusy('Составляю расписание…', async () => { s.schedule = await genSchedule(s, s.profile.faculty); s.enforceFrom = NOW(); save(s); });
        },
        checkin: (d, el, s) => {
            const o = findOcc(s, d.key); const now = NOW();
            if (!o || s.attendance[d.key]) return;
            if (now < o.start - cfg().checkInEarlyMin * MIN || now >= o.end) return toast('warning', 'Отметка сейчас недоступна.');
            s.attendance[d.key] = 'present';
            questEvent(s, 'checkin');
            notify(s, `✅ Вы отметились на паре «${o.cl.subject}».`);
            save(s); render();
        },
        excuse: (d, el, s) => {
            const o = findOcc(s, d.key); const reason = val('sh-excuse');
            if (!o || s.attendance[d.key] || s.excuses[d.key]) return;
            if (NOW() >= o.end) return toast('warning', 'Пара уже закончилась, запрос не принят.');
            if (reason.length < 10) return toast('warning', 'Опишите причину подробнее.');
            return withBusy('Руководство рассматривает…', async () => {
                const r = await aiJSON(`${world(s)}\n\n${s.profile.name} просит признать уважительным отсутствие на «${o.cl.subject}» (${fmtD(o.start)}) уважительным. Причина: «${reason}». Ты — руководство (начальник на работе или преподаватель на учёбе). Уважительные причины: болезнь, форс-мажор, семейные обстоятельства, вызов в суд. Неуважительные: лень, проспал, свидание, «не хотелось».\nФормат: {"valid":true,"reply":"ответ деканата, 1 предложение"}`);
                const valid = r?.valid === true || r?.valid === 'true';
                s.excuses[d.key] = { reason, valid, reply: String(r?.reply || (valid ? 'Причина признана уважительной.' : 'Причина не признана уважительной.')).slice(0, 300) };
                if (valid) { s.attendance[d.key] = 'excused'; notify(s, `📝 Отсутствие на «${o.cl.subject}» признано уважительным.`); }
                else notify(s, `📝 Руководство отклонило причину для «${o.cl.subject}». Придите, иначе будет прогул.`, 'warn');
                ui.view = null; ui.tab = 'study';
                save(s);
            });
        },
        extra: (d, el, s) => {
            if (s.tasks.some((t) => t.extra && !t.done && !t.expired)) return toast('warning', 'Сначала выполните уже взятое доп. задание.');
            const subjects = [...new Set(s.schedule.map((c) => c.subject))];
            const t = { id: uid(), src: `extra-${uid()}`, subject: pick(subjects.length ? subjects : ['Общий курс']), title: 'Доп. задание', desc: '', issued: NOW(), deadline: NOW() + cfg().extraTaskHours * HOUR, done: false, overdue: false, extra: true };
            s.tasks.push(t);
            genTaskDesc(s, t);
            ui.view = 'task'; ui.param = t.id;
            save(s); render();
        },
        retryTask: (d, el, s) => { const t = s.tasks.find((x) => x.id === d.id); if (t) genTaskDesc(s, t); },
        submit: (d, el, s) => {
            const t = s.tasks.find((x) => x.id === d.id);
            const ans = val('sh-ans');
            if (!t || t.done || t.expired) return;
            if (ans.length < 20) return toast('warning', 'Ответ слишком короткий.');
            return withBusy('Преподаватель проверяет работу…', async () => {
                const r = await aiJSON(`${world(s)}\n\n${t.work || t.extra ? `Ты — руководитель ${s.profile.name} (${s.profile.profession}). Оцени, как выполнено поручение,` : `Ты — преподаватель предмета «${t.subject}». Оцени ответ студента`} по пятибалльной шкале (2 — неудовлетворительно, 3, 4, 5 — отлично). Строго, но справедливо: отписки и ответы не по теме — 2.\nЗадание: ${t.desc}\nОтвет студента: ${ans}\nФормат: {"grade":4,"comment":"1–2 предложения"}`);
                let grade = Math.round(Number(r?.grade));
                if (!(grade >= 2 && grade <= 5)) grade = ans.length > 300 ? 4 : 3;
                const late = NOW() > t.deadline && !t.extra;
                if (late) grade = Math.min(grade, 3);
                Object.assign(t, { done: true, doneAt: NOW(), answer: ans, grade, comment: `${String(r?.comment || '').slice(0, 400)}${late ? ' Сдано после срока, оценка не выше 3.' : ''}` });
                s.grades.push({ id: uid(), subject: t.subject, grade, t: NOW(), q: s.quarter.n, task: t.title });
                notify(s, `✅ «${t.title}»: оценка ${grade}.`, 'info', { view: 'task', param: t.id });
                questEvent(s, 'homework');
                if (grade === 5) questEvent(s, 'grade5', 1, t.subject);
                if (t.extra) {
                    const pay = grade >= 3 ? Math.round(incomeOf(s.profile) * (0.1 + (grade - 3) * 0.05)) : 0;
                    if (pay) { tx(s, pay, `Подработка: ${t.title}`); notify(s, `💼 Подработка оплачена: +${money(pay)}.`, 'info', { view: 'wallet' }); }
                    else notify(s, 'Подработку сделали плохо — оплаты не будет.', 'warn');
                }
                save(s);
            });
        },
        calc: (d, el, s) => {
            const extra = val('sh-calc').split(/[\s,;]+/).map(Number).filter((n) => n >= 2 && n <= 5);
            const all = [...s.grades.map((g) => g.grade), ...extra];
            const out = byId('sh-calc-out');
            if (out) out.textContent = all.length ? `Средний балл станет ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(2)}.` : 'Введите оценки от 2 до 5.';
        },
        orderSvc: (d, el, s) => {
            const k = ui.svc || 'taxi', sv = SERVICES[k], text = val('sh-svc-text');
            if (!text) return toast('warning', 'Опишите, что нужно.');
            if (sv[1] === 'arrive') { if (orderService(s, sv[0], text, sv[2])) { const e = byId('sh-svc-text'); if (e) e.value = ''; } return; }
            return withBusy('Ищу исполнителя…', async () => {
                const r = await aiJSON(`${world(s)}\n\nЖитель ${s.profile.name} ищет через CityHub: ${sv[0]}. Запрос: «${text}». Придумай исполнителя — реального человека этого города (разные люди: кто-то профи, кто-то так себе). Он пишет первым в личку: представляется, называет цену и условия.\nФормат: {"name":"имя","bio":"кто это, опыт, 1 предложение","message":"первое сообщение, 1–3 предложения"}`);
                if (!r?.name) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
                const th = openThread(s, cleanName(r.name), '', `${sv[0]}. ${cleanMsg(r.bio || '')}`);
                th.known = true; th.status = 'по услуге';
                if (r.message) th.msgs.push({ me: false, text: cleanMsg(r.message).slice(0, 500), t: Date.now() });
                save(s);
            });
        },
        tutor: (d, el, s) => {
            const subj = val('sh-tutor');
            if (!subj) return toast('warning', 'Сначала нужно расписание с предметами.');
            return withBusy('Ищу репетитора…', async () => {
                const r = await aiJSON(`${world(s)}\n\nПридумай репетитора по предмету «${subj}» — старшекурсника или аспиранта этого университета.\nФормат: {"name":"","species":"","bio":"1–2 предложения, включая цену занятия в ₡"}`);
                const th = openThread(s, r?.name || `Репетитор (${subj})`, r?.species || '', `Репетитор по предмету «${subj}». ${r?.bio || ''}`);
                th.msgs.push({ sys: true, text: `Запрос на помощь по «${subj}» отправлен.`, t: Date.now() });
                save(s);
            });
        },
        groups: (d, el, s) => withBusy('Подбираю учебные группы…', async () => {
            const subjects = [...new Set(s.schedule.map((c) => c.subject))].join(', ');
            const r = await aiJSON(`${world(s)}\n\nПредложи 3 учебные группы для студента по его предметам: ${subjects}.\nФормат: [{"name":"","subject":"","when":"когда собираются"}]`);
            s.groupOffers = Array.isArray(r) ? r.filter((g) => g && g.name).slice(0, 5).map((g) => ({ name: String(g.name).slice(0, 60), subject: String(g.subject || '').slice(0, 60), when: String(g.when || '').slice(0, 60) })) : [];
            if (!s.groupOffers.length) toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            save(s);
        }),
        joinGroup: (d, el, s) => {
            const g = (s.groupOffers || [])[+d.i];
            if (!g) return;
            const th = openThread(s, g.name, '', `${g.subject}; встречи: ${g.when}`, 'group');
            th.msgs.push({ sys: true, text: `Вы вступили в группу «${g.name}».`, t: Date.now() });
            save(s); render();
        },
        reenroll: (d, el, s) => {
            if (!confirm('Выйти на свободу? Правонарушения обнулятся, распорядок будет составлен заново.')) return;
            Object.assign(s, { strikes: [], expelled: false, expelReason: '', lowGpaSince: 0, quarter: { n: 1, start: NOW() }, enforceFrom: NOW(), attendance: {} });
            notify(s, '🕊️ Вы снова на свободе.', 'important');
            save(s); render();
        },
        changeFaculty: (d, el, s) => {
            if (!confirm('Сменить профессию? Будет составлен новый распорядок, текущие поручения отменятся.')) return;
            s.auth = false; s.schedule = []; s.tasks = s.tasks.filter((t) => t.done);
            ui.view = null;
            save(s); render();
        },

        /* сервисы */
        diet: (d) => { ui.diet = d.diet; render(); },
        order: (d, el, s) => {
            const grocery = d.kind === 'grocery';
            const m = (grocery ? (s.groceries || []) : s.menu).find((x) => x.id === d.id);
            if (m) placeFoodOrder(s, [{ item: m, qty: 1 }], grocery ? 'grocery' : 'food');
        },
        findMissing: (d, el, s) => {
            const grocery = ui.deliveryTab === 'grocery';
            const list = deliveryList(s);
            const text = val('sh-o-text');
            const { missing } = parseOrder(s, text, list);
            if (!missing.length) return;
            const tags = [...new Set(list.flatMap((m) => m.tags || []))];
            const prices = list.slice(0, 6).map((m) => `${m.title} — ${m.price} ₡`).join('; ');
            return withBusy('Ищу под заказ…', async () => {
                const r = await aiJSON(`${world(s)}\n\n${grocery ? 'Продуктовый магазин города с доставкой.' : 'Доставка готовой еды по городу из кафе и столовых.'} Житель хочет заказать то, чего нет в ассортименте: ${missing.join('; ')}.
Для каждой позиции реши, можно ли это реально ${grocery ? 'купить' : 'заказать'} в этом мире (${mundane(s) ? 'обычный современный город, без магии' : 'сверхъестественный мир этого университета — магические продукты здесь доступны'}). Если да — дай нормальное название по-русски${grocery ? ' с весом или объёмом' : ''}, место (${grocery ? 'магазин или лавка' : 'кафе или столовая'}), правдоподобную цену в ₡ (редкое и деликатесы дороже; для ориентира: ${prices}) и категорию из существующих: ${tags.join(', ')}. Если нельзя — коротко объясни почему и предложи замену из доступного, если она есть.
Формат: [{"query":"как написал житель","ok":true,"title":"","place":"","price":120,"tag":"","reason":"","substitute":""}]`);
                const res = (Array.isArray(r) ? r : []).filter((x) => x && x.query);
                if (!res.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
                const found = {}, refused = [];
                for (const x of res) {
                    const q = String(x.query).trim().toLowerCase();
                    if ((x.ok === true || x.ok === 'true') && x.title && +x.price > 0) {
                        const it = { id: uid(), title: cleanMsg(x.title).slice(0, 80), place: cleanMsg(x.place || (grocery ? 'Минимаркет города' : 'Кафе города')).slice(0, 60), price: clamp(Math.round(+x.price), 10, 2000), tags: [String(x.tag || tags[0] || 'другое').toLowerCase().slice(0, 24)], special: true };
                        list.unshift(it);
                        found[q] = it.title;
                    } else refused.push(`${x.query}${x.reason ? ` — ${cleanMsg(x.reason)}` : ''}${x.substitute ? `. Замена: ${cleanMsg(x.substitute)}` : ''}`);
                }
                // подставляем найденные названия прямо в текст заказа
                const ta = byId('sh-o-text');
                if (ta) ta.value = String(text).split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => {
                    const m = /^(\d+)\s*(шт\.?|x|х|×)?\s+/i.exec(p) || /\s*(x|х|×)\s*(\d+)\s*$/i.exec(p);
                    const bare = m ? (m.index === 0 ? p.slice(m[0].length) : p.slice(0, m.index)) : p;
                    const t = found[bare.trim().toLowerCase()];
                    if (!t) return p;
                    const qty = m ? (m.index === 0 ? m[1] : m[2]) : '';
                    return `${qty ? `${qty} ` : ''}${t}`;
                }).join(', ');
                const n = Object.keys(found).length;
                if (n) toast('success', `Найдено под заказ: ${Object.values(found).join(', ')}. Добавлено ${grocery ? 'в магазин' : 'в меню'} и в ваш заказ.`);
                if (refused.length) toast('warning', `Не получилось: ${refused.join('; ')}`);
                save(s);
            });
        },
        orderText: (d, el, s) => {
            const text = val('sh-o-text');
            const grocery = ui.deliveryTab === 'grocery';
            const { lines, missing } = parseOrder(s, text, deliveryList(s));
            const where = grocery ? 'в магазине' : 'в меню';
            if (!lines.length) return toast('warning', missing.length ? `Этого нет ${where}: ${missing.join(', ')}. Обновите список или выберите из него.` : 'Впишите, что хотите заказать, через запятую.');
            if (missing.length && !confirm(`Этого нет ${where}, оно не войдёт в заказ: ${missing.join(', ')}. Заказать остальное?`)) return;
            if (placeFoodOrder(s, lines, grocery ? 'grocery' : 'food')) { const e = byId('sh-o-text'); if (e) e.value = ''; render(); }
        },
        parcel: (d, el, s) => {
            const to = val('sh-p-to'), what = val('sh-p-what');
            if (!to || !what) return toast('warning', 'Укажите получателя и содержимое.');
            if (!pay(s, 60, `Посылка для ${to}`)) return render();
            const now = NOW();
            s.orders.unshift({ id: uid(), kind: 'parcel', to, title: what, price: 60, t: now, eta: now + (40 + Math.floor(Math.random() * 50)) * MIN });
            toast('success', 'Посылка отправлена.');
            save(s); render();
        },
        genMenu: (d, el, s) => withBusy('Обновляю меню…', async () => {
            const story = recentStory(15);
            const r = await aiJSON(`${world(s)}\n\n${mundane(s) ? 'Составь меню доставки по городу: кофе и напитки, выпечка и десерты, завтраки, ланчи, пицца, суши и азиатское, веганское, халяль, без глютена и т.п. Реалистичные кафе и столовые, цены в ₡ от 60 до 400.' : 'Составь меню доставки по городу для разных видов (кровь, сырое мясо, веган, нектар, эктоплазма, эмоции, огнеупорная еда, обычная еда и т.п.). Кафе и точки должны звучать как места этого университета.'}
Нужно 28–32 позиции. Выбери 6–8 категорий (теги) и сделай в КАЖДОЙ категории минимум 4 позиции; у позиции 1–2 тега из этого набора. Названия блюд на русском.
${story ? `Последние события истории:\n${story}\nЕсли в истории ${ctx().name2} или кто-то из жителей упоминал, что хочет съесть или выпить что-то конкретное, — обязательно добавь это в меню (в подходящее кафе) и укажи wishedBy: имя того, кто хотел.\n` : ''}Формат: [{"title":"","place":"","price":150,"tags":["веган"],"wishedBy":""}] — теги короткие, строчными буквами.`);
            const list = Array.isArray(r) ? r.filter((m) => m && m.title && +m.price > 0) : [];
            if (!list.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            s.menu = list.map((m) => ({ id: uid(), title: cleanMsg(m.title).slice(0, 80), place: cleanMsg(m.place || '').slice(0, 60), price: Math.round(+m.price), tags: (Array.isArray(m.tags) ? m.tags : []).map((t) => String(t).toLowerCase().slice(0, 20)).slice(0, 3), wishedBy: cleanName(m.wishedBy || '') }));
            s.menu.sort((a, b) => (b.wishedBy ? 1 : 0) - (a.wishedBy ? 1 : 0));
            ui.diet = 'all';
            save(s);
        }),

        dTab: (d) => { ui.deliveryTab = d.t; const e = byId('sh-o-text'); if (e) e.value = ''; render(); },
        gcat: (d) => { ui.gcat = d.c; render(); },
        genGroceries: (d, el, s) => withBusy('Обновляю продукты…', async () => {
            const story = recentStory(15);
            const r = await aiJSON(`${world(s)}\n\nСоставь ассортимент продуктового магазина города для доставки: 32–36 продуктов для готовки, 7–9 категорий (молочное, мясо и рыба, бакалея, овощи и зелень, фрукты, хлеб и сладкое, специи и напитки${mundane(s) ? '' : ', продукты для разных видов этого мира'} и т.п.), минимум 3 продукта в каждой категории. Названия на русском, с объёмом или весом, где уместно. Цены в ₡ от 20 до 300.
${story ? `Последние события истории:\n${story}\nЕсли в истории ${ctx().name2}, ${s.profile.name} или кто-то ещё собирался приготовить конкретное блюдо — обязательно включи ВСЕ нужные для него ингредиенты и у каждого укажи forDish: название блюда.\n` : ''}Формат: [{"title":"","place":"магазин","price":80,"tags":["бакалея"],"forDish":""}] — одна категория в tags, строчными буквами.`);
            const list = (Array.isArray(r) ? r : []).filter((m) => m && m.title && +m.price > 0);
            if (!list.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            s.groceries = list.map((m) => ({ id: uid(), title: cleanMsg(m.title).slice(0, 80), place: cleanMsg(m.place || 'Минимаркет города').slice(0, 60), price: Math.round(+m.price), tags: (Array.isArray(m.tags) ? m.tags : []).map((t) => String(t).toLowerCase().slice(0, 24)).slice(0, 1), forDish: cleanMsg(m.forDish || '').slice(0, 60) }));
            s.groceries.sort((a, b) => (b.forDish ? 1 : 0) - (a.forDish ? 1 : 0));
            ui.gcat = 'all';
            const dishes = [...new Set(s.groceries.map((g) => g.forDish).filter(Boolean))];
            if (dishes.length) toast('info', `Отмечены продукты для: ${dishes.join(', ')}`);
            save(s);
        }),
        mTab: (d) => { ui.marketTab = d.t; render(); },
        marketClear: () => { ui.mq = ''; const e = byId('sh-mk-q'); if (e) e.value = ''; render(); },
        marketSearch: (d, el, s) => {
            ui.mq = val('sh-mk-q'); ui.mcat = 'all';
            if (!ui.mq) return render();
            const qw = ui.mq.toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 3).map((w) => w.slice(0, 5));
            const has = s.market.some((m) => qw.some((w) => m.title.toLowerCase().includes(w)));
            render();
            if (!has) return ACT.marketFind(d, el, s);
        },
        marketFind: (d, el, s) => {
            const q = ui.mq || val('sh-mk-q');
            if (!q) return toast('warning', 'Напишите, что ищете.');
            return withBusy('Ищу у жителей…', async () => {
                const r = await aiJSON(`${world(s)}\n\nЖитель ищет на маркетплейсе города: «${q}». Сгенерируй 3–5 объявлений от разных жителей (или магазинчиков города), которые продают или сдают именно это или близкие варианты — разное состояние, разные цены (новое дороже, б/у дешевле).${mundane(s) ? ' Только реальные вещи обычного мира, без магии.' : ' Вещи в духе этого сверхъестественного мира допустимы.'} Если такое в этом мире купить невозможно — верни пустой массив.
Категория — одна из: ${MARKET_CATS.join(', ')}. Цены в ₡, для ориентира: одежда 300–3000, мебель 800–6000, электроника 1000–15000, книги 100–800.
Формат: [{"title":"","cat":"","price":500,"rent":0,"seller":"имя, курс","rating":4.5,"verified":true}] — rent: цена аренды в неделю или 0.`);
                const list = (Array.isArray(r) ? r : []).filter((m) => m && m.title && +m.price > 0);
                if (!list.length) return toast('info', `Никто на городе не продаёт «${q}». Попробуйте сформулировать иначе.`);
                const add = list.map((m) => ({ id: uid(), title: cleanMsg(m.title).slice(0, 80), cat: MARKET_CATS.includes(m.cat) ? m.cat : 'Для дома', price: Math.round(+m.price), rent: Math.max(0, Math.round(+m.rent || 0)), seller: cleanMsg(m.seller || 'Житель').slice(0, 40), rating: clamp(+m.rating || 4, 1, 5), verified: m.verified !== false, found: true }));
                s.market = [...add, ...s.market].slice(0, 60);
                ui.mq = q; ui.mcat = 'all';
                toast('success', `Найдено предложений: ${add.length}`);
                save(s);
            });
        },
        mcat: (d) => { ui.mcat = d.c; render(); },
        buy: (d, el, s) => {
            const m = s.market.find((x) => x.id === d.id);
            if (!m || !pay(s, m.price, `Покупка: ${m.title}`)) return render();
            s.market = s.market.filter((x) => x.id !== m.id);
            s.inventory.unshift({ title: m.title, t: Date.now() });
            questEvent(s, 'buy');
            toast('success', `Куплено: ${m.title}.`);
            save(s); render();
        },
        rent: (d, el, s) => {
            const m = s.market.find((x) => x.id === d.id);
            if (!m || !m.rent || !pay(s, m.rent, `Аренда на неделю: ${m.title}`)) return render();
            s.market = s.market.filter((x) => x.id !== m.id);
            s.inventory.unshift({ title: m.title, t: Date.now(), rentUntil: Date.now() + 7 * DAY });
            questEvent(s, 'buy');
            toast('success', `Арендовано на неделю: ${m.title}.`);
            save(s); render();
        },
        sell: (d, el, s) => {
            const title = val('sh-s-title'), price = Math.round(+val('sh-s-price'));
            if (!title || !(price > 0)) return toast('warning', 'Укажите название и цену.');
            s.listings.unshift({ id: uid(), title, cat: val('sh-s-cat'), price, t: Date.now(), sold: false });
            toast('success', 'Объявление опубликовано.');
            save(s); render();
        },
        genMarket: (d, el, s) => withBusy('Загружаю объявления…', async () => {
            const r = await aiJSON(`${world(s)}\n\n${mundane(s) ? 'Сгенерируй 16 объявлений городской барахолки: мебель, электроника, одежда, книги, спорт, товары для дома и детей и т.п. Никакой магии, реалистичные цены в ₡' : 'Сгенерируй 16 объявлений маркетплейса жителей: учебники, мебель, электроника и специализированное оборудование для разных видов'}.\nФормат: [{"title":"","cat":"Учебники|Мебель|Электроника|Оборудование","price":500,"rent":0,"seller":"имя","rating":4.5,"verified":true}] — rent: цена аренды в неделю или 0.`);
            const list = Array.isArray(r) ? r.filter((m) => m && m.title && +m.price > 0) : [];
            if (!list.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            s.market = [...s.market.filter((m) => m.found), ...list.map((m) => ({ id: uid(), title: String(m.title).slice(0, 80), cat: MARKET_CATS.includes(m.cat) ? m.cat : 'Для дома', price: Math.round(+m.price), rent: Math.max(0, Math.round(+m.rent || 0)), seller: String(m.seller || 'Житель').slice(0, 40), rating: clamp(+m.rating || 4, 1, 5), verified: m.verified !== false }))].slice(0, 60);
            save(s);
        }),

        transfer: (d, el, s) => {
            const to = val('sh-w-to'), sum = Math.round(+val('sh-w-sum')), note = val('sh-w-note');
            if (!to || !(sum > 0)) return toast('warning', 'Укажите получателя и сумму.');
            if (!pay(s, sum, `Перевод: ${to}${note ? ` (${note})` : ''}`)) return render();
            const th = s.threads.find((t) => t.name.toLowerCase() === to.toLowerCase());
            if (th) th.msgs.push({ sys: true, text: `Вы перевели ${money(sum)}${note ? `: ${note}` : ''}.`, t: Date.now() });
            ['sh-w-to', 'sh-w-sum', 'sh-w-note'].forEach((id) => { const e = byId(id); if (e) e.value = ''; });
            toast('success', `Переведено ${money(sum)} для ${to}.`);
            save(s); render();
        },

        findClubs: (d, el, s) => withBusy('Ищу клубы…', async () => {
            const n = await genClubs(s);
            toast(n ? 'success' : 'error', n ? `Найдено клубов: ${n}` : 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
        }),
        campusLore: (d, el, s) => withBusy('Читаю лор города…', async () => {
            const n = await extractCampusLore(s);
            toast(n ? 'success' : 'info', n ? `Из лора добавлено клубов и мероприятий: ${n}` : 'В лоре не нашлось клубов и мероприятий.');
        }),
        genEvents: (d, el, s) => withBusy('Ищу мероприятия…', async () => {
            const loreEv = await loreText(/мероприят|праздник|бал|фестивал|турнир|концерт|вечеринк|традици|ярмарк|event|festival|party|tradition/i);
            const r = await aiJSON(`${world(s)}\n${loreEv ? `\nЛор о событиях и традициях города:\n${loreEv.slice(0, 2500)}\nЕсли там описаны мероприятия или традиции — используй их в первую очередь.\n` : ''}\nПридумай 4 ближайших городских мероприятия (концерты, ярмарки, выставки, спортивные матчи, фестивали, лекции, благотворительные акции, вечеринки).\nФормат: [{"title":"","when":"например: пятница, 19:00","place":"","desc":"одно предложение"}]`);
            const list = Array.isArray(r) ? r.filter((e) => e && e.title) : [];
            if (!list.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            s.events = [...s.events.filter((e) => e.lore), ...list.map((e) => ({ id: uid(), title: String(e.title).slice(0, 80), when: String(e.when || '').slice(0, 50), place: String(e.place || '').slice(0, 60), desc: String(e.desc || '').slice(0, 200), going: false }))].slice(0, 12);
            save(s);
        }),
        rsvp: (d, el, s) => { const e = s.events.find((x) => x.id === d.id); if (e) { e.going = !e.going; save(s); render(); } },
        club: (d, el, s) => { s.clubs = s.clubs.includes(d.c) ? s.clubs.filter((c) => c !== d.c) : [...s.clubs, d.c]; save(s); render(); },
        book: (d, el, s) => {
            const dr = bookingDraft(s);
            if (dr.need) return toast('warning', dr.need);
            if (!dr.price) return toast('warning', 'Не удалось посчитать стоимость — проверьте поля.');
            if (dr.start && dr.start < NOW() - HOUR) return toast('warning', 'Выберите дату в будущем.');
            const finish = (b) => {
                s.bookings.unshift(b);
                if (b.status === 'ok' && b.start) {
                    s.meetings.push({ id: uid(), with: b.title, threadId: null, kind: 'booking', place: 'custom', placeText: '', note: b.title, at: b.start, status: 'accepted', created: Date.now() });
                }
                save(s); render();
            };
            const b = { id: uid(), type: ui.bk || 'room', title: dr.title, price: dr.price, start: dr.start, end: dr.end, t: Date.now() };
            if (!dr.owner) {
                if (!pay(s, dr.price, `Бронь: ${dr.title}`)) return render();
                toast('success', `Забронировано: ${dr.title} — ${money(dr.price)}.`);
                return finish({ ...b, status: 'ok' });
            }
            if (s.wallet.balance < dr.price) return toast('error', `Недостаточно средств: нужно ${money(dr.price)}, на счёте ${money(s.wallet.balance)}.`);
            return withBusy('Ждём ответа хозяина…', async () => {
                const r = await aiJSON(`${world(s)}\n\n${s.profile.name} (${AGE_GROUPS[s.profile.age] || ''} лет, ${s.profile.profession}, рейтинг законопослушности ${rating(s)}%) отправляет через CityHub запрос: ${dr.title}${dr.start ? `, с ${fmtDay(dr.start)}` : ''}${dr.end ? ` по ${fmtDay(dr.end)}` : ''}, цена ${money(dr.price)}. Ты — хозяин${dr.buy ? ' или продавец' : ''}. ${dr.easy ? 'Базы отдыха почти всегда соглашаются, отказывают редко (занято, ремонт).' : 'Реши по-человечески: хозяева бывают разные — кто-то соглашается, кто-то отказывает (нет свободных дат, не сдают студентам или с животными, сомневаются в платёжеспособности, низкий рейтинг жильца и т.п.).'}
Формат: {"accept":true,"reason":"если отказ — причина одной фразой","owner":"имя хозяина","reply":"короткое сообщение хозяина"}`);
                if (S() !== s) return;
                const ok = r?.accept === true || r?.accept === 'true' || (!r && dr.easy);
                const owner = cleanName(r?.owner) || 'Хозяин';
                if (r?.reply) {
                    let th = s.threads.find((x) => x.name === owner);
                    if (!th) { th = { id: uid(), name: owner, species: '', bio: `сдаёт или продаёт: ${dr.title}`, kind: 'dm', msgs: [], t: Date.now(), unread: 0, rel: 10, known: true, status: 'деловые' }; s.threads.unshift(th); }
                    th.msgs.push({ me: false, text: cleanMsg(r.reply).slice(0, 400), t: Date.now() }); th.unread = (th.unread || 0) + 1; th.t = Date.now();
                }
                if (ok) {
                    if (!pay(s, dr.price, `${dr.buy ? 'Покупка' : 'Бронь'}: ${dr.title}`)) return;
                    notify(s, `🔑 ${owner} согласен(на): ${dr.title}.`, 'important', { view: 'campus' });
                    finish({ ...b, status: 'ok' });
                } else {
                    notify(s, `🚫 ${owner} отказал(а): ${cleanMsg(r?.reason || 'без объяснения причин')}`, 'warn', { view: 'campus' });
                    finish({ ...b, status: 'no', reason: cleanMsg(r?.reason || '').slice(0, 120) });
                }
            });
        },
        ticket: (d, el, s) => {
            const text = val('sh-t-text');
            if (!text) return toast('warning', 'Опишите проблему.');
            const type = val('sh-t-type') === '__other' ? (val('sh-t-topic') || 'Другое') : val('sh-t-type');
            s.tickets.unshift({ id: uid(), type, text, t: Date.now() });
            byId('sh-t-text').value = '';
            if (/сантехник/i.test(type)) orderService(s, 'Сантехник', text, 0);
            if (/президент|благоустройств|жалоб/i.test(type)) enqueue(s, async () => {
                const r = await aiJSON(`${world(s)}\n\nЖитель ${s.profile.name} отправил обращение «${type}»: «${text}». Напиши официальный ответ ведомства (администрация президента, мэрия, соответствующая служба). Ответы бывают разные: помогут, отпишутся, перенаправят.\nФормат: {"from":"ведомство","text":"2–3 предложения"}`);
                if (!r?.text) return;
                const from = cleanName(r.from) || 'Городская администрация';
                let th = s.threads.find((x) => x.name === from);
                if (!th) { th = { id: uid(), name: from, species: '', bio: 'государственное ведомство', kind: 'official', msgs: [], t: Date.now(), unread: 0, rel: 0 }; s.threads.unshift(th); }
                th.msgs.push({ me: false, text: `📜 ${cleanMsg(r.text).slice(0, 700)}`, t: Date.now() }); th.unread = (th.unread || 0) + 1; th.t = Date.now();
                notify(s, `📜 Ответ: ${from}`, 'social', { view: 'thread', param: th.id });
            });
            toast('success', 'Обращение отправлено.');
            save(s); render();
        },
        sos: (d, el, s) => {
            notify(s, '🚨 Вызов 112 отправлен.', 'bad');
            fillChatInput(`*${s.profile.name} нажимает в CityHub кнопку экстренного вызова 112. Диспетчер получает сигнал с геолокацией, к месту выезжают экстренные службы.*`);
            toast('info', 'Текст вызова вставлен в поле ввода чата — отправьте его, чтобы история отреагировала.');
            save(s); render();
        },

        saveProfile: (d, el, s) => {
            const p = s.profile;
            p.name = val('sh-pf-name') || p.name; readIdentity('sh-pf', p); p.bio = val('sh-pf-bio');
            toast('success', 'Профиль сохранён.');
            save(s); render();
        },
        pause: (d, el, s) => {
            const now = Date.now();
            if (s.pausedAt) {
                const delta = now - s.pausedAt;
                for (const t of s.tasks) if (!t.done && !t.expired && !t.overdue) t.deadline += delta;
                if (s.lowGpaSince) s.lowGpaSince += delta;
                s.quarter.start += delta;
                s.pauses.push([s.pausedAt, now]);
                s.pausedAt = 0;
                toast('success', 'Время учёбы снова идёт.');
            } else { s.pausedAt = now; toast('info', 'Учёба на паузе.'); }
            save(s); render();
        },
        gmBalance: (d, el, s) => {
            const v = Math.round(+val('sh-gm-bal'));
            if (!Number.isFinite(v)) return;
            tx(s, v - s.wallet.balance, 'Корректировка мастером игры');
            save(s); render();
        },
        resetChat: () => {
            if (!confirm('Удалить все данные CityHub в этом чате? Это необратимо.')) return;
            delete ctx().chatMetadata[MODULE]; delete ctx().chatMetadata[OLD_MODULE];
            ui.view = null; ui.tab = 'feed';
            save(); render();
        },
    };

    function onClick(e) {
        const el = e.target.closest('[data-act]');
        if (!el || el.disabled) return;
        e.preventDefault();
        const fn = ACT[el.dataset.act];
        if (!fn) return;
        const s = S();
        Promise.resolve(fn(el.dataset, el, s)).catch((err) => { logErr('Действие ' + el.dataset.act, err); toast('error', String(err?.message || err)); });
    }
    function onChange(e) {
        const el = e.target;
        const s = S();
        const k = el.dataset?.k;
        if (el.dataset.change === 'bkType') { ui.bk = el.value; render(); return; }
        if (el.dataset.change === 'svcType') { ui.svc = el.value; render(); return; }
        if (el.dataset.change === 'bkCalc') { render(); return; }
        if (el.dataset.change === 'idSel') {
            const box = byId(el.dataset.other);
            if (box) box.style.display = el.value === '__other' ? '' : 'none';
            return;
        }
        if (el.dataset.change === 'relChar' && s) { s.profile.relWithChar = el.checked; save(s); render(); return; }
        if (el.dataset.change === 'privacy' && s) { s.profile.privacy[k] = el.checked; save(s); render(); }
        else if (el.dataset.change === 'cfg') { const n = Number(el.value); if (Number.isFinite(n)) { cfg()[k] = n; saveCfg(); updateInjection(); } }
        else if (el.dataset.change === 'cfgBool') { cfg()[k] = el.checked; saveCfg(); updateInjection(); updateFab(); }
    }
    function onKey(e) {
        e.stopPropagation();
        if (e.key === 'Enter' && e.target.id === 'sh-mk-q') { e.preventDefault(); document.querySelector('#cityhub-phone [data-act="marketSearch"]')?.click(); return; }
        if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'sh-cmt') {
            e.preventDefault();
            document.querySelector('#cityhub-phone [data-act="comment"]')?.click();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'sh-msg') {
            e.preventDefault();
            document.querySelector('#cityhub-phone [data-act="send"]')?.click();
        }
    }

    /* ───────────────────────── монтирование ───────────────────────── */

    // системная кнопка «Назад» на Android: сначала возвращает из подэкрана, затем закрывает приложение
    let skipPop = false;
    function toggle(force) {
        const want = typeof force === 'boolean' ? force : !ui.open;
        if (want === ui.open) { if (want) render(); return; }
        ui.open = want;
        byId('cityhub-phone')?.classList.toggle('open', ui.open);
        byId('cityhub-fab')?.classList.toggle('hidden', ui.open);
        if (ui.open) {
            lastKey = ''; render();
            try { history.pushState({ cityhub: true }, ''); } catch { /* нет history */ }
        } else if (history.state?.cityhub) {
            skipPop = true;
            history.back();
        }
    }
    window.addEventListener('popstate', () => {
        if (skipPop) { skipPop = false; return; }
        if (!ui.open) return;
        if (ui.view) {
            ui.view = null; ui.param = null; render();
            try { history.pushState({ cityhub: true }, ''); } catch { /* нет history */ }
        } else {
            ui.open = false;
            byId('cityhub-phone')?.classList.remove('open');
            byId('cityhub-fab')?.classList.remove('hidden');
        }
    });

    function mount() {
        if (byId('cityhub-phone')) return;


        const ph = document.createElement('div');
        ph.id = 'cityhub-phone';
        ph.innerHTML = '<div class="sh-status"></div><div class="sh-screen"></div><nav class="sh-nav"></nav><div class="sh-overlay"></div>';
        ph.dataset.theme = THEMES[cfg().theme] ? cfg().theme : 'pearl';
        ph.addEventListener('click', onClick);
        ph.addEventListener('change', onChange);
        ph.addEventListener('input', (e) => {
            if (e.target?.id !== 'sh-o-text') return;
            const s = S(), box = byId('sh-o-prev');
            if (s && box) box.innerHTML = orderPreview(s, e.target.value);
        });
        ph.addEventListener('keydown', onKey);
        document.body.appendChild(ph);

        const menu = byId('extensionsMenu');
        if (menu) {
            const it = document.createElement('div');
            it.className = 'list-group-item flex-container flexGap5 interactable';
            it.tabIndex = 0;
            it.innerHTML = '<div class="fa-solid fa-graduation-cap extensionsMenuExtensionButton"></div>CityHub';
            it.addEventListener('click', () => toggle(true));
            menu.appendChild(it);
        }

        const box = byId('extensions_settings2') || byId('extensions_settings');
        if (box) {
            box.insertAdjacentHTML('beforeend', `<div class="cityhub-settings"><div class="inline-drawer">
              <div class="inline-drawer-toggle inline-drawer-header"><b>CityHub</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
              <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="sh-cfg-inject"> <span>Передавать статус жителя ИИ</span></label>
                <div class="menu_button" id="sh-cfg-open"><i class="fa-solid fa-mobile-screen-button"></i> Открыть CityHub</div>
                <div class="menu_button" id="sh-cfg-log"><i class="fa-solid fa-bug"></i> Журнал ошибок</div>
              </div></div></div>`);
            const i = byId('sh-cfg-inject');
            i.checked = !!cfg().inject;
            i.addEventListener('change', () => { cfg().inject = i.checked; saveCfg(); updateInjection(); });
            byId('sh-cfg-open').addEventListener('click', () => toggle(true));
            byId('sh-cfg-log').addEventListener('click', () => { ui.view = 'log'; toggle(true); });
        }
    }

    function checkFab() {
        const fab = byId('cityhub-fab');
        if (!fab) return;
        if (!cfg().showFab) return;
        const r = fab.getBoundingClientRect(), cs = getComputedStyle(fab);
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const covered = top && !fab.contains(top);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || r.width === 0 || covered) {
            logErr('Плавающая кнопка не видна', { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, zIndex: cs.zIndex, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), screen: `${innerWidth}x${innerHeight}`, coveredBy: covered ? `${top.tagName}#${top.id}.${String(top.className).slice(0, 60)}` : '' });
        }
        const foreign = ['sh-phone', 'sh-fab', 'studyhub-phone'].filter((id) => document.getElementById(id));
        if (foreign.length) logErr('Найдено другое похожее расширение', `элементы: ${foreign.join(', ')} — возможен конфликт, попробуйте отключить StudyHub 0.3.0`);
    }

    function onChatChanged() {
        ui.view = null; ui.param = null; lastKey = '';
        const s0 = S();
        if (s0 && s0.auth && !s0.campusLoreAt) enqueue(s0, async () => { await extractCampusLore(s0); });
        if (s0 && s0.auth && !s0.genClubsAt) enqueue(s0, async () => { await genClubs(s0); });
        if (s0 && s0.auth && !s0.lorePeopleAt) enqueue(s0, async () => { const n = await extractLorePeople(s0); if (n) notify(s0, `👥 В CityHub появились люди из вашего мира: ${n}`, 'important'); });
        tick();
        updateInjection();
        render();
    }

    function init() {
        cfg();
        mount();
        const { eventSource, event_types } = ctx();
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, () => { try { onStoryReply(); } catch (e) { logErr('Доставка', e); } onStoryMessage().catch((e) => logErr('Часы истории', e)); });
        if (event_types.GENERATION_STARTED) eventSource.on(event_types.GENERATION_STARTED, () => { try { updateInjection(); } catch (e) { logErr('Инъекция', e); } });
        setInterval(() => {
            try { tick(); } catch (e) { logErr('Таймер', e); }
            updateInjection();
            if (!ui.open) return updateFab();
            if (isTyping()) {
                const st = document.querySelector('#cityhub-phone .sh-status');
                if (st) st.innerHTML = statusBar();
                updateFab();
            } else render();
        }, 30000);
        onChatChanged();
        setTimeout(checkFab, 3000);
        console.log('[CityHub] загружено');
    }

    globalThis.CityHub = { open: () => toggle(true), close: () => toggle(false), state: S, tick, _act: ACT, _inj: buildInjection, _ui: ui };
    jQuery(() => {
        try { init(); }
        catch (e) {
            logErr('Запуск', e);
            try { toastr.error(`CityHub не запустился: ${e.message}`, 'CityHub', { timeOut: 0, extendedTimeOut: 0 }); } catch { /* нет toastr */ }
        }
    });
})();
