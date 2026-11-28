import { useEffect, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from  "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { FillLayerSpecification, LineLayerSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
setWorkerUrl(workerUrl);
import proj4 from "proj4";
import type { FeatureCollection, Geometry, Position } from "geojson";
import { logger } from "./utils/logger";
import { Layer } from "leaflet";

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

// 1. 変換元（平面直角座標系）の定義をproj4に登録
// 例: JGD2011 / 平面直角座標第9系 (EPSG:6677)
proj4.defs([
  ['EPSG:6675',
  '+proj=tmerc +lat_0=36 +lon_0=137.1666666666667 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'],
  ['EPSG:6677',
  '+proj=tmerc +lat_0=36 +lon_0=139.8333333333333 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs']
]);

const handleInit = async () => {
  // ファイルを新規作成（既存リセット）して出力
  await logger.createNew('[React] ログを初期化しました');
};
const handleAction = async () => {
  // 追記出力（Go の log.Println と同じ感覚）
  await logger.println('[React] ボタンクリック:', { user: 'taro', coount: 1 });
};

// extractFileNameでファイル名を取得する
function extractFileName(filePath: string): string {
  return filePath.replace(/^.*[\\/]/, "");
}

// 1. メイン画面コンポーネント
function MainScreen() {
  const [sourceText, setSourceText] = useState<string>('');
  const [resultText, setResultText] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>(null); 
  const [activeTab, setActiveTab] = useState<TabId>("building");
  const [convertedData, setConvertedData] = useState<FeatureCollection | null>(null);
  const [status, setStatus] = useState("待機中");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedEpsg, setSelectedEpsg] = useState<string>('EPSG:6675');
  const [convertedGeoJson, setConvertedGeoJson] = useState<FeatureCollection | null>(null);

  // 座標配列を再帰的に変換するヘルパー関数
  const transformCoordinates = (coords: any, sourceProj: string, targetProj: string): any => {
    // [X, Y] または [X, Y, Z] の数値配列（末端の座標点）に到達した場合
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      // 注意: 日本の測量座標系(Xが北、Yが東)とGIS(経度X、緯度Y)の軸順序に注意
      // proj4は [Easting(東方向), Northing(北方向)] の順で入力を受け取ります
      const [lon, lat] = proj4(sourceProj, targetProj, [coords[0], coords[1]]);
      return coords.length > 2 ? [lon, lat, coords[2]] : [lon, lat];
    }
    // 配列がネストしている場合（LineString, Polygon, MultiPolygonなど）は再帰処理
    return coords.map((coord: any) => transformCoordinates(coord, sourceProj, targetProj));
  };

  // GeoJSON全体のジオメトリを変換する関数
  const convertGeoJsonToLatLon = (
    geojson: FeatureCollection,
    sourceEpsg: string
  ): FeatureCollection => {
    const targetEpsg = 'EPSG:4326'; // WGS84 (緯度経度)
    const convertedFeatures = geojson.features.map((feature) => {
      if (!feature.geometry) return feature;
      const convertGeometry = (geometry: Geometry): Geometry => {
        if (geometry.type === 'GeometryCollection') {
          return {
            ...geometry,
            geometries: geometry.geometries.map(convertGeometry),
          };
        }
        return {
          ...geometry,
          coordinates: transformCoordinates(geometry.coordinates, sourceEpsg, targetEpsg),
        } as Geometry;
      };
      return {
        ...feature,
        geometry: convertGeometry(feature.geometry),
      };
    });
    return {
      ...geojson,
      features: convertedFeatures,
    };
  };

  const handleSelectMap = async () => {
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

      if (typeof selectedPath === "string") {
        setFileName(extractFileName(selectedPath));
      };

      setSelectedFileName(selectedPath);
      setStatus("ファイル読み込み中...");

      // 2. 選択されたファイルのテキストを読み込み、JSONとしてパース
      const fileContent = await readTextFile(selectedPath);
      setSourceText(fileContent);
      setResultText('');
      const geoJsonData = JSON.parse(fileContent);
      // 簡易バリデーション
      if (!geoJsonData || typeof geoJsonData !== "object" || !geoJsonData.type) {
        throw new Error("有効なGeoJSONフォーマットではありません。");
      }

      setStatus("座標を変換中...");
      const result = convertGeoJsonToLatLon(geoJsonData, selectedEpsg);
      setConvertedData(result);
      
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
          // await emit("load-map-data", geoJsonData);
          await emit("load-map-data", result);
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

  // function handleSelectAndConvert(event: MouseEvent<HTMLButtonElement, MouseEvent>): void {
  //   event.preventDefault();

  //   if (!sourceText.trim()) {
  //     setStatus("先にGeoJSONファイルを開いてください");
  //     return;
  //   }

  //   try {
  //     setStatus("座標を変換中...");
  //     const geoJsonData = JSON.parse(sourceText) as FeatureCollection;
  //     if (geoJsonData.type !== "FeatureCollection" || !Array.isArray(geoJsonData.features)) {
  //       throw new Error("有効なGeoJSON FeatureCollectionではありません。");
  //     }

  //     const result = convertGeoJsonToLatLon(geoJsonData, selectedEpsg);
  //     setConvertedData(result);
  //     setResultText(JSON.stringify(result, null, 2));
  //     setStatus("座標変換が完了しました");
  //   } catch (error) {
  //     console.error(error);
  //     setStatus(`変換エラー: ${error instanceof Error ? error.message : String(error)}`);
  //   }
  // }

  // 3. 変換後のファイルを保存する
  // const handleSaveDxf = async () => {
  //   if (!resultText) {
  //     setStatusMessage('保存する変換後データがありません。');
  //     return;
  //   }

  //   try {
  //     const savePath = await save({
  //       filters: [{ name: 'DXF Files', extensions: ['dxf'] }],
  //       defaultPath: 'transformed.dxf',
  //     });

  //     if (!savePath) return;

  //     const msg = await invoke<string>('save_dxf_text', {
  //       filePath: savePath,
  //       content: resultText,
  //     });
  //     setStatusMessage(`${msg}: ${savePath}`);

  //   } catch (error) {
  //     console.error('保存エラー:', error);
  //   }
  // };

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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <h2>3次元都市モデル制作ツール</h2>
      {/* タブバー上部エリア */}
      <div style={{ display: "flex", borderBottom: "1px solid #ccc", background: "#f5f5f5" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 16px",
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
            <button onClick={handleSelectMap} style={{ padding: '8px 16px', cursor: 'pointer' }}>
              GeoJSONファイルを開く
            </button>
            <button onClick={handleSelectMap} style={{ padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}>
              変換を実行する
            </button>
            <button onClick={handleSelectMap} style={{ padding: '8px 16px', cursor: 'pointer' }}>
              変換後のファイルを保存する
            </button>
          </div>

          {/* ステータスメッセージ */}
          {statusMessage && (
            <div style={{ marginBottom: '16px', padding: '8px', backgroundColor: '#f0f4f8', borderRadius: '4px' }}>
              {statusMessage}
            </div>
          )}

          <div style={{ fontSize: '14px' }}>
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

          <div style={{ marginBottom: '1rem' }}>
            <label>変換元の座標系: </label>
            <select value={selectedEpsg} onChange={(e) => setSelectedEpsg(e.target.value)}>
              <option value="EPSG:6675">第7系（愛知・岐阜・三重など）</option>
              <option value="EPSG:6677">第9系（東京・福島など）</option>
            </select>
          </div>

          {/* <button onClick={handleConvert} style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>
            GeoJSONファイルを地図に表示
          </button> */}

        </div>}
        {activeTab === "rooftype" && <div>ここに屋根タイプを設定する画面を表示</div>}
        {activeTab === "landuse" && <div>ここに用途地域の着色を設定する画面を表示</div>}
        {activeTab === "terrain" && <div>ここに地形モデルを作成する画面を表示</div>}
      </div>
      <div style={{ paddingLeft: '16px', fontFamily: 'monospace', fontSize: '12px' }}>
        <p>進行状況：{status}</p>
      </div>
      <div>
        <button onClick={handleInit}>ログ新規作成</button>
        <button onClick={handleAction}>ログ追記</button>
      </div>
    </div>
  );
}

// 2. 別画面（地図表示）コンポーネント
function MapScreen() {
  // ポリゴン塗りつぶしのスタイル定義
  const fillLayerStyle: FillLayerSpecification = {
    id: 'geojson-fill',
    type: 'fill',
    source: 'my-geojson',
    paint: {
      'fill-color': '#0080ff',
      'fill-opacity': 0.4,
    },
  };

  // ポリゴン境界線のスタイル定義
  const lineLayerStyle: LineLayerSpecification = {
    id: 'geojson-line',
    type: 'line',
    source: 'my-geojson',
    paint: {
      'line-color': '#0050aa',
      'line-width': 2,
    },
  };

  // 初期表示位置（名古屋周辺）
  const [viewState] = useState({
    longitude: 136.900,
    latitude: 35.185,
    zoom: 14,
  });
  const [convertedData, setConvertedData] = useState<FeatureCollection | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<import("maplibre-gl").Map | null>(null);

  // GeoJSONの座標を再帰的に取り出し、表示範囲（bounds）を計算する
  const getGeoJsonBounds = (
    data: FeatureCollection,
    maplibre: typeof import("maplibre-gl")
  ) => {
    const bounds = new maplibre.LngLatBounds();
    const visit = (value: unknown) => {
      if (!Array.isArray(value)) return;
      if (
        value.length >= 2 &&
        typeof value[0] === "number" &&
        typeof value[1] === "number"
      ) {
        bounds.extend([value[0], value[1]]);
        return;
      }
      value.forEach(visit);
    };
    data.features.forEach((feature) => {
      if (feature.geometry) {
        if (feature.geometry.type === "GeometryCollection") {
          feature.geometry.geometries.forEach((geometry) => {
            if ("coordinates" in geometry) visit(geometry.coordinates);
          });
        } else {
          visit(feature.geometry.coordinates);
        }
      }
    });
    return bounds;
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !mapContainerRef.current) return;

      const map = new maplibre.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {
            gsi: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "&copy; OpenStreetMap contributors",
            },
          },
          layers: [
            {
              id: "gsi-layer",
              type: "raster",
              source: "gsi",
            },
          ],
        },
        center: [viewState.longitude, viewState.latitude],
        zoom: viewState.zoom,
      });

      map.addControl(new maplibre.NavigationControl(), "top-right");
      mapInstanceRef.current = map;

      unlisten = await listen<FeatureCollection>("load-map-data", (event) => {
        setConvertedData(event.payload);
      });

      await emit("map-window-ready");
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, [viewState]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !convertedData) return;

    const updateData = async () => {
      const maplibre = await import("maplibre-gl");
      if (map.getSource("my-geojson")) {
        (map.getSource("my-geojson") as import("maplibre-gl").GeoJSONSource).setData(convertedData);
        const bounds = getGeoJsonBounds(convertedData, maplibre);
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, maxZoom: 18 });
        return;
      }

      map.addSource("my-geojson", {
        type: "geojson",
        data: convertedData,
      });
      map.addLayer(fillLayerStyle);
      map.addLayer(lineLayerStyle);
      const bounds = getGeoJsonBounds(convertedData, maplibre);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, maxZoom: 18 });
    };

    if (map.isStyleLoaded()) {
      updateData();
    } else {
      map.once("load", updateData);
    }
  }, [convertedData, fillLayerStyle, lineLayerStyle]);

  return (
    <div
      ref={mapContainerRef}
      style={{ width: "100vw", height: "100vh", margin: 0, padding: 0 }}
    />
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const isMapView = params.get("view") === "map";

  return isMapView ? <MapScreen /> : <MainScreen />;
}

export default App;
