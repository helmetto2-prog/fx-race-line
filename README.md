# FXレース LINE配信ボット

8通貨ペア（ドル円・ユーロ円・ポンド円・豪ドル円・NZドル円・スイスフラン円・ユーロドル・ポンドドル）の
24時間変化率を毎朝6時（JST）に自動取得し、着順・前日比較・戦績データをLINEに配信します。

- 為替データ: [frankfurter.app](https://www.frankfurter.app/)（ECB参照レート・APIキー不要・無料）
- 実行環境: GitHub Actions（無料枠内・cronで毎朝自動実行）
- 配信: LINE Messaging API（ブロードキャスト送信・無料プランは月200通まで無料。毎朝1通なら余裕）
- 戦績データ: `data/history.json` に自動蓄積（Actionsが自動コミット）

以下の手順は、GitHubアカウント・LINEアカウントへのログインが必要なため、
ご自身の環境で行ってください（第三者が代行できない部分です）。

## 1. GitHubにリポジトリを作る

1. https://github.com/new でリポジトリを新規作成（例: `fx-race-line`、Public/Privateどちらでも可）
2. 「READMEなどは追加しない」状態で作成（空のリポジトリ）
3. お手元のターミナルで、このフォルダに移動して以下を実行:

```bash
git init
git add .
git commit -m "init: fx race line bot"
git branch -M main
git remote add origin https://github.com/【あなたのユーザー名】/fx-race-line.git
git push -u origin main
```

これで `https://github.com/【あなたのユーザー名】/fx-race-line` がリポジトリのアドレスになります。

## 2. LINE公式アカウント（Messaging API）を作る

1. https://developers.line.biz/console/ にログイン（お持ちのLINEアカウントでOK）
2. 新規プロバイダー作成 → 「Messaging API」チャネルを作成
3. チャネル基本設定の下部にある「チャネルアクセストークン（長期）」を発行してコピー
4. 「Messaging API設定」タブでQRコードを表示し、ご自身のLINEでそのアカウントを友だち追加
   （ブロードキャスト配信は「友だち追加した人」に届く仕組みのため、これが必須です）

## 3. GitHubにトークンを登録する

1. GitHubのリポジトリ → Settings → Secrets and variables → Actions
2. 「New repository secret」で以下を登録
   - Name: `LINE_CHANNEL_ACCESS_TOKEN`
   - Value: 手順2でコピーしたトークン

トークンはコード上には一切書き込まれず、GitHub Secretsの中だけで安全に扱われます。

## 4. 動作確認

1. GitHubリポジトリの「Actions」タブ → 「FX Race Daily」→「Run workflow」で手動実行
2. 数十秒後、友だち追加したLINE公式アカウントにメッセージが届けば成功
3. 以降は毎朝6時（JST）に自動実行されます

## ファイル構成

```
fx-race-line/
├── send.js                      # 為替取得→戦績更新→LINE配信のメイン処理
├── package.json
├── data/history.json            # 日々の結果が自動蓄積される
└── .github/workflows/daily-race.yml   # 毎朝6時に自動実行するActions設定
```

## 注意事項

- frankfurter.appはECBの参照レート（平日更新）のため、実際のFX取引レートとは若干のズレがあります。
  参考指標としてご利用ください。
- LINE無料プランは月200通まで。毎朝1通の配信であれば月30通程度で収まります。
- チャネルアクセストークンは他人に見せたり、コードに直接書いたりしないでください。
