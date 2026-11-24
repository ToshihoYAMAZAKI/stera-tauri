import { invoke } from '@tauri-apps/api/core';

function formatArgs(args: unknown[]): string {
    return args
        .map((arg) => {
            if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
            }
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        })
        .join(' ');
    }

export const logger = {
    // Goの log.Println 相当（書き込み専用・追記・無ければ新規作成）
    println: async (...args: unknown[]): Promise<void> => {
        const message = formatArgs(args);
        await invoke('cmd_log_println', { message });
    },

    // ログファイルを新規作成（既存ログを消去して新しく書き込む）
    createNew: async (...args: unknown[]): Promise<void> => {
        const message = formatArgs(args);
        await invoke('cmd_log_create_new', { message });
    },
};