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
