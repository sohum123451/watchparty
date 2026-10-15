// Minimal Chrome Manifest V3 types for TypeScript compiler
declare namespace chrome {
  namespace runtime {
    const id: string;
    function getURL(path: string): string;
    function sendMessage(message: any, responseCallback?: (response: any) => void): Promise<any>;
    function connect(connectInfo?: { name?: string }): Port;

    const onMessage: {
      addListener(callback: (message: any, sender: MessageSender, sendResponse: (response?: any) => void) => boolean | void): void;
      removeListener(callback: (...args: any[]) => void): void;
    };

    const onConnect: {
      addListener(callback: (port: Port) => void): void;
    };

    interface MessageSender {
      tab?: tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
    }

    interface Port {
      name: string;
      disconnect(): void;
      postMessage(message: any): void;
      onDisconnect: {
        addListener(callback: (port: Port) => void): void;
      };
      onMessage: {
        addListener(callback: (message: any, port: Port) => void): void;
      };
      sender?: MessageSender;
    }
  }

  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }

    const local: StorageArea;
    const session: StorageArea;
    const sync: StorageArea;

    const onChanged: {
      addListener(callback: (changes: Record<string, { oldValue?: any; newValue?: any }>, areaName: string) => void): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      index: number;
      windowId: number;
      highlighted: boolean;
      active: boolean;
      pinned: boolean;
      url?: string;
      title?: string;
      favIconUrl?: string;
      status?: string;
      incognito: boolean;
      width?: number;
      height?: number;
      sessionId?: string;
    }

    function query(queryInfo: { active?: boolean; currentWindow?: boolean; url?: string | string[] }): Promise<Tab[]>;
    function sendMessage(tabId: number, message: any): Promise<any>;
    function get(tabId: number): Promise<Tab>;
  }

  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string | [number, number, number, number]; tabId?: number }): Promise<void>;
    function setTitle(details: { title: string; tabId?: number }): Promise<void>;
    function setIcon(details: { path?: string | Record<string, string>; tabId?: number }): Promise<void>;
    const onClicked: {
      addListener(callback: (tab: tabs.Tab) => void): void;
    };
  }

  namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
      periodInMinutes?: number;
    }

    function create(name: string, alarmInfo: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): Promise<void>;
    function clear(name: string): Promise<boolean>;
    const onAlarm: {
      addListener(callback: (alarm: Alarm) => void): void;
    };
  }
}
