# AnimaUtil locale files

AnimaUtil scans every `.json` file in this folder when the app starts. Each valid, unique
`id` appears in `Settings > Display language` without a code change.

```json
{
  "id": "ja",
  "name": "日本語",
  "messages": {
    "설정": "設定",
    "총 {count}장": "合計 {count} 枚"
  }
}
```

- `id`: 2–3 ASCII letters with optional `-segment` suffixes, such as `ja` or `pt-BR`
- `name`: the native language name shown in the dropdown
- `messages`: Korean source text to translated text
- A partial locale is valid. Missing entries fall back to the Korean source text.
- Named placeholders such as `{count}` must be preserved in the translated value.
- Duplicate IDs, malformed JSON, and invalid message values are ignored and reported in Settings.
- A file may contain at most 4,000 messages; each source or translation may be at most 8,000 characters.

`ko.json` defines the default locale and intentionally has an empty message map. `en.json` is the
built-in English translation. Save files as UTF-8 JSON and restart AnimaUtil to rescan this folder.
