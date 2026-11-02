import { app, Menu, shell } from "electron";
import type { AppLanguage, MenuCommand } from "../utils/types";

interface MenuCopy {
  file: string;
  newChat: string;
  commandPalette: string;
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
  checkUpdates: string;
}

const COPY: Record<AppLanguage, MenuCopy> = {
  en: {
    file: "File",
    newChat: "New Chat",
    commandPalette: "Command Palette",
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
    checkUpdates: "Check for Updates…",
  },
  ru: {
    file: "Файл",
    newChat: "Новый чат",
    commandPalette: "Палитра команд",
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
    checkUpdates: "Проверить обновления…",
  },
};

export function installAppMenu(
  language: AppLanguage,
  send: (command: MenuCommand) => void,
  quickAsk: () => void,
  checkUpdates: () => void
): void {
  const copy = COPY[language] ?? COPY.en;
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: copy.file,
      submenu: [
        { label: copy.newChat, accelerator: "CmdOrCtrl+N", click: () => send("new-chat") },
        { label: copy.commandPalette, accelerator: "CmdOrCtrl+K", click: () => send("command-palette") },
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
        ...(app.isPackaged
          ? ([{ label: copy.checkUpdates, click: checkUpdates }] as Electron.MenuItemConstructorOptions[])
          : []),
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
