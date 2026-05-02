# codex

このリポジトリには、1対1交換アプリ（X / Instagram連携）のMVP仕様と初期バックエンド実装サンプルを含みます。

- 仕様書: `MVP_SPEC_JA.md`
- Firestore Rules 初版: `firebase/firestore.rules`
- Cloud Functions
  - offer受諾→transaction作成: `firebase/functions/src/acceptOffer.ts`
  - offer拒否/取消: `firebase/functions/src/rejectCancelOffer.ts`
  - 発送更新/受取確認/完了処理: `firebase/functions/src/transactionLifecycle.ts`
