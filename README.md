# GTFS 乗り換え案内

OuDiaSecondで作成したダイヤをGTFS形式に変換し、Web上で乗換案内を提供するシステムです。

## ダイヤデータの同梱（データ保持）

ダイヤデータはアプリ本体に同梱されています。アップロード不要で、サーバーレス環境でもデータが消えません。

- 元データ: `data/2025natsusakishima.oud2`（OuDiaSecond形式）
- 同梱データ: `data/embedded-gtfs.json`（ビルドに含まれるGTFSデータセット）

### ダイヤを更新する手順

1. OuDiaSecondで `.oud2` ファイルを編集し、`data/` に上書き保存
2. 変換スクリプトを実行して同梱データを再生成

   ```bash
   # デフォルト（「2025基本列車」「2025新ダイヤ構想」を変換、後者をアクティブに）
   npm run convert:gtfs

   # ダイヤ一覧を確認
   npm run convert:gtfs -- --list

   # 変換するダイヤとアクティブダイヤを指定
   npm run convert:gtfs -- --dia "夏本番ダイヤ,2025新ダイヤ構想" --active "夏本番ダイヤ"

   # 回送列車も含める場合
   npm run convert:gtfs -- --include-kaisou
   ```

3. 変更をコミットしてデプロイ

駅名のひらがな読み（検索用）は `scripts/convert-oud2.mjs` 内の `STATION_READINGS` で定義しています。
駅を追加・改名した場合はここも更新してください。

### 徒歩・バスデータの更新

徒歩区間とバス時刻表も同梱データです。元のExcelを編集して再生成します。

```bash
# 徒歩区間リスト: data/徒歩リスト.xlsx → data/embedded-walk.json
npm run convert:walk

# バス行路表: data/2024natsusakishima_staff_*.xlsx → data/embedded-bus.json
npm run convert:bus
# 出入/回送/送り込みも含める場合
npm run convert:bus -- --include-deadhead
```

- 徒歩は座標方式を廃止し、徒歩リストの区間のみで考慮（WalkID先頭 Y=連続徒歩可 / W=単独のみ）
- バス停名は「(バス)〇〇」で徒歩リストと一致させます。表記揺れは `scripts/convert-bus.mjs` の `ALIAS` で吸収（駅を追加・改名した場合は確認）
- 検索は鉄道＋バス＋徒歩のマルチモーダル。バス停も発着地として検索できます

### データの保存先

| データ | 保存先 |
|---|---|
| 同梱ダイヤ | アプリにバンドル（常に利用可能） |
| 管理画面からのGTFSアップロード | `data/runtime/gtfs-datasets.json`（書き込み可能な環境のみ） |
| 車両・遅延・運行状況・運用表示設定 | `data/runtime/shared-data.json`（書き込み可能な環境のみ） |

Vercelなどのサーバーレス環境ではファイル書き込みができないため、アップロードや運行情報は
インスタンスの再起動で消えます（同梱ダイヤは常に残ります）。恒久的に保持したい変更は
`.oud2` を編集して同梱データを再生成してください。

## 管理者ログイン

セッションはHMAC署名付きステートレストークンのため、サーバーレス環境でもログインが維持されます。
認証情報は環境変数で設定します（Vercelの場合は Project Settings → Environment Variables）:

| 環境変数 | 内容 | 未設定時 |
|---|---|---|
| `ADMIN_EMAIL` | 管理者メールアドレス | `admin@gtfs.local` |
| `ADMIN_PASSWORD` | 管理者パスワード | `admin123` |
| `ADMIN_NAME` | 表示名 | `管理者` |
| `SESSION_SECRET` | トークン署名鍵（ランダムな長い文字列を推奨） | 認証情報から自動導出 |

**本番環境では必ず `ADMIN_PASSWORD` と `SESSION_SECRET` を設定してください。**
GTFSデータや運行情報の更新APIは管理者認証必須です（参照は誰でも可能）。
