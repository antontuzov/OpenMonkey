const STRINGS = {
  en: {
    "nav.features": "Product",
    "nav.screens": "Screenshots",
    "nav.download": "Download",
    "hero.cta": "Get OpenMonkey",
    "hero.github": "GitHub",
    "hero.docs": "Documentation",
    "hero.sub": "A local AI agent that lives on your machine: chat with a model that never leaves your disk, run tools behind approval gates, and watch twelve moods say how it is going.",
    "terminal.copy": "Copy",
    "terminal.done": "Copied",
    "terminal.fromSource": "from source",
    "stat.cold": "Cold start to first paint",
    "stat.memory": "Idle shell before a model loads",
    "stat.telemetry": "Telemetry calls, ever",
    "stat.moods": "Moods driving window, tray and Dock",
    "features.title": "Why OpenMonkey",
    "feature.one.title": "Nothing leaves your Mac",
    "feature.one.body":
      "There is no account, no telemetry and no API key. History is sealed with AES-256-GCM under a Keychain key, and the renderer cannot reach the network at all.",
    "feature.two.title": "Twelve moods, one agent",
    "feature.two.body":
      "The portrait in the window, the menu bar icon and the Dock badge change with the conversation, so you can read how the work is going from across the desk.",
    "feature.three.title": "Every tool asks first",
    "feature.three.body":
      "File writes, shell commands, web fetches and calendar changes stop at a dialog showing the tool and its arguments. Approve once, deny, or remember the choice for the session.",
    "feature.three.note": "Every tool action waits for a decision and lands in the audit log.",
    "feature.four.title": "Fast enough to live in",
    "feature.four.body":
      "Tokens are batched into one render per frame, the settings screen loads as its own chunk, and a performance suite fails the build when the numbers drift.",
    "feature.four.label": "measured while streaming",
    "feature.five.title": "Ask from anywhere",
    "feature.five.body":
      "Quick Ask opens with Option+Space, answers from the same model, and can approve a tool inline. A live task monitor shows what the agent is doing right now.",
    "gallery.title": "The app itself",
    "gallery.one": "First run: download the model and pick a mood.",
    "gallery.two": "Privacy: encryption, lock, retention, network switch.",
    "gallery.three": "Desktop: theme, text scale, update channel.",
    "download.title": "Get OpenMonkey",
    "download.lede":
      "The app is free and open source. It runs the model on your hardware, so you need the weights once and a machine that can hold them.",
    "download.mac": "Ventura 13 or newer, Apple Silicon and Intel. Around 2 GB of memory once the model is loaded.",
    "download.win": "Windows 10 or newer with the GGUF backend. macOS-only tools stay disabled until the model is present.",
    "download.source.title": "From source",
    "download.source.body": "Node 22.12 or newer. One install command, one dev command, the model downloads itself.",
    "download.note":
      "Release artifacts are produced by the tag pipeline. Builds you make locally are unsigned, so Gatekeeper asks once.",
    "foot.privacy": "Privacy",
    "foot.models": "Models",
    "foot.support": "Support",
    "foot.changelog": "Changelog",
    "foot.legal": "MIT licensed. Built for people who want their assistant on their own hardware.",
  },
  ru: {
    "nav.features": "Продукт",
    "nav.screens": "Скриншоты",
    "nav.download": "Скачать",
    "hero.cta": "Получить OpenMonkey",
    "hero.github": "GitHub",
    "hero.docs": "Документация",
    "hero.sub":
      "Локальный ИИ-агент, который живёт на вашей машине: чат с моделью, которая не покидает ваш диск, инструменты за подтверждением и двенадцать настроений, показывающих, что происходит.",
    "terminal.copy": "Копировать",
    "terminal.done": "Скопировано",
    "terminal.fromSource": "из исходников",
    "stat.cold": "Холодный старт до первого кадра",
    "stat.memory": "Оболочка без загруженной модели",
    "stat.telemetry": "Телеметрия — никогда",
    "stat.moods": "Настроений в окне, трее и Dock",
    "features.title": "Почему OpenMonkey",
    "feature.one.title": "Ничего не покидает ваш Mac",
    "feature.one.body":
      "Ни аккаунта, ни телеметрии, ни API-ключа. История шифруется AES-256-GCM ключом из Keychain, а процесс интерфейса вообще не может выйти в сеть.",
    "feature.two.title": "Двенадцать настроений, один агент",
    "feature.two.body":
      "Портрет в окне, значок в строке меню и бейдж в Dock меняются по ходу разговора — состояние работы видно через весь стол.",
    "feature.three.title": "Каждый инструмент спрашивает",
    "feature.three.body":
      "Запись файлов, команды, запросы в сеть и правки календаря останавливаются на диалоге с самим инструментом и его аргументами. Разрешить один раз, запретить или запомнить на сессию.",
    "feature.three.note": "Каждое действие ждёт решения и попадает в журнал аудита.",
    "feature.four.title": "Достаточно быстро, чтобы жить рядом",
    "feature.four.body":
      "Токены склеиваются в один кадр рендера, настройки грузятся отдельным чанком, а набор тестов производительности останавливает сборку при отклонении цифр.",
    "feature.four.label": "замерено во время стрима",
    "feature.five.title": "Спросите откуда угодно",
    "feature.five.body":
      "Quick Ask открывается на Option+Space, отвечает той же моделью и умеет подтверждать инструмент прямо в popover. Живой монитор задач показывает, что агент делает сейчас.",
    "gallery.title": "Само приложение",
    "gallery.one": "Первый запуск: скачать модель и выбрать настроение.",
    "gallery.two": "Приватность: шифрование, блокировка, хранение, сеть.",
    "gallery.three": "Рабочий стол: тема, размер текста, канал обновлений.",
    "download.title": "Получить OpenMonkey",
    "download.lede":
      "Приложение бесплатное и с открытым кодом. Модель работает на вашем железе, поэтому веса нужны один раз, а машина — с запасом памяти.",
    "download.mac": "Ventura 13 или новее, Apple Silicon и Intel. Около 2 ГБ памяти после загрузки модели.",
    "download.win": "Windows 10 или новее с GGUF-бэкендом. Инструменты macOS остаются выключены, пока нет модели.",
    "download.source.title": "Из исходников",
    "download.source.body": "Node 22.12 или новее. Одна команда установки, одна команда запуска, модель скачивается сама.",
    "download.note":
      "Релизные сборки собирает пайплайн по тегу. Локальные сборки не подписаны, поэтому Gatekeeper спросит один раз.",
    "foot.privacy": "Приватность",
    "foot.models": "Модели",
    "foot.support": "Поддержка",
    "foot.changelog": "Изменения",
    "foot.legal": "Лицензия MIT. Для тех, кому нужен ассистент на собственном железе.",
  },
};

const COMMANDS = {
  macos: "git clone https://github.com/antontuzov/OpenMonkey.git && cd OpenMonkey && npm install && npm run dev",
  windows: "git clone https://github.com/antontuzov/OpenMonkey.git && cd OpenMonkey && npm install && npm run dev",
};

const state = { lang: "en", platform: "macos" };

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function t(key) {
  return STRINGS[state.lang][key] ?? STRINGS.en[key] ?? key;
}

function applyStrings() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const value = t(node.dataset.i18n);
    if (value) node.textContent = value;
  });
  document.documentElement.lang = state.lang;
}

function splitChars(element) {
  const text = element.dataset.text ?? element.textContent;
  element.dataset.text = text;
  element.textContent = "";
  Array.from(text).forEach((character, index) => {
    const span = document.createElement("span");
    span.className = "char";
    span.textContent = character === " " ? "\u00A0" : character;
    span.style.transitionDelay = `${index * 16}ms`;
    element.appendChild(span);
  });
}

function prepareAnimated() {
  document.querySelectorAll("[data-animate]").forEach((element) => {
    element.classList.remove("is-visible");
    splitChars(element);
  });
}

function observeAnimated() {
  const targets = document.querySelectorAll("[data-animate]");
  if (!("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.25 }
  );
  targets.forEach((target) => observer.observe(target));
}

function typeSubtitle() {
  const target = document.getElementById("typewriter");
  const text = t("hero.sub");
  if (prefersReducedMotion) {
    target.textContent = text;
    return;
  }
  target.textContent = "";
  let index = 0;
  const tick = () => {
    target.textContent = text.slice(0, index);
    index += 1;
    if (index <= text.length) window.setTimeout(tick, 26);
  };
  tick();
}

function renderCommand() {
  document.getElementById("terminal-command").textContent = COMMANDS[state.platform];
}

function setupCopy() {
  const button = document.getElementById("copy");
  button.addEventListener("click", async () => {
    const command = document.getElementById("terminal-command").textContent;
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      /* the browser may refuse clipboard access */
    }
    const label = button.querySelector(".copy-label");
    label.textContent = t("terminal.done");
    button.classList.add("is-done");
    window.setTimeout(() => {
      label.textContent = t("terminal.copy");
      button.classList.remove("is-done");
    }, 1600);
  });
}

function setupPlatforms() {
  document.querySelectorAll(".platform").forEach((pill) => {
    pill.addEventListener("click", () => {
      state.platform = pill.dataset.platform;
      document.querySelectorAll(".platform").forEach((other) => other.classList.toggle("is-on", other === pill));
      renderCommand();
    });
  });
}

function setupLanguage() {
  const button = document.getElementById("lang-toggle");
  const paint = () => {
    button.querySelector(".lang-on").textContent = state.lang === "en" ? "EN" : "RU";
    button.querySelector(".lang-off").textContent = state.lang === "en" ? "RU" : "EN";
  };
  button.addEventListener("click", () => {
    state.lang = state.lang === "en" ? "ru" : "en";
    applyStrings();
    prepareAnimated();
    observeAnimated();
    typeSubtitle();
    paint();
  });
  paint();
}

function setupInk() {
  const canvas = document.getElementById("ink");
  if (!canvas || prefersReducedMotion) return;
  const context = canvas.getContext("2d");
  const marks = [];
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener("resize", resize);

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const limit = window.innerHeight * 0.9;
    if (event.clientY > limit) return;
    marks.push({ x: event.clientX, y: event.clientY, radius: 6, alpha: 1 });
    if (marks.length > 220) marks.shift();
  });

  const paint = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const mark of marks) {
      mark.radius += 2.6;
      mark.alpha -= 0.006;
      const gradient = context.createRadialGradient(mark.x, mark.y, 0, mark.x, mark.y, mark.radius);
      gradient.addColorStop(0, `rgba(38, 37, 30, ${Math.max(0, mark.alpha) * 0.05})`);
      gradient.addColorStop(1, "rgba(38, 37, 30, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(mark.x, mark.y, mark.radius, 0, Math.PI * 2);
      context.fill();
    }
    for (let index = marks.length - 1; index >= 0; index -= 1) {
      if (marks[index].alpha <= 0) marks.splice(index, 1);
    }
    window.requestAnimationFrame(paint);
  };
  paint();
}

applyStrings();
renderCommand();
prepareAnimated();
observeAnimated();
typeSubtitle();
setupCopy();
setupPlatforms();
setupLanguage();
setupInk();
