# PLAN: 3D Tileable Noise Generator for UE

## Overview
UE向けVolume Texture用に、タイル可能な3D雲/煙密度ノイズを生成するWebアプリ。
16bitグレースケールの2Dアトラス画像（PNG）を出力し、UEにインポートしてVolume Textureとして利用する。

## Architecture

### File Structure
```
3d_noise_make/
  index.html          -- メインページ（UI + CDN読み込み + CSS埋め込み）
  js/
    noise.js          -- 周期的3D Perlinノイズ + シード付きPRNG + fBm
    generator.js      -- 3Dボリューム生成、アトラスレイアウト、16bitエンコード
    worker.js         -- WebWorker（noise.js + generator.jsをimport）
    ui.js             -- DOM操作、プレビュー、ダウンロード処理
  run.bat             -- ローカルHTTPサーバー（Python, port 8090）
  README.md           -- 使い方、UEインポート手順、JSON例
  PLAN.md             -- このファイル
```

### Dependencies（CDN、ビルド不要）
| Library | Version | Purpose |
|---------|---------|---------|
| pako.js | 2.1.0 | zlib圧縮（UPNG.js依存） |
| UPNG.js | 2.1.0 | 16bit PNGエンコード |

## Module Design

### 1. noise.js — ノイズエンジン
- **mulberry32(seed)**: シード付き32bit PRNG
- **buildPermTable(seed)**: Fisher-Yatesシャッフルで512エントリの置換テーブル生成
- **pnoise3d(x, y, z, px, py, pz, perm)**: 周期的3D Perlinノイズ
  - 整数座標を `((n % p) + p) % p` でラップ → 完全なタイル性
  - 12方向グラデーション、fade `6t^5-15t^4+10t^3`、三線形補間
- **fbm3d(x, y, z, params)**: fBm（フラクタルブラウン運動）
  - 各オクターブの周期: `round(frequency * lacunarity^i)`
  - frequency=4, lacunarity=2.0 → 周期 4,8,16,32... 全て整数で完全タイル
- **domainWarp(x, y, z, strength, params)**: 座標歪み（オプション）

### 2. generator.js — ボリューム生成・アトラス構築
- **generateVolume(config, onProgress)**: N^3 のFloat32Array生成
  - 座標 [0,1) 正規化 → fbm3d → [-1,1]→[0,1] → density remap → clamp
- **applyRemap(d, config)**: threshold→contrast→brightness→gamma→clamp
- **computeAtlasLayout(N)**: tilesX=ceil(sqrt(N)), tilesY=ceil(N/tilesX)
- **volumeToAtlas16(volume, N)**: 16bitビッグエンディアン（PNG用）
- **volumeToRAW16(volume, N)**: 16bitリトルエンディアン（RAW用）
- **generateMetadata(config, layout)**: UEインポート情報付きJSON
- **verifyTileabilityBySampling(config)**: 境界面再サンプリング検証

### 3. worker.js — WebWorker
- `importScripts('noise.js', 'generator.js')`
- `generate` コマンド: ボリューム生成→検証→アトラス変換→Transferableで返却
- progressメッセージでUI更新

### 4. ui.js — UI制御
- パラメータ読み取り・バリデーション
- WebWorker生成・メッセージハンドリング
- スライスプレビュー（canvas 8bit、pixelated拡大）
- ダウンロード: UPNG.encodeLL（メインスレッド）→ Blob → download

### 5. index.html — 単一ページ
- ダークテーマ、サイドバー+メインプレビューレイアウト
- CDN: pako.js, UPNG.js
- アプリJS: noise.js, generator.js, ui.js

## Key Technical Decisions

1. **タイル手法**: 周期的Perlinノイズ（格子座標のモジュロラップ）
   - 6Dトーラス埋め込みは不採用（JS向け6Dノイズライブラリが存在しないため）
   - モジュロラップで厳密な周期性を実現

2. **16bit PNG**: UPNG.js (CDN)
   - ブラウザで16bitグレースケールPNG生成可能な唯一の実用的選択肢

3. **WebWorker**: N=256で~17Mボクセルの計算をバックグラウンド実行
   - UIフリーズ防止、Transferableで高速データ転送

4. **Resolution制約**: 2の累乗のみ（16,32,64,128,256）

## Atlas Layout Spec

```
tilesX = ceil(sqrt(N))
tilesY = ceil(N / tilesX)
atlasWidth  = tilesX * N
atlasHeight = tilesY * N

配置: Z=0 → 左上、右方向に増加、行末で折り返し
  tileCol = z % tilesX
  tileRow = floor(z / tilesX)
余りタイル = 0 (黒) 埋め
```

### N別アトラスサイズ
| N | tilesX | tilesY | Atlas Size |
|---|--------|--------|------------|
| 16 | 4 | 4 | 64 x 64 |
| 32 | 6 | 6 | 192 x 192 |
| 64 | 8 | 8 | 512 x 512 |
| 128 | 12 | 11 | 1536 x 1408 |
| 256 | 16 | 16 | 4096 x 4096 |

## Memory Budget

| N | Volume (Float32) | Atlas (16bit) | Peak |
|---|------------------|---------------|------|
| 64 | 1 MB | 0.5 MB | ~2 MB |
| 128 | 8 MB | 4 MB | ~15 MB |
| 256 | 64 MB | 32 MB | ~100 MB |

## Verification

1. **タイル性**: 3軸境界面で再サンプリング、`|noise(0) - noise(1.0)| < 1e-10`
2. **密度範囲**: 全ボクセル [0,1] にクランプ確認
3. **シード変化**: 異なるseedで異なるパターン
4. **E2E**: run.bat起動→N=64生成→PNG/JSON/RAWダウンロード

## Deployment
- **ローカル**: `run.bat` (Python HTTP server, port 8090)
- **GitHub Pages**: 静的ファイルのみ、そのままホスト可能
