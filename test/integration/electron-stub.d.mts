/** The shape of the notification the harness keeps, so a test can read it. */
export interface StubNotificationAction {
  type: string;
  text: string;
}

export interface StubNotificationOptions {
  title?: string;
  body?: string;
  silent?: boolean;
  actions?: StubNotificationAction[];
}

export declare class Notification {
  static isSupported(): boolean;
  constructor(options: StubNotificationOptions);
  options: StubNotificationOptions;
  actions: StubNotificationAction[];
  shown: boolean;
  on(event: string, listener: (...args: never[]) => void): this;
  show(): void;
  emit(event: string, ...args: unknown[]): void;
}

/** Every notification the app asked for, newest last. */
export declare const notifications: Notification[];

/** The files the Dock was told about, newest last. */
export declare const recentDocuments: string[];

/** The IPC handlers the app registered, so a test can call one of them. */
export declare const ipcHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>;

export interface StubMenu {
  template: unknown[];
}

/** Every menu the app built, newest last. */
export declare const builtMenus: StubMenu[];

export declare const Menu: {
  buildFromTemplate(template: unknown[]): StubMenu;
  setApplicationMenu(menu: StubMenu): void;
};

export declare const nativeImage: {
  createFromPath(filePath: string): { path: string; isEmpty(): boolean; resize(size: unknown): unknown };
};

/** Every tray the app created, newest last. */
export declare const trays: StubTray[];

export declare class Tray {
  constructor(icon: unknown);
  icon: unknown;
  menu: StubMenu | null;
  tooltip: string;
  popped: number;
  destroyed?: boolean;
  setToolTip(text: string): void;
  setContextMenu(menu: StubMenu): void;
  setImage(image: unknown): void;
  on(event: string, listener: (...args: never[]) => void): this;
  emit(event: string, ...args: unknown[]): void;
  popUpContextMenu(): void;
  destroy(): void;
}

export declare const dialog: {
  openDialogResult: { canceled: boolean; filePaths: string[] };
  showOpenDialog(options?: unknown): Promise<{ canceled: boolean; filePaths: string[] }>;
  saveDialogResult: { canceled: boolean; filePath?: string };
  showSaveDialog(options?: unknown): Promise<{ canceled: boolean; filePath?: string }>;
};
