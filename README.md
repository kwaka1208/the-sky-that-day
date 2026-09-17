# the-sky-that-day

## あの日の空 あの日、空には 何が見えていた？

生年月日・時刻・観測地点から、その瞬間の星空と観測環境を再現するWebアプリです。天体配置に加え、過去天候、衛星夜間光による光害、周辺標高による地形遮蔽を推定して表示へ反映します。

## 主な機能

- 日付（1900-01-01〜2100-12-31）と現地時刻を指定
- 都市名・地名検索、現在地取得、緯度経度の手動入力
- 地名検索または現在地取得時にIANAタイムゾーンを自動判定
- NASA/HEASARC Bright Star Catalog由来の8,132レコードを、名称付き主要恒星59星との重複を除いて同梱
- 1.0〜6.5等級の表示上限を0.5刻みで選択
- 恒星のJ2000座標にIAU 1976歳差補正を適用
- 太陽、月、水星〜土星と9星座を全天星図に表示
- 薄明、月明かり、過去の雲量・湿度・降水、光害による肉眼限界を反映
- Copernicus DEM GLO-90から方位別の地平線を生成し、地形に隠れる天体を除外
- 星空部分のフルスクリーン表示
- 日付を観測地点の「今日」に設定するボタン
- モバイルでGPSと端末コンパスに追従し、端末を向けた方向の天体を表示
- 星座線、天体名、太陽・月・惑星、天候、光害、地形の個別表示切り替え
- ドラッグによる方角変更、ホイール／ボタンによる拡大縮小
- 各環境データの取得状態、出典、解像度、年代外フォールバックを表示
- 1サービスの失敗で星図全体を停止しない部分障害対応
- PC・モバイル対応

## セットアップ

Node.js 22以降を推奨します。依存関係の再現にはlockfileを使う`npm ci`を推奨します。

```bash
npm ci
npm run dev
```

表示されたローカルURLをブラウザで開いてください。現在地、端末方位、フルスクリーンは、対応ブラウザの`localhost`またはHTTPS環境で利用できます。地名検索、タイムゾーン判定、環境データ、Webフォントの取得にはインターネット接続が必要です。

## コマンド

```bash
npm run dev         # 開発サーバー
npm run typecheck   # TypeScript型チェック
npm run build       # 型チェックと本番ビルド
npm run preview     # ビルド結果のプレビュー
npm run data:stars  # NASA/HEASARCから恒星データを再生成
```

`npm run data:stars`はNASA HEASARC TAP APIへの接続が必要で、`src/data/nasaBrightStars.ts`を上書きします。通常の起動、`npm run build`、GitHub Actionsではこの処理を実行せず、生成済みデータを使用します。

## GitHub Pagesへのデプロイ

公開先は次のURLです。

- `https://kwaka1208.github.io/the-sky-that-day/`

初回のみ、GitHubリポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定してください。その後は`main`ブランチへのpushで`.github/workflows/deploy-pages.yml`が`npm ci`と`npm run build`を実行し、`dist`をデプロイします。GitHubの **Actions → Deploy to GitHub Pages → Run workflow** から手動実行することもできます。

Viteの`base`は現在のリポジトリ名に合わせて`/the-sky-that-day/`です。リポジトリ名または公開先を変更する場合は、`vite.config.ts`の`base`、`index.html`のcanonical/OGP URL、本文書の公開URLを更新してください。

## 使い方の補足

### 地点とタイムゾーン

地名検索は2文字以上で実行され、最大5件を表示します。検索結果または現在地を選ぶ場合はTimeAPIでタイムゾーンを取得してから地点を確定します。緯度・経度を手動変更した場合、地点名は「カスタム地点」になりますが、タイムゾーンは自動更新されないため必要に応じて手動で変更してください。

初期値は`2000-01-01 21:00`、東京都（`Asia/Tokyo`）、最大表示等級6.5です。

### 環境条件の切り替え

天候、光害、地形のスイッチをOFFにすると、その条件を限界等級やCanvas描画から除外します。現在の実装では通信自体は停止せず、取得状態と出典は環境カードに保持されます。

### モバイルコンパス追従

方位センサーを備えたモバイル端末では、星図右上の「コンパス OFF」をタップすると、GPSの観測地点と端末の向きに合わせた透視表示へ切り替わります。フルスクリーン表示は必須ではありません。

- iOSなどではボタン操作を起点にセンサー権限を要求します。
- 権限拒否や5秒以上センサー値が届かない場合は「コンパス再試行」から再接続できます。
- 絶対方位を取得できない端末では、誤った北基準を避けるため通常の手動星図へ戻ります。
- 追従中のGPS更新は、前回試行から30秒未満、または前回採用地点から100m未満の移動を無視します。
- 地点名またはタイムゾーンを取得できない場合、そのGPS位置は採用せずエラー状態を表示します。
- 方位精度は端末、磁気センサーの校正、周囲の金属や磁気、OSの補正状態に影響されます。

## 使用技術・データ

- React 19.3 / TypeScript 7.0 / Vite 8.3
- [NASA HEASARC Bright Star Catalog](https://heasarc.gsfc.nasa.gov/W3Browse/all/bsc5p.html) — J2000位置、V等級、B−V色指数
- [Astronomy Engine](https://github.com/cosinekitty/astronomy) — 太陽系天体の位置・月相・座標変換
- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) — 過去天候の再解析値
- [NASA Black Marble / GIBS](https://www.earthdata.nasa.gov/data/projects/black-marble) — VIIRS夜間光放射輝度
- [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api) — Copernicus DEM GLO-90標高
- [OpenStreetMap Nominatim](https://nominatim.org/) — 地名検索・逆ジオコーディング
- [TimeAPI](https://timeapi.io/) — 座標からIANAタイムゾーンを取得
- Canvas 2D / Geolocation / Fullscreen / Device Orientation API

## データと精度

NASA HEASARCで公開されているBright Star Catalog 5th Edition Preliminaryのうち、3.45より暗く6.5等級以下の8,132レコードを生成元として同梱しています。実行時カタログでは、同一座標および主要恒星59星から30秒角以内のレコードを重複として除外します。恒星位置にはIAU 1976歳差モデルを適用し、太陽系天体にはAstronomy Engineの座標計算を使用します。

実際の表示上限は、ユーザーが選択した最大等級、太陽高度・月明かりによる自然限界、過去天候、光害相当値の最小値です。環境APIが利用できない場合、その要素を制約から外し、晴天・暗空とは断定しません。

### 過去天候

Open-Meteoの再解析データを1時間単位で使用します。1940年以降が対象で、未来および直近5日間は対象外です。指定UTC日時に最も近い1時間値を使用します。値は観測所、衛星、数値モデル等を統合した推定であり、指定地点での実測ではありません。空間解像度は地点・年代により約9〜25 kmです。

### 光害

NASA GIBSの`VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance`をWMSで取得します。観測地点周辺の32×32 PNGについて中央50%領域の有効グレースケール画素の中央値を取り、実装内の指数変換式で放射輝度を推定し、Bortle 1〜9相当と限界等級を概算します。対象は2012-01-19以降です。2012年以前、未来、直近2日間、または指定日の画像を取得できない場合は2016-01-01の値を代替使用し、画面上で「推定」と参照日を明示します。これは当時の街灯環境を正確に復元するものではありません。

### 地形

Open-Meteo Elevation APIのCopernicus DEM GLO-90（約90 m）を使用します。観測地点1点と、10°ごとの36方位における0.25〜50 km先の9地点、合計325地点を最大100件ずつ取得します。地球曲率と標準的な大気屈折を考慮して最大仰角を計算し、恒星、太陽、月、惑星を遮蔽判定します。HTTP 429時は再試行し、同じ地点の結果はブラウザ内メモリへキャッシュします。建物、樹木、造成前後の地形などは含みません。

入力できる日付は1900年から2100年です。夏時間開始時に存在しない現地時刻はエラーになり、夏時間終了時に同じ時刻が2回現れる場合は早い方を採用します。

## 関連ドキュメント

- [システム構成](docs/protopedia_system.md)
- [システム構成図](docs/system-architecture.svg)
- [実装仕様](docs/spec_kwaka1208.md)
- [開発ストーリー](docs/protopedia_story.md)
