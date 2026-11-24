import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { logger } from "./utils/logger";
// import { invoke } from "@tauri-apps/api/core";

// export const logger = {
//   println: async (...args: unknown[]): Promise<void> => {
//     const message = args
//       .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
//       .join(' ');
//     await invoke('log_println', { message });
//   },

//   createNew: async (...args: unknown[]): Promise<void> => {
//     const message = args
//       .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
//       .join(' ');
//     await invoke('log_create_new', { message });
//   },
// };

// import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

// const LABEL = 'settings';

// // 作成の成否を Promise で受け取る（登録は new の直後に同期で行う）
// function waitCreated(win: WebviewWindow): Promise<void> {
//   return new Promise((resolve, reject) => {
//     void win.once('tauri://created', () => resolve());
//     void win.once<string>('tauri://error', (e) => reject(new Error(String(e.payload))));
//   });
// }

// export async function openSettings(): Promise<WebviewWindow> {
//   // 開いていれば新しく作らず、最小化を戻して前に出す
//   const existing = await WebviewWindow.getByLabel(LABEL);
//   if (existing) {
//     await existing.unminimize();
//     await existing.setFocus();
//     return existing;
//   }
//   const win = new WebviewWindow(LABEL, {
//     url: '/settings.html',
//     title: '設定',
//     width: 600,
//     height: 400,
//     resizable: false,
//     center: true,
//   });
//   await waitCreated(win);
//   return win;
// }

// document.querySelector('#open-settings')?.addEventListener('click', () => {
//   openSettings().catch((e) => console.error('サブウィンドウを開けません:', e));
// });

// タブの種類を型定義
type TabId = "building" | "rooftype" | "landuse" | "terrain";

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: "building", label: "建物モデル" },
  { id: "rooftype", label: "屋根モデル" },
  { id: "landuse", label: "用途地域" },
  { id: "terrain", label: "地形モデル" },
];

// extractFileNameでファイル名を取得する
function extractFileName(filePath: string): string {
  return filePath.replace(/^.*[\\/]/, "");
}

export function App() {
  const [sourceText, setSourceText] = useState<string>('');
  const [resultText, setResultText] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>(null); 
  const [activeTab, setActiveTab] = useState<TabId>("building")

  const handleInit = async () => {
    // ファイルを新規作成（既存リセット）して出力
    await logger.createNew('[React] ログを初期化しました');
  };

  const handleAction = async () => {
    // 追記出力（Go の log.Println と同じ感覚）
    await logger.println('[React] ボタンクリック:', { user: 'taro', coount: 1 });
  };
  
  // 変換元の始点・終点
  // const [srcStartX, setSrcStartX] = useState<string>('0');
  // const [srcStartY, setSrcStartY] = useState<string>('0');
  // const [srcEndX, setSrcEndX] = useState<string>('100');
  // const [srcEndY, setSrcEndY] = useState<string>('0');

  // 変換先の始点・終点
  // const [dstStartX, setDstStartX] = useState<string>('50');
  // const [dstStartY, setDstStartY] = useState<string>('50');
  // const [dstEndX, setDstEndX] = useState<string>('150');
  // const [dstEndY, setDstEndY] = useState<string>('150');

  // 1. GeoJSONファイルを開く
  const handleOpenJSON = async () => {
    try {
      const selectedPath = await open({
        multiple: false,
        filters: [{ name: 'GeoJSON Files', extensions: ['geojson'] }],
      });

      if (!selectedPath || typeof selectedPath !== 'string') return;

      if (typeof selectedPath === "string") {
        setFileName(extractFileName(selectedPath));
      };

      const content = await invoke<string>('read_json_text', {
        filePath: selectedPath,
      });
      setSourceText(content);
      setResultText('');
      setStatusMessage(`読み込み完了: ${selectedPath}`);

    } catch (error) {
      console.error('GeoJSON読み込みエラー:', error);
    }
  };

  // 2. 変換を実行する
  const handleTransform = async () => {
    if (!sourceText) {
      setStatusMessage('先にGeoJSONファイルを開いてください。');
      return;
    }

    // const sourceLine = {
    //   start: { x: parseFloat(srcStartX), y: parseFloat(srcStartY) },
    //   end: { x: parseFloat(srcEndX), y: parseFloat(srcEndY) },
    // };

    // const targetLine = {
    //   start: { x: parseFloat(dstStartX), y: parseFloat(dstStartY) },
    //   end: { x: parseFloat(dstEndX), y: parseFloat(dstEndY) },
    // };

    // 数値チェック
    // if (
    //   [
    //     sourceLine.start.x,
    //     sourceLine.start.y,
    //     sourceLine.end.x,
    //     sourceLine.end.y,
    //     targetLine.start.x,
    //     targetLine.start.y,
    //     targetLine.end.x,
    //     targetLine.end.y,
    //   ].some(isNaN)
    // ) {
    //   setStatusMessage('座標には有効な数値を入力してください。');
    //   return;
    // }

    try {
      const transformed = await invoke<string>('transform_dxf_text', {
        dxfContent: sourceText,
        // sourceLine,
        // targetLine,
      });
      setResultText(transformed);
      setStatusMessage('変換が完了しました。');
    } catch (error) {
      console.error('バックエンド処理エラー:', error);
    }
  };

  // 3. 変換後のファイルを保存する
  const handleSaveDxf = async () => {
    if (!resultText) {
      setStatusMessage('保存する変換後データがありません。');
      return;
    }

    try {
      const savePath = await save({
        filters: [{ name: 'DXF Files', extensions: ['dxf'] }],
        defaultPath: 'transformed.dxf',
      });

      if (!savePath) return;

      const msg = await invoke<string>('save_dxf_text', {
        filePath: savePath,
        content: resultText,
      });
      setStatusMessage(`${msg}: ${savePath}`);

    } catch (error) {
      console.error('保存エラー:', error);
    }
  };

// 共通の読み取り専用ボックスのスタイル
  // const viewerStyle: React.CSSProperties = {
  //   width: '100%',
  //   height: '40vh',
  //   border: '1px solid #ccc',
  //   borderRadius: '4px',
  //   padding: '10px',
  //   overflow: 'auto',
  //   whiteSpace: 'pre-wrap',
  //   fontFamily: 'monospace',
  //   fontSize: '12px',
  //   wordBreak: 'break-all',
  //   backgroundColor: '#f9f9f9',
  //   boxSizing: 'border-box',
  // };

  // const inputStyle: React.CSSProperties = {
  //   width: '80px',
  //   marginLeft: '4px',
  //   marginRight: '12px',
  // };

  return (
    <div style={{ display: "fles", flexDirection: "column", height: "100vh" }}>
      <h2>3次元都市モデル制作ツール</h2>
      {/* タブバー上部エリア */}
      <div style={{ display: "flex", borderBottom: "1px solid #ccc", background: "#f5f5f5" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px, 16px",
              border: "none",
              background: activeTab === tab.id ? "#fff" : "transparent",
              borderBottom: activeTab === tab.id ? "2px solid #007acc" : "none",
              fontWeight: activeTab === tab.id ? "bold" : "normal",
              cursor: "pointer",
            }}
            >
              {tab.label}
            </button>
        ))}
      </div>
      
      {/* コンテンツ表示エリア */}
      <div style={{ flex: 1, padding: "16px", overflow: "auto" }}>
        {activeTab === "building" &&
        <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto' }}>
          
          {/* 上部操作ボタン */}
          <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button onClick={handleOpenJSON} style={{ padding: '8px 16px', cursor: 'pointer' }}>
              GeoJSONファイルを開く
            </button>
            <button onClick={handleTransform} style={{ padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}>
              変換を実行する
            </button>
            <button onClick={handleSaveDxf} style={{ padding: '8px 16px', cursor: 'pointer' }}>
              変換後のファイルを保存する
            </button>
          </div>

          {/* ステータスメッセージ */}
          {statusMessage && (
            <div style={{ marginBottom: '16px', padding: '8px', backgroundColor: '#f0f4f8', borderRadius: '4px' }}>
              {statusMessage}
            </div>
          )}

          <div>
            <p> 開いているファイル： {fileName ?? "未選択"}</p>
          </div>

          {/* 座標入力エリア */}
          {/* <div style={{ display: 'flex', gap: '24px', marginBottom: '20px', flexWrap: 'wrap' }}> */}
            {/* 変換元の座標 */}
            {/* <fieldset style={{ padding: '12px', borderRadius: '6px', border: '1px solid #ccc' }}>
              <legend style={{ fontWeight: 'bold' }}>変換元の基準線</legend>
              <div style={{ marginBottom: '8px' }}>
                <label>始点 X: </label>
                <input type="number" value={srcStartX} onChange={(e) => setSrcStartX(e.target.value)} style={{ width: '80px', marginRight: '12px' }} />
                <label>始点 Y: </label>
                <input type="number" value={srcStartY} onChange={(e) => setSrcStartY(e.target.value)} style={{ width: '80px' }} />
              </div>
              <div>
                <label>終点 X: </label>
                <input type="number" value={srcEndX} onChange={(e) => setSrcEndX(e.target.value)} style={{ width: '80px', marginRight: '12px' }} />
                <label>終点 Y: </label>
                <input type="number" value={srcEndY} onChange={(e) => setSrcEndY(e.target.value)} style={{ width: '80px' }} />
              </div>
            </fieldset> */}

            {/* 変換先の座標 */}
            {/* <fieldset style={{ padding: '12px', borderRadius: '6px', border: '1px solid #ccc' }}>
              <legend style={{ fontWeight: 'bold' }}>変換先の基準線</legend>
              <div style={{ marginBottom: '8px' }}>
                <label>始点 X: </label>
                <input type="number" value={dstStartX} onChange={(e) => setDstStartX(e.target.value)} style={{ width: '80px', marginRight: '12px' }} />
                <label>始点 Y: </label>
                <input type="number" value={dstStartY} onChange={(e) => setDstStartY(e.target.value)} style={{ width: '80px' }} />
              </div>
              <div>
                <label>終点 X: </label>
                <input type="number" value={dstEndX} onChange={(e) => setDstEndX(e.target.value)} style={{ width: '80px', marginRight: '12px' }} />
                <label>終点 Y: </label>
                <input type="number" value={dstEndY} onChange={(e) => setDstEndY(e.target.value)} style={{ width: '80px' }} />
              </div>
            </fieldset> */}
          {/* </div> */}

          {/* GeoJSONファイル表示エリア（2列） */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px' }}>
                読み込んだGeoJSONファイル
              </label>
              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                rows={20}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
                placeholder="「GeoJSONファイルを開く」を押すと内容が表示されます"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px' }}>
                変換後のファイル
              </label>
              <textarea
                value={resultText}
                onChange={(e) => setResultText(e.target.value)}
                rows={20}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
                placeholder="「変換を実行する」を押すと変換結果が表示されます"
              />
            </div>
          </div>
        </div>}
        {activeTab === "rooftype" && <div>ここに屋根タイプを設定する画面を表示</div>}
        {activeTab === "landuse" && <div>ここに用途地域の着色を設定する画面を表示</div>}
        {activeTab === "terrain" && <div>ここに地形モデルを作成する画面を表示</div>}
      </div>

      <div>
        <button onClick={handleInit}>ログ新規作成</button>
        <button onClick={handleAction}>ログ追記</button>
      </div>
      
    </div>
    
  );
}

export default App;
