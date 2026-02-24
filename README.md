# 3D Tileable Noise Generator for Unreal Engine

UE向けのVolume Texture用に、タイル可能な3D雲/煙密度ノイズを生成するWebアプリ。
16bitグレースケールの2Dアトラス画像（PNG）を出力し、UEにインポートしてVolume Textureとして利用できる。

<img width="1121" height="879" alt="image" src="https://github.com/user-attachments/assets/dabee473-b80c-4190-92a3-24ff89660216" />

## Quick Start




### GitHub Pages
静的ファイルのみで構成されているため、そのままGitHub Pagesでホスト可能。

## Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Resolution (N) | 16, 32, 64, 128, 256 | 64 | ボリューム解像度（N x N x N） |
| Seed | 0 - 999999 | 42 | 乱数シード |
| Frequency | 1 - 32 | 4 | ベース周波数（整数推奨） |
| Octaves | 1 - 8 | 6 | fBmオクターブ数 |
| Lacunarity | 1.0 - 4.0 | 2.0 | 周波数倍率（2.0推奨） |
| Gain | 0.1 - 1.0 | 0.5 | 振幅減衰率 |
| Domain Warp | 0.0 - 1.0 | 0.0 | ドメインワープ強度（0=OFF） |
| Gamma | 0.1 - 5.0 | 1.0 | ガンマ補正 |
| Brightness | -0.5 - 0.5 | 0.0 | 明度オフセット |
| Contrast | 0.1 - 3.0 | 1.0 | コントラスト |
| Threshold | 0.0 - 0.9 | 0.0 | 閾値（これ以下を0にする） |

### タイル性に関する注意
- `Frequency` は整数、`Lacunarity` は 2.0 を推奨。これにより各オクターブの周期が整数になり完全なタイル性が保証される
- `Domain Warp` を使用すると、座標の歪みによりタイル性が近似になる（UIに警告表示）

## Output Formats

### 16-bit PNG Atlas
- ZスライスをN枚、2Dグリッドに配置したアトラス画像
- 16bitグレースケール（0-65535）
- `tilesX = ceil(sqrt(N))`, `tilesY = ceil(N / tilesX)`
- 余ったタイルは黒（0）で埋め

### 16-bit RAW
- N x N x N のフラットバイナリ（リトルエンディアン Uint16）
- スライス順: Z=0 から Z=N-1、各スライスはY行優先

### JSON Metadata

```json
{
  "format": "3D Noise Atlas",
  "version": "1.0",
  "volumeResolution": 64,
  "atlasWidth": 512,
  "atlasHeight": 512,
  "tilesX": 8,
  "tilesY": 8,
  "sliceCount": 64,
  "sliceOrder": "row-major, Z=0 at top-left, Z increases left-to-right then top-to-bottom",
  "bitDepth": 16,
  "colorType": "grayscale",
  "noiseParams": {
    "seed": 42,
    "frequency": 4,
    "octaves": 6,
    "lacunarity": 2.0,
    "gain": 0.5,
    "warpStrength": 0,
    "gamma": 1.0,
    "brightness": 0.0,
    "contrast": 1.0,
    "threshold": 0.0
  },
  "unrealImport": {
    "instructions": [
      "1. Import the PNG atlas into UE Content Browser",
      "2. Double-click the imported texture to open Texture Editor",
      "3. In the Details panel, find 'Volume Texture' section",
      "4. Set 'Tile Size X' = 64",
      "5. Set 'Tile Size Y' = 64",
      "6. Right-click the texture asset > Create Volume Texture",
      "7. Set compression to VectorDisplacementmap (HDR) or Grayscale for best quality",
      "8. The resulting Volume Texture will be 64x64x64"
    ]
  }
}
```

## UE Import Instructions

1. **PNGアトラスをインポート**: Content Browserにドラッグ&ドロップ
2. **テクスチャエディタを開く**: インポートしたテクスチャをダブルクリック
3. **Volume Texture設定**:
   - Details パネルで "Tile Size X" を Resolution(N) に設定
   - "Tile Size Y" も同じ値に設定
4. **Volume Texture作成**: テクスチャアセットを右クリック > "Create Volume Texture"
5. **圧縮設定**: VectorDisplacementmap (HDR) または Grayscale を推奨（品質維持のため）
6. **マテリアルで使用**: Volume Texture をマテリアルの Texture Sample 3D ノードに接続

### 注意事項
- Resolution は2の累乗（16, 32, 64, 128, 256）を使用すること
- JSONメタデータの `tilesX`, `tilesY` でアトラスの配置を確認できる
- Z=0 はアトラスの左上から開始し、右方向 → 下方向に増加

## Technical Details

### ノイズアルゴリズム
- **周期的3D Perlinノイズ**: 格子座標をモジュロ演算でラップすることで厳密な周期性を実現
- **fBm**: 各オクターブで `period = round(frequency * lacunarity^i)` を使用
- **Domain Warp**: オフセットノイズで座標を変位させ、雲状のパターンを強化

### 依存ライブラリ（CDN）
- [pako.js](https://github.com/nickel-tech/pako) v2.1.0 — zlib圧縮
- [UPNG.js](https://github.com/nickel-tech/UPNG.js) v2.1.0 — 16bit PNGエンコード

### File Structure
```
index.html          -- メインページ（UI + CSS埋め込み）
js/
  noise.js          -- 周期的3D Perlinノイズ + fBm
  generator.js      -- ボリューム生成、アトラスレイアウト、16bitエンコード
  worker.js         -- WebWorker（バックグラウンド生成）
  ui.js             -- UI制御、プレビュー、ダウンロード
run.bat             -- ローカルHTTPサーバー起動
```

### ローカル実行
```
run.bat
```
ブラウザで `http://localhost:8090/index.html` が自動で開く。
