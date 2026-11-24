import { getCurrentWindow } from '@tauri-apps/api/window';

const win = getCurrentWindow();
console.log(`label: ${win.label}`); // "settings"

// ボタンか Esc キーで閉じる（core:window:allow-close が必要）
document.querySelector('#close')?.addEventListener('click', () => void win.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void win.close();
});