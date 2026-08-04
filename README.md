# Upcoming Conferences

学会の締め切り情報（応募/抄録/原稿・開催日など）を管理する軽量な Node.js ウェブアプリケーションです。個人・研究室で使えるように設計されており、管理者・編集者の権限分離、非表示（終了）管理、操作ログ、外部連携用のデータエクスポート機能などを備えます。

この README は開発版の変更（UI・API・DB 拡張、メール通知、エクスポート機能、埋め込み/クッキー設定など）を含めた手順と仕様をまとめたものです。

## 主要機能（要点）

- 国内（domestic）／国際（international）の学会一覧表示
- 承認済みユーザによる学会の追加・編集・非表示（管理者が恒久削除可）
- アカウント申請 → 管理者承認（承認/パスワードリセット時にメール送信）
- 編集者は非表示（終了）学会の閲覧と条件付きで再表示可能（編集は管理者のみ）
- 学会はタグ（tag）で識別。タグ単位で「全レコードが非表示」の場合に通知を表示
- サーバ側で SameSite=None; Secure 指定のクロスサイト cookie を有効化可能（iframe 埋め込み対応）
- 生データ出力 API: `/api/conferences/export`（JSON/NDJSON, CORS 対応）
- Socket.io によるリアルタイム更新、SQLite3 による永続化、操作ログ（90日）

---

## 必要環境

- Node.js 18 以上
- npm
- SQLite3（ローカルで動作するので別途 DB サーバは不要）

---

## セットアップ（ローカル / 本番）

1. リポジトリを取得

```bash
git clone <repository-url>
cd upcoming-conferences
```

2. 環境設定

```
cp .env.example .env
# .env を編集して以下を設定
```

主な環境変数（.env）
- PORT=33330
- NODE_ENV=development|production
- SESSION_SECRET=（必須、本番では長いランダム文字列）
- DB_PATH=./data/conferences.db
- APP_BASE_URL=https://your.domain.example

SMTP / メール関連
- SMTP_HOST=（例：smtp.resend.com）
- SMTP_PORT=587
- SMTP_SECURE=false
- SMTP_USER=apikey
- SMTP_PASS=<RESEND_API_KEY>
- MAIL_FROM=no-reply@your.domain

クロスサイト cookie（iframe 埋め込み時）
- CROSS_SITE_COOKIES=true   # SameSite=None; Secure を付与（secure=true も有効化）
- COOKIE_PARTITIONED=true   # オプション: Partitioned 属性を Set-Cookie に付与（実験的）

備考: SMTP_* を未設定にすると開発用にメールは console.log に出力されます。

3. 依存インストール・DB 初期化

```bash
npm install
npm run init-db   # DB ファイル作成とデフォルト管理者ユーザの作成
```

4. 起動

```bash
npm start     # production 用
npm run dev   # 開発用（自動再起動）
```

管理者初期アカウント（init-db 実行後）:
- ユーザ名: root
- パスワード: toor
（本番では必ず変更してください）

---

## デプロイ時の注意点

- CROSS_SITE_COOKIES=true を使う場合、ブラウザは Secure クッキーを要求するためサーバは HTTPS（TLS）で動作している必要があります。
- リバースプロキシ（例: nginx）で TLS 終端を行う場合、Express の trust proxy を有効にしておき、X-Forwarded-Proto ヘッダが正しく渡るように設定してください。server.js は既に `app.set('trust proxy', 1)` を設定しています。

nginx の例（TLS 終端、X-Forwarded-Proto 転送）:

```
server {
  listen 443 ssl;
  server_name confs.example.com;
  ssl_certificate ...;
  ssl_certificate_key ...;

  location / {
    proxy_pass http://127.0.0.1:33330;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

systemd のユニットは README の以前の例を参照してください。

---

## データベース変更点（このブランチでの主な追加）

- conferences テーブルに以下の列を追加済み:
  - website TEXT NOT NULL DEFAULT ''
  - tag TEXT NOT NULL DEFAULT ''
- マイグレーション: 起動時に既存 DB に対して `ALTER TABLE ADD COLUMN` を実行する処理を実装済み（database.js）。

---

## API ドキュメント（主な追加・変更）

### 新規: 生データエクスポート

GET /api/conferences/export
- 説明: 他アプリケーション向けに学会データを生データで取得するためのエンドポイント。CORS を許可しているためブラウザやサーバから直接取得できます。
- クエリパラメータ:
  - type=domestic|international
  - tag=TAG  （タグで絞り込み、完全一致）
  - since=ISO8601  （updatedAt >= since でフィルタ）
  - fields=comma,separated (例: fields=id,name,website) — 返却フィールドの絞り込み
  - format=json|ndjson (ndjson は行区切りの JSON、stream 処理に便利)
  - includeHidden=1 （認証ユーザのみ有効。非表示レコードを含める）
- ヘッダ: Access-Control-Allow-Origin: * を返します。
- キャッシュ: Cache-Control: public, max-age=60

例:
- 全件 JSON: curl -s 'https://confs.example.com/api/conferences/export'
- tag と fields 指定: curl -s "'https://confs.example.com/api/conferences/export?tag=AICAS&fields=id,name,tag,website'"
- NDJSON: curl -s 'https://confs.example.com/api/conferences/export?format=ndjson'

### 既存の主な API（要約）
- GET `/api/conferences` — 公開リスト（`?type=&includeHidden=1` をサポート; includeHidden は認証ユーザのみ）
- GET `/api/conferences/:id` — 単一取得（非表示は未認証時 404）
- POST `/api/conferences` — 追加（認証）
- PUT `/api/conferences/:id` — 更新（認証）
- POST `/api/conferences/:id/hide` — 非表示（認証）
- POST `/api/conferences/:id/unhide` — 再表示（認証、終了済は管理者のみ再表示可能）
- DELETE `/api/conferences/:id` — 恒久削除（管理者のみ）

認証・権限の注意:
- 編集は管理者のみ（UI では編集ボタンを管理者に限定）
- 編集者は非表示レコード閲覧・未終了の再表示が可能
- includeHidden の読み取りは認証ユーザのみ許可

---

## メール通知（Resend の利用例）

このプロジェクトはメール送信に nodemailer を使用しており、`.env` の SMTP_* を設定すると実際の SMTP サーバ経由で送信されます。開発時は未設定のままだと console.log に出力されます。

今回の検証では無料の Resend サービス（https://resend.com）を使いました。Resend は SMTP と API の両方を提供しており、SMTP を使う場合の設定例は以下の通りです。

- SMTP_HOST=smtp.resend.com
- SMTP_PORT=587
- SMTP_SECURE=false
- SMTP_USER=apikey
- SMTP_PASS=<RESEND_API_KEY>
- MAIL_FROM=no-reply@your.domain

参考: Resend 公式ページ — https://resend.com

注意: Resend のアカウント作成後に API キー（SMTP 用パスワード）が発行されるので、それを SMTP_PASS に設定してください。SMTP_USER は `apikey`（Resend の慣例）にしてください。

---

## フロントエンドの変更点（概要）

- public/js/conferences.js
  - tag と website の表示/編集対応
  - 埋め込み（iframe）時に target=_blank が効かない場合のフォールバック（window.open / top.location）を実装
  - 表幅に応じた stacked-table レイアウト切替
  - 非表示学会を一覧表示するモーダル（管理者/編集者向け）と複製機能

- public/index.html / public/css/style.css
  - モーダル・通知バナー・レスポンシブスタイルの追加

---

## セキュリティ・運用上の留意点

- CROSS_SITE_COOKIES=true にしたら必ず TLS を有効にしてください。クロスサイトクッキーは Secure 属性が必須です。
- 埋め込み先ページ（iframe 親）がポリシーや sandbox 属性でポップアップを禁止していると新規タブを開けません。親側に postMessage ハンドラを用意する連携が最も確実です。
- 恒久削除（DELETE）は管理者のみ可能です。必要な場合は監査ログを追加してください（現状、削除時の audit ログは記録していません）。

---

## テスト

```bash
npm test
```

テストはユニット/統合の簡易セットを含みます。変更を加えたらまず `npm test` を実行してください。

---

## 変更履歴（要約）

- DB: conferences テーブルに website, tag を追加。起動時自動マイグレーション対応
- API: /api/conferences/export を追加（JSON/NDJSON, CORS, fields/since/tag 等のフィルタ）
- サーバ: クロスサイトクッキー（SameSite=None; Secure）と Partitioned 属性オプションを追加
- サービス: 管理者へアカウント申請通知メールを送る実装を追加（Resend での検証済み）
- フロント: tag 表示・非表示管理モーダル・埋め込みフォールバック・レスポンシブ改善
- 権限: 編集者/管理者の権限調整（非表示閲覧/再表示の制限、編集は管理者のみ）

---

## 追加で検討すべき改善

- エクスポート API にAPIキー認証やページング、gzip 圧縮を追加
- 恒久削除に監査ログを残す（コンプライアンス対策）
- parent postMessage を用いた iframe 連携サンプルの整備
- Resend（または別 SMTP）向け送信テンプレート強化・HTML メール対応

---

## 貢献・ライセンス

PR・ Issue は歓迎します。MIT ライセンスです。
