# Flow Batch Generator

Chrome MV3 extension for running dependency-aware image prompt batches in Google Flow.

## V1.0.4 UI

The extension uses Chrome Side Panel rather than an action popup. This is intentional: the side panel is persistent while a native file picker is open, so importing `prompts_batch.md` is reliable on Linux/Ubuntu and other platforms where extension popups can be destroyed when they lose focus.

## Install

1. Unzip the packaged extension.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the unzipped directory.
5. Open exactly one Google Flow project tab at `https://flow.google.com/...`.
6. Click the extension toolbar icon. The Flow Batch Generator side panel opens.
7. Choose or drag `prompts_batch.md` into the import area.
8. Confirm `42 prompts · 14 scenes`, `READY`, and `Flow connected`, then press **Start**.

## Import diagnostics

The panel always displays one of these states near the file picker:
- `Reading <filename>…`
- `Imported <filename>: 42 prompts.`
- `Import failed.` followed by an actionable error.

The file input is reset after every attempt, so selecting the same `.md` again still triggers a new import.

## Development

- `npm test` — unit/integration tests
- `npm run build` — copies extension source into `dist/`
- `npm run check` — tests + build
