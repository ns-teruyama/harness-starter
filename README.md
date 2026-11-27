# harness-starter

AI エージェントと一緒に、設計から先に進めるソフトウェア開発（自律実装ハーネスなど）を始めるためのテンプレートリポジトリです。
要件・設計・判断の記録（ADR）・課題・検証を Markdown で管理し、人とエージェントが同じ規則で作業できる文書の骨格と、それを検査する小さなスクリプトが入っています。

- 人は、この README から読み始めます。
- エージェントは [AGENTS.md](AGENTS.md) を読みます。

## 入っているもの

| 種類 | 内容 |
| --- | --- |
| 進め方 | 要件整理 → 機構設計 → 実装計画 → 実装の段階と、各段階を終える条件。設計全体レビューの手順と終了条件 |
| 文書の骨格 | 全体像、要件、設計、ADR、検証方針、記録（レビュー・調査の結果）の書式見本 |
| 規則 | エージェントへの指示、執筆・編集ガイドライン、開発課題の管理ルール |
| 検査 | 課題の記録と生成一覧の整合検査、Markdown の相対リンクと見出しアンカーの検証 |

台帳（要件・ADR・課題）は空の状態から始まります。
各台帳の冒頭に、書き方の見本を置いています。

## 前提

- Node.js 22.12 以降
- `npm install` は不要です（依存パッケージはありません）。

## 始め方

1. GitHub の「Use this template」でリポジトリを作るか、ファイルを複製します。
2. 次の「最初に置き換える箇所」を順に埋めます。
3. `npm run check` が通ることを確かめて、最初のコミットにします。

### 最初に置き換える箇所

- [ ] `package.json` の `name` と、この README の題名・説明。テンプレート向けの節（「入っているもの」「始め方」）は削除
- [ ] [全体像](docs/overview.md)：目的・対象と境界・主要な概念。当てはまらない節は削除
- [ ] [責務と依存方向](docs/design/architecture.md)：クリーンアーキテクチャはテンプレートの既定。採否は機構設計（R1）で見直す
- [ ] [検証方針](docs/development/verification/strategy.md)：「外部依存の扱い」の表
- [ ] [要件と受入条件](docs/requirements/catalog.md)：最初の要件
- [ ] [開発計画](docs/development/plan.md)：段階の調整（R4 以降の追加など）
- [ ] [AGENTS.md](AGENTS.md) の「このプロジェクト固有の指示」
- [ ] `LICENSE`：ライセンスの種類（既定は MIT）と著作者
- [ ] 必要なら、課題 ID の接頭辞や表示名（`scripts/issues.mjs` 冒頭の `config`）

## 文書の地図

| 知りたいこと | 入口 |
| --- | --- |
| 何を作るか、全体像 | [全体像](docs/overview.md) |
| 何を実現するか | [要件と受入条件](docs/requirements/catalog.md) |
| どのような仕組みで実現するか | [設計](docs/design/README.md) → [責務と依存方向](docs/design/architecture.md) |
| 何を合意し、なぜそう決めたか | [ADR](docs/adr/README.md) |
| 今どの段階で、次に何をするか | [開発計画](docs/development/plan.md)・[未完了の開発課題](docs/development/issues/index.md) |
| 課題（決めること・確かめること・直すこと・作る作業）をどう登録・保留・完了するか | [開発課題の管理](docs/development/issue-management.md) |
| どう確かめるか | [検証方針](docs/development/verification/strategy.md)・[検証の索引](docs/development/verification/README.md) |
| 過去のレビュー・調査の結果 | [記録](docs/development/records/README.md) |
| 文書をどう書くか | [執筆・編集ガイドライン](docs/development/documentation-guidelines.md) |

## 検査コマンド

リポジトリのルートで実行します。

| コマンド | 内容 |
| --- | --- |
| `npm run check` | 補助スクリプトの単体テスト、課題の整合検査、Markdown のリンク検証をまとめて実行します |
| `npm run issues:new -- <種類> <題名>` | 課題を新規作成します。種類と書き方は [開発課題の管理](docs/development/issue-management.md) を参照してください |
| `npm run issues:build` | 課題を編集した後に、一覧を再生成します |
| `npm run check:links -- [--exclude <パス>]` | リンク検証だけを実行します。外部 URL は確かめません |

リンク検証は、GitHub と同じ規則で見出しから ID を作るため、日本語の見出しへのアンカーも確かめられます。
Git の作業ツリーでは、Git が無視するファイルは検査しません。

## ライセンス

[MIT License](LICENSE)
