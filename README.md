# Upcoming Conferences

学会へのサブミッション締め切りを一覧管理する Node.js Web アプリケーションです。

- 国内会議 / 国際会議を分けて表示
- 承認済みユーザによる学会情報の追加・編集・非表示
- アカウント作成申請 → 管理者承認（メール通知）
- 操作ログを 3 か月保持し、管理者コンソールからロールバック可能
- Socket.io によるリアルタイム更新
- SQLite3 でデータ永続化
- GitHub Actions による CI / デプロイ

## 管理項目

| 項目 | 説明 |
|------|------|
| 学会名 | 会議の名称 |
| 申し込み期限 | 参加・投稿申し込み締切 |
| 抄録提出期限 | アブストラクト締切 |
| 原稿提出期限 | 最終原稿締切 |
| 学会開始日 / 終了日 | 会期 |
| 場所 | 開催地 |
| 区分 | `domestic`（国内） / `international`（国際） |

## 必要環境

- Node.js 18 以上
- npm

## セットアップ

```bash
git clone <repository-url>
cd upcoming-conferences
cp .env.example .env   # 必要に応じて編集
npm install
npm run init-db        # DB 作成 + デフォルト管理者
npm start              # http://localhost:3000
```

開発時（ファイル変更で再起動）:

```bash
npm run dev
```

### デフォルト管理者

| 項目 | 値 |
|------|-----|
| ユーザ名 | `root` |
| パスワード | `toor` |

**本番では必ずパスワードを変更してください。**

### 環境変数

`.env.example` を参照。主な項目:

- `PORT` — 待受ポート（既定 3000）
- `SESSION_SECRET` — セッション署名鍵
- `SMTP_*` / `MAIL_FROM` — 承認通知メール用 SMTP（未設定時はコンソール出力）
- `APP_BASE_URL` — メール内リンクのベース URL

## 利用の流れ

1. **一般閲覧** — トップページで国内・国際の締め切り一覧を閲覧（認証不要）
2. **アカウント申請** — `/register.html` でメール・氏名・所属・ユーザ名・パスワードを申請
3. **管理者承認** — `root` でログイン → 管理コンソールで承認（メール通知）/ 拒否（非表示・メールなし）
4. **学会編集** — 承認ユーザが追加・編集・非表示。変更は Socket.io で他クライアントへ即時反映
5. **ロールバック** — 管理コンソールの操作ログから 3 か月以内の変更を復元

## API 概要

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/auth/register` | アカウント申請 |
| POST | `/api/auth/login` | ログイン |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | 現在のユーザ |
| GET | `/api/conferences` | 学会一覧（`?type=&includeHidden=`） |
| POST | `/api/conferences` | 追加（要ログイン） |
| PUT | `/api/conferences/:id` | 更新（要ログイン） |
| POST | `/api/conferences/:id/hide` | 非表示 |
| POST | `/api/conferences/:id/unhide` | 再表示 |
| GET | `/api/admin/applications` | 申請一覧（要管理者） |
| POST | `/api/admin/applications/:id/approve` | 承認＋メール |
| POST | `/api/admin/applications/:id/reject` | 拒否（非表示・メールなし） |
| POST | `/api/admin/applications/:id/visibility` | 拒否申請の表示切替 |
| GET | `/api/admin/logs` | 操作ログ |
| POST | `/api/admin/logs/:id/rollback` | ロールバック |

Socket イベント: `conferences:update`（一覧のリアルタイム配信）

## GitHub Actions

- **CI** (`.github/workflows/ci.yml`) — `npm ci` → `npm test` → 構文チェック
- **Deploy** (`.github/workflows/deploy.yml`) — 成果物を artifact 化。以下の Secrets がある場合に SSH デプロイ:
  - `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`
  - 任意: `DEPLOY_PORT`

リモートでは `npm ci` → `npm run init-db` の後、`systemd` ユニット `upcoming-conferences` または `pm2` で再起動を試みます。

### systemd ユニット例

```ini
[Unit]
Description=Upcoming Conferences
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/upcoming-conferences
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## ディレクトリ構成

```
├── .github/workflows/   # CI / Deploy
├── public/              # 静的フロントエンド
├── src/
│   ├── db/              # SQLite スキーマ・初期化
│   ├── middleware/      # 認証・セッション
│   ├── routes/          # REST API
│   ├── services/        # ビジネスロジック
│   ├── server.js
│   └── socket.js
├── test/
├── data/                # SQLite ファイル（gitignore）
└── package.json
```

## ライセンス

MIT
