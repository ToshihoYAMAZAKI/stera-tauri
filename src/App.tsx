import { useEffect, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import L from "leaflet";
import { logger } from "./utils/logger";

// Viteビルド時のLeafletピン画像リンク切れ対策
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})

// サンプル地図のデータ（GeoJSON形式：名古屋城周辺のピンとエリア）
const SAMPLE_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {name: "名古屋城"},
      geometry: {
        type: "Point",
        coordinates: [136.8997, 35.1856],
      },
    },
    {
      type: "Feature",
      properties: { name: "名城公園エリア" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [136.398, 35.188],
            [136.903, 35.188],
            [136.903, 35.192],
            [136.898, 35.192],
            [136.898, 35.188],
          ],
        ],
      },
    },
  ],
};

// 1. メイン画面コンポーネント
function MainScreen() {
  const [status, setStatus] = useState("待機中");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const handleSelectAndOpenMap = async () => {
    try {
      // 1. ファイル選択ダイアログを開く
      const selectedPath = await open({
        multiple: false,
        title: "GeoJSONファイルを選択",
        filters: [
          {
            name: "GeoJSON",
            extensions: ["geojson", "json"],
          },
        ],
      });

      // キャンセルされた場合は何もしない
      if (!selectedPath) {
        setStatus("ファイル選択がキャンセルされました");
        return;
      }

      setSelectedFileName(selectedPath);
      setStatus("ファイル読み込み中...");

      // 2. 選択されたファイルのテキストを読み込み、JSONとしてパース
      const fileContent = await readTextFile(selectedPath);
      const geoJsonData = JSON.parse(fileContent);

      // 簡易バリデーション
      if (!geoJsonData || typeof geoJsonData !== "object" || !geoJsonData.type) {
        throw new Error("有効なGeoJSONフォーマットではありません。");
      }

      // 3. すでに地図ウィンドウが開いていれば一旦閉じる
      const existingWin = await WebviewWindow.getByLabel("map-window");
      if (existingWin) {
        await existingWin.close();
      }

      setStatus("別画面を開いています...");

      // 4. 新しいウィンドウを作成
      const webview = new WebviewWindow("map-window", {
        url: "/?view=map",
        title: `地図ビューア - ${selectedPath.split(/[\\/]/).pop()}`,
        width: 900,
        height: 700,
      });

      webview.once("tauri://created", async () => {
        // 別画面側のマウント完了通知を待ってからデータを送信
        const unlisten = await listen("map-window-ready", async () => {
          await emit("load-map-data", geoJsonData);
          setStatus("別画面に地図データを表示しました");
          unlisten();
        });
      });

      webview.once("tauri://error", (e) => {
        console.error("ウインドウ作成エラー:", e);
        setStatus("別画面の作成に失敗しました");
      });
    } catch (error) {
      console.error(error);
      setStatus(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>GeoJSON 地図ビューア</h1>
      <p>PC内のGeoJSONファイルを選択して、別ウインドウの地図に表示します。</p>

      <button
        onClick={handleSelectAndOpenMap}
        style={{
          padding: "12px, 24px",
          fontSize: "16px",
          cursor: "pointer",
          backgroundColor: "#0066cc",
          color: "white",
          border: "none",
          borderRadius: "6px",
          fontWeight: "bold",
        }}
      >
        GeoJSONファイルを選択して開く
      </button>
      
      <div style={{ marginTop: "1.5rem", padding: "1rem", backgroundColor: "#f5f5f5", borderRadius: "6px"}}>
        <p style={{ margin: "0 0 0,5rem 0" }}>
          <strong>ステータス:</strong> {status}
        </p>
        {selectedFileName && (
          <p style={{ margin: 0, fontSize: "0.9rem", color: "#555", wordBreak: "break-all" }}>
            <strong> 選択ファイル:</strong> {selectedFileName}
          </p>
        )}
      </div>
    </div>
  );
}

// 2. 別画面（地図表示）コンポーネント
function MapScreen() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Leaflet地図の初期化（初期中心座標は東京付近）
    const map = L.map(mapContainerRef.current).setView([35.6812, 139.7671], 5);
    mapInstanceRef.current = map;

    // OpenStreetMapのタイルレイヤーを追加
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    // メイン画面からの地図データ受信を待機
    const unlistenPromise = listen<GeoJSON.GeoJsonObject>(
      "load-map-data",
      (event) => {
        const geojsonData = event.payload;

        // GeoJSONレイヤーを地図に追加
        const geoJsonLayer = L.geoJSON(geojsonData, {
          onEachFeature: (feature, layer) => {
            // properties内のすべてのキーと値をHTMLテーブル形式でポップアップ表示
            if (feature.properties && Object.keys(feature.properties).length > 0) {
              const rows = Object.entries(feature.properties)
                .map(([KeyboardEvent, val]) => `<tr><th style="text-align:left;padding-right:8px;">${key}</th><td>${val}</td></tr>`)
                .join("");              
              layer.bindPopup(`<table>${rows}</table>`);
            }
          },
        }).addTo(map);

        // 読み込んだデータ全体が画面に収まるように自動ズーム
        const bounds = geoJsonLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      }
    );

    // メイン画面に「描画準備完了」を通知
    emit("map-window-ready");

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", margin: 0, padding: 0 }}>
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

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

  const params = new URLSearchParams(window.location.search);
  const isMapView = params.get("view") === "map";

  const handleInit = async () => {
    // ファイルを新規作成（既存リセット）して出力
    await logger.createNew('[React] ログを初期化しました');
  };

  const handleAction = async () => {
    // 追記出力（Go の log.Println と同じ感覚）
    await logger.println('[React] ボタンクリック:', { user: 'taro', coount: 1 });
  };
  
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

  return isMapView ? <MapScreen /> : <MainScreen />;

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
