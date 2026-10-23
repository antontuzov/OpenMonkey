import { app, Menu, shell } from "electron";
import type { AppLanguage, MenuCommand } from "../utils/types";

interface MenuCopy {
  file: string;
  newChat: string;
  searchChats: string;
  quickAsk: string;
  settings: string;
  view: string;
  toggleActivity: string;
  focusComposer: string;
  stop: string;
  cycleMood: string;
  help: string;
  repo: string;
  dataFolder: string;
}

const COPY: Record<AppLanguage, MenuCopy> = {
  en: {
    file: "File",
    newChat: "New Chat",
    searchChats: "Search Chats",
    quickAsk: "Quick Ask",
    settings: "Settings…",
    view: "View",
    toggleActivity: "Toggle Activity",
    focusComposer: "Focus Composer",
    stop: "Stop Generating",
    cycleMood: "Cycle Mood",
    help: "Help",
    repo: "OpenMonkey on GitHub",
    dataFolder: "Show Data Folder",
  },
  ru: {
    file: "Файл",
    newChat: "Новый чат",
    searchChats: "Поиск по чатам",
    quickAsk: "Быстрый вопрос",
    settings: "Настройки…",
    view: "Вид",
    toggleActivity: "Панель активности",
    focusComposer: "К полю ввода",
    stop: "Остановить ответ",
    cycleMood: "Сменить настроение",
    help: "Помощь",
    repo: "OpenMonkey на GitHub",
    dataFolder: "Показать папку данных",
  },
};

export function installAppMenu(
  language: AppLanguage,
  send: (command: MenuCommand) => void,
  quickAsk: () => void
): void {
  const copy = COPY[language] ?? COPY.en;
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: copy.file,
      submenu: [
        { label: copy.newChat, accelerator: "CmdOrCtrl+N", click: () => send("new-chat") },
        { label: copy.searchChats, accelerator: "CmdOrCtrl+K", click: () => send("search-chats") },
        { type: "separator" },
        {
          label: copy.quickAsk,
          accelerator: "Alt+Space",
          // The global shortcut already owns Option+Space; this item only displays it.
          registerAccelerator: false,
          click: quickAsk,
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: copy.view,
      submenu: [
        { label: copy.toggleActivity, accelerator: "CmdOrCtrl+\\", click: () => send("toggle-activity") },
        { label: copy.focusComposer, accelerator: "CmdOrCtrl+L", click: () => send("focus-composer") },
        { label: copy.stop, accelerator: "CmdOrCtrl+.", click: () => send("stop") },
        { type: "separator" },
        { label: copy.cycleMood, click: () => send("cycle-mood") },
        { label: copy.settings, accelerator: "CmdOrCtrl+,", click: () => send("settings") },
        ...(app.isPackaged
          ? []
          : ([
              { type: "separator" },
              { role: "reload" },
              { role: "toggleDevTools" },
            ] as Electron.MenuItemConstructorOptions[])),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      label: copy.help,
      submenu: [
        {
          label: copy.repo,
          click: () => void shell.openExternal("https://github.com/antontuzov/OpenMonkey"),
        },
        {
          label: copy.dataFolder,
          click: () => void shell.openPath(app.getPath("userData")),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
