# Flow Batch Extension V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome Manifest V3 extension that imports the current `prompts_batch.md`, validates and executes its dependency-aware image jobs against an already-open authenticated Google Flow tab, downloads each generated image immediately, and safely resumes after interruption.

**Architecture:** Core parsing, validation, queueing, and persistence are browser-UI-independent ES modules. Google Flow integration is isolated behind a message-driven `FlowAdapter` running in a content script; the MV3 service worker owns orchestration, retry/resume, tab discovery, IndexedDB cache, and downloads. Rollup bundles the ES-module source into Chrome-compatible background/content/popup bundles, and Vitest exercises deterministic core logic plus mocked browser/DOM boundaries.

**Tech Stack:** JavaScript (ES2022), Chrome Extension Manifest V3, Rollup, Vitest, jsdom, IndexedDB, `chrome.storage.local`, `chrome.downloads`, `chrome.tabs`, `MutationObserver`.

**Spec:** `docs/superpowers/specs/2026-09-22-flow-batch-extension-design.md`

## Global Constraints

- V1 supports only the existing `prompts_batch.md` structure.
- Exactly one image is generated per prompt.
- Execution is strictly sequential; no parallel generation.
- The extension controls an already-open, authenticated Google Flow tab.
- No backend, API key, private Google Flow API, cookie export, or quota bypass.
- Each job gets at most 2 automatic retries; exhaustion pauses the entire batch.
- A failed dependency is never skipped.
- Every successful result is downloaded immediately under `Downloads/FlowBatch/<batch-name>/`.
- Generated blobs are cached only while the batch is active and are deleted on `COMPLETED` or `STOPPED`.
- Batch state is persisted after every meaningful transition because MV3 service workers may suspend.
- On uncertain restart during `GENERATING`/`WAITING_RESULT`, regenerate that single job unless success can be proven unambiguously.
- Host permissions start narrowly at `https://flow.google/*`; expand only if the actual Flow production origin requires it.

## Review Focus

1. **Markdown with CRLF, extra blank lines, or Unicode punctuation** — parser should still detect all jobs without rewriting prompt text. Add parser tests in Task 2.
2. **Persisted metadata says dependency `DONE` but IndexedDB blob is missing** — resume must pause with a non-retryable dependency-cache error, not continue. Add resume test in Task 8.
3. **Flow already contains older result cards before a new generation** — result detection must compare against a pre-generation snapshot and never capture the old image. Add detector test in Task 6.
4. **Pause requested while generation is in flight** — current job may finish, but no next job may start. Add controller test in Task 7.
5. **Downloaded image MIME differs from PNG** — preserve actual encoding/extension and metadata. Add download-manager tests in Task 5.

---

## Planned File Map

```text
flow-batch-extension/
  package.json                      # dev/test/build scripts and dependencies
  rollup.config.mjs                 # three entry builds: background, content, popup
  manifest.json                     # MV3 manifest pointing at dist assets
  src/
    shared/
      constants.js                  # statuses, message names, retry/timeouts
      errors.js                     # typed extension errors
      utils.js                      # IDs, timestamps, MIME/extension helpers
    core/
      parser.js                     # Markdown -> FlowBatchJob[]
      validator.js                  # structural/dependency validation
      state-machine.js              # legal job/batch transitions
      queue.js                      # earliest runnable unfinished job
      batch-controller.js           # single-job orchestration and batch loop
    flow/
      selectors.js                  # semantic selector candidates only
      dom-resolver.js               # layered DOM resolution helpers
      result-detector.js            # snapshot + MutationObserver completion logic
      flow-adapter.js               # Flow UI operations
    storage/
      state-store.js                # chrome.storage.local wrapper
      idb-cache.js                  # result blob persistence
      download-manager.js           # chrome.downloads wrapper + extension detection
    content/
      content-script.js             # receives adapter commands in Flow tab
    background/
      service-worker.js             # tab discovery, orchestration, lifecycle/messages
    ui/
      popup.html                    # popup shell
      popup.css                     # popup styling
      popup.js                      # file import, controls, status rendering
  tests/
    fixtures/
      prompts_batch.sample.md       # exact representative 42-job sample copied for tests
    parser.test.js
    validator.test.js
    state-machine.test.js
    queue.test.js
    storage.test.js
    download-manager.test.js
    dom-resolver.test.js
    result-detector.test.js
    flow-adapter.test.js
    batch-controller.test.js
    service-worker.test.js
```

---

### Task 1: Extension scaffold, build pipeline, shared contracts

**Files:**
- Create: `package.json`
- Create: `rollup.config.mjs`
- Create: `manifest.json`
- Create: `src/shared/constants.js`
- Create: `src/shared/errors.js`
- Create: `src/shared/utils.js`
- Create: `src/ui/popup.html`
- Create: `src/ui/popup.css`
- Create: `src/ui/popup.js`
- Create: `src/content/content-script.js`
- Create: `src/background/service-worker.js`
- Test: `tests/storage.test.js` (initial utility smoke tests live here before storage implementation)

**Interfaces:**
- Produces: `JOB_STATUS`, `BATCH_STATUS`, `MSG`, `MAX_RETRIES`, `FLOW_HOST_PATTERN`, `ExtensionError`, `makeBatchId()`, `sanitizePathSegment()`, `extensionForMime()`.
- Produces build outputs: `dist/background.js`, `dist/content.js`, `dist/popup.js`, copied popup HTML/CSS, and root `manifest.json` referencing them.

- [ ] **Step 1: Create package/build configuration**

`package.json`:

```json
{
  "name": "flow-batch-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "rollup -c",
    "check": "npm run test && npm run build"
  },
  "devDependencies": {
    "@rollup/plugin-node-resolve": "^16.0.0",
    "@rollup/plugin-terser": "^0.4.4",
    "jsdom": "^26.0.0",
    "rollup": "^4.50.0",
    "rollup-plugin-copy": "^3.5.0",
    "vitest": "^3.2.0"
  }
}
```

`rollup.config.mjs` must build background as ES module, content as IIFE, and popup as ES module, while copying `src/ui/popup.html` and `src/ui/popup.css` to `dist/`.

- [ ] **Step 2: Define the MV3 manifest with least privileges**

`manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Flow Batch Generator",
  "version": "0.1.0",
  "description": "Runs dependency-aware prompt batches in Google Flow.",
  "permissions": ["storage", "downloads", "tabs"],
  "host_permissions": ["https://flow.google/*"],
  "background": {
    "service_worker": "dist/background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "dist/popup.html"
  },
  "content_scripts": [
    {
      "matches": ["https://flow.google/*"],
      "js": ["dist/content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 3: Write shared constants and typed errors**

`src/shared/constants.js`:

```js
export const JOB_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PREPARING_FLOW: 'PREPARING_FLOW',
  UPLOADING_REFERENCE: 'UPLOADING_REFERENCE',
  SETTING_PROMPT: 'SETTING_PROMPT',
  GENERATING: 'GENERATING',
  WAITING_RESULT: 'WAITING_RESULT',
  CAPTURING_RESULT: 'CAPTURING_RESULT',
  CACHING_RESULT: 'CACHING_RESULT',
  DOWNLOADING: 'DOWNLOADING',
  DONE: 'DONE',
  RETRY_WAIT: 'RETRY_WAIT',
  FAILED: 'FAILED',
  PAUSED: 'PAUSED'
});

export const BATCH_STATUS = Object.freeze({
  READY: 'READY',
  RUNNING: 'RUNNING',
  PAUSED_USER: 'PAUSED_USER',
  PAUSED_ERROR: 'PAUSED_ERROR',
  COMPLETED: 'COMPLETED',
  STOPPED: 'STOPPED'
});

export const MAX_RETRIES = 2;
export const FLOW_HOST_PATTERN = 'https://flow.google/*';

export const MSG = Object.freeze({
  FLOW_PING: 'FLOW_PING',
  FLOW_PREPARE: 'FLOW_PREPARE',
  FLOW_UPLOAD_REFERENCE: 'FLOW_UPLOAD_REFERENCE',
  FLOW_SET_PROMPT: 'FLOW_SET_PROMPT',
  FLOW_GENERATE: 'FLOW_GENERATE',
  FLOW_WAIT_RESULT: 'FLOW_WAIT_RESULT',
  FLOW_CAPTURE_RESULT: 'FLOW_CAPTURE_RESULT',
  BATCH_IMPORT: 'BATCH_IMPORT',
  BATCH_START: 'BATCH_START',
  BATCH_PAUSE: 'BATCH_PAUSE',
  BATCH_RETRY: 'BATCH_RETRY',
  BATCH_STOP: 'BATCH_STOP',
  BATCH_GET_STATE: 'BATCH_GET_STATE'
});
```

`src/shared/errors.js`:

```js
export class ExtensionError extends Error {
  constructor(code, message, { retryable = false, stage = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'ExtensionError';
    this.code = code;
    this.retryable = retryable;
    this.stage = stage;
  }
}
```

- [ ] **Step 4: Write utility tests first**

`tests/storage.test.js` begins with:

```js
import { describe, expect, it } from 'vitest';
import { extensionForMime, sanitizePathSegment } from '../src/shared/utils.js';

describe('shared utils', () => {
  it('preserves common generated-image encodings', () => {
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/webp')).toBe('webp');
  });

  it('sanitizes a Downloads path segment', () => {
    expect(sanitizePathSegment('prompts batch:01/02')).toBe('prompts_batch_01_02');
  });
});
```

- [ ] **Step 5: Run the tests and confirm failure**

Run: `npm install && npm test -- tests/storage.test.js`

Expected: FAIL because `src/shared/utils.js` does not yet export the tested functions.

- [ ] **Step 6: Implement minimal utilities**

`src/shared/utils.js`:

```js
const MIME_TO_EXT = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp']
]);

export function extensionForMime(mime) {
  return MIME_TO_EXT.get((mime || '').toLowerCase()) || 'bin';
}

export function sanitizePathSegment(value) {
  return String(value)
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '') || 'batch';
}

export function makeBatchId(sourceFilename, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const base = sourceFilename.replace(/\.[^.]+$/, '');
  return `${sanitizePathSegment(base)}-${stamp}`;
}
```

- [ ] **Step 7: Add minimal entry files and popup shell, then build**

`src/content/content-script.js` and `src/background/service-worker.js` should only register no-op listeners initially; `src/ui/popup.js` should load without throwing. Build with:

Run: `npm run build`

Expected: PASS and `dist/background.js`, `dist/content.js`, `dist/popup.js`, `dist/popup.html`, `dist/popup.css` exist.

- [ ] **Step 8: Commit scaffold**

```bash
git add package.json rollup.config.mjs manifest.json src tests/storage.test.js

git commit -m "chore: scaffold flow batch extension"
```

---

### Task 2: Markdown parser and normalized job model

**Files:**
- Create: `src/core/parser.js`
- Create: `tests/parser.test.js`
- Create: `tests/fixtures/prompts_batch.sample.md`

**Interfaces:**
- Consumes: `JOB_STATUS` from `src/shared/constants.js`.
- Produces: `parsePromptBatch(markdown: string): FlowBatchJob[]` where each job has `index`, `total`, `id`, `sceneId`, `imageId`, `referenceId`, `minWidth`, `aspectRatio`, `mainPrompt`, `styleLock`, `negativePrompt`, `finalPrompt`, `filename`, `status`, `retryCount`.

- [ ] **Step 1: Copy the representative 42-job sample into the test fixture**

Use the supplied sample verbatim so parser tests exercise the real formatting, Unicode punctuation, Vietnamese text, and all 42 headings.

- [ ] **Step 2: Write parser tests for real format and Review Focus #1**

`tests/parser.test.js`:

```js
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePromptBatch } from '../src/core/parser.js';

const fixture = fs.readFileSync(new URL('./fixtures/prompts_batch.sample.md', import.meta.url), 'utf8');

describe('parsePromptBatch', () => {
  it('parses the 42-job sample and preserves dependency metadata', () => {
    const jobs = parsePromptBatch(fixture);
    expect(jobs).toHaveLength(42);
    expect(new Set(jobs.map(j => j.sceneId)).size).toBe(14);
    expect(jobs[0]).toMatchObject({ id: 'S01_IMG01', referenceId: null, aspectRatio: '16:9' });
    expect(jobs[1]).toMatchObject({ id: 'S01_IMG02', referenceId: 'S01_IMG01', minWidth: 3072 });
    expect(jobs[2]).toMatchObject({ id: 'S01_IMG03', referenceId: 'S01_IMG02' });
  });

  it('preserves prompt wording while normalizing CRLF and blank-line structure', () => {
    const crlf = fixture.replace(/\n/g, '\r\n').replace('Văn phòng Nhật giờ nghỉ trưa;', '\r\nVăn phòng Nhật giờ nghỉ trưa;');
    const jobs = parsePromptBatch(crlf);
    expect(jobs[0].finalPrompt).toContain('Văn phòng Nhật giờ nghỉ trưa;');
    expect(jobs[0].finalPrompt).toContain('--- style lock ---');
    expect(jobs[0].finalPrompt).toContain('--- negative ---');
  });

  it('extracts actual requested widths including 3072 and 4608', () => {
    const jobs = parsePromptBatch(fixture);
    expect(jobs.some(j => j.minWidth === 3072)).toBe(true);
    expect(jobs.some(j => j.minWidth === 4608)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/parser.test.js`

Expected: FAIL because `parsePromptBatch` is missing.

- [ ] **Step 4: Implement parser with explicit regexes**

`src/core/parser.js` core:

```js
import { JOB_STATUS } from '../shared/constants.js';

const HEADER_RE = /^##\s*\[(\d+)\/(\d+)\]\s+(S\d+_IMG\d+)\s+—\s+(.+)$/m;
const REF_RE = /dùng\s+(S\d+_IMG\d+)\s+làm ảnh tham chiếu/i;
const WIDTH_RE = /tối thiểu\s+(\d+)px\s+chiều ngang/i;
const RATIO_RE = /tỷ lệ\s+([0-9]+:[0-9]+)/i;

export function parsePromptBatch(markdown) {
  const normalized = String(markdown).replace(/\r\n?/g, '\n');
  const blocks = normalized
    .split(/(?=^##\s*\[\d+\/\d+\]\s+S\d+_IMG\d+)/m)
    .filter(block => /^##\s*\[\d+\/\d+\]/m.test(block));

  return blocks.map(parseBlock);
}

function parseBlock(block) {
  const header = block.match(HEADER_RE);
  if (!header) throw new Error('Unsupported prompt block header');

  const [, indexText, totalText, id, relationText] = header;
  const [sceneId, imageId] = id.split('_');
  const referenceId = relationText.match(REF_RE)?.[1] ?? null;
  const minWidth = Number(block.match(WIDTH_RE)?.[1] ?? 0) || null;
  const aspectRatio = block.match(RATIO_RE)?.[1] ?? '';

  const contentStart = block.indexOf('\n', header.index + header[0].length) + 1;
  const body = block.slice(contentStart);
  const styleMarker = body.indexOf('--- style lock ---');
  const negativeMarker = body.indexOf('--- negative ---');
  const promptRegion = body.slice(0, styleMarker);
  const mainPrompt = promptRegion
    .split('\n')
    .filter(line => !/^\*\*(Thao tác|Yêu cầu độ phân giải):/.test(line.trim()))
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
  const styleLock = body.slice(styleMarker + '--- style lock ---'.length, negativeMarker).trim();
  const negativePrompt = body.slice(negativeMarker + '--- negative ---'.length).trim();
  const finalPrompt = `${mainPrompt}\n\n--- style lock ---\n${styleLock}\n\n--- negative ---\n${negativePrompt}`;

  return {
    index: Number(indexText), total: Number(totalText), id, sceneId, imageId,
    referenceId, minWidth, aspectRatio, mainPrompt, styleLock, negativePrompt,
    finalPrompt, filename: `${id}.png`, status: JOB_STATUS.PENDING, retryCount: 0
  };
}
```

- [ ] **Step 5: Run parser tests and correct only parser defects**

Run: `npm test -- tests/parser.test.js`

Expected: PASS.

- [ ] **Step 6: Commit parser**

```bash
git add src/core/parser.js tests/parser.test.js tests/fixtures/prompts_batch.sample.md

git commit -m "feat: parse markdown prompt batches"
```

---

### Task 3: Validator, dependency rules, queue, and state machine

**Files:**
- Create: `src/core/validator.js`
- Create: `src/core/queue.js`
- Create: `src/core/state-machine.js`
- Create: `tests/validator.test.js`
- Create: `tests/queue.test.js`
- Create: `tests/state-machine.test.js`

**Interfaces:**
- Consumes: `FlowBatchJob[]`, `JOB_STATUS`, `BATCH_STATUS`.
- Produces: `validateJobs(jobs): { errors: ValidationIssue[], warnings: ValidationIssue[] }`.
- Produces: `findNextRunnableJob(jobs, hasBlob): FlowBatchJob | null`.
- Produces: `transitionJob(job, nextStatus): FlowBatchJob` and `transitionBatch(batch, nextStatus): FlowBatch`.

- [ ] **Step 1: Write validator tests**

Cover duplicate IDs, missing reference, forward reference, cycle, missing ratio/prompt, and a valid sample chain.

```js
it('rejects a forward reference', () => {
  const jobs = [job('S01_IMG01', { referenceId: 'S01_IMG02' }), job('S01_IMG02')];
  const result = validateJobs(jobs);
  expect(result.errors.map(e => e.code)).toContain('FORWARD_REFERENCE');
});
```

- [ ] **Step 2: Run validator tests and verify failure**

Run: `npm test -- tests/validator.test.js`

Expected: FAIL because validator is missing.

- [ ] **Step 3: Implement deterministic validation and cycle detection**

Use an ID map and DFS color states (`unseen`, `visiting`, `done`). Return issues rather than throwing so popup can display all import problems at once.

- [ ] **Step 4: Write queue tests**

```js
it('blocks a dependent job until DONE and blob exist', () => {
  const jobs = [
    job('S01_IMG01', { status: 'DONE' }),
    job('S01_IMG02', { referenceId: 'S01_IMG01', status: 'PENDING' })
  ];
  expect(findNextRunnableJob(jobs, () => false)).toBeNull();
  expect(findNextRunnableJob(jobs, id => id === 'S01_IMG01')?.id).toBe('S01_IMG02');
});
```

- [ ] **Step 5: Implement queue selection**

`findNextRunnableJob` scans jobs in original `index` order, ignores `DONE`, refuses to pass a `FAILED` dependency, and returns only the earliest job whose declared dependency is both `DONE` and cached.

- [ ] **Step 6: Write state-machine tests including retry/pause semantics**

```js
it('rejects DONE -> GENERATING regression', () => {
  expect(() => transitionJob(job('S01_IMG01', { status: 'DONE' }), 'GENERATING')).toThrow();
});
```

- [ ] **Step 7: Implement explicit transition maps**

No arbitrary status mutation outside the state machine. Include batch transitions `READY -> RUNNING`, `RUNNING -> PAUSED_USER|PAUSED_ERROR|COMPLETED|STOPPED`, and retry path `FAILED -> RETRY_WAIT -> PREPARING_FLOW`.

- [ ] **Step 8: Run all Task 3 tests**

Run: `npm test -- tests/validator.test.js tests/queue.test.js tests/state-machine.test.js`

Expected: PASS.

- [ ] **Step 9: Commit core scheduling**

```bash
git add src/core/validator.js src/core/queue.js src/core/state-machine.js tests/validator.test.js tests/queue.test.js tests/state-machine.test.js

git commit -m "feat: validate and schedule dependency jobs"
```

---

### Task 4: State persistence and IndexedDB result cache

**Files:**
- Create: `src/storage/state-store.js`
- Create: `src/storage/idb-cache.js`
- Modify: `tests/storage.test.js`

**Interfaces:**
- Produces `createStateStore(chromeStorage): { loadActiveBatch, saveBatch, clearActiveBatch }`.
- Produces `createBlobCache(indexedDB): { put, get, has, deleteBatch }` using key `<batchId>:<jobId>`.

- [ ] **Step 1: Add failing storage wrapper tests with fakes**

```js
it('persists and reloads the active batch atomically', async () => {
  const store = createStateStore(fakeChromeStorage());
  await store.saveBatch({ id: 'batch-1', status: 'RUNNING', jobs: [] });
  expect((await store.loadActiveBatch()).id).toBe('batch-1');
});
```

- [ ] **Step 2: Implement `state-store.js`**

Use one storage key, `flowBatch.activeBatch`, so a batch snapshot is written as one logical object rather than many independently mutable keys.

- [ ] **Step 3: Add IndexedDB tests with a lightweight in-test fake**

Test `put -> has -> get -> deleteBatch`; blob metadata must include `mimeType`, `filename`, `createdAt`.

- [ ] **Step 4: Implement `idb-cache.js`**

Database: `flow-batch-extension`, version `1`, object store `results`, `keyPath: 'key'`, secondary index `batchId`.

Stored record:

```js
{
  key: `${batchId}:${jobId}`,
  batchId,
  jobId,
  blob,
  mimeType: blob.type || 'application/octet-stream',
  filename,
  createdAt: new Date().toISOString()
}
```

- [ ] **Step 5: Run storage tests**

Run: `npm test -- tests/storage.test.js`

Expected: PASS.

- [ ] **Step 6: Commit persistence**

```bash
git add src/storage/state-store.js src/storage/idb-cache.js tests/storage.test.js

git commit -m "feat: persist batch state and result blobs"
```

---

### Task 5: Download manager with real MIME-aware filenames

**Files:**
- Create: `src/storage/download-manager.js`
- Create: `tests/download-manager.test.js`

**Interfaces:**
- Consumes: `extensionForMime`, `sanitizePathSegment`.
- Produces: `createDownloadManager(chromeDownloads): { saveResult({ batchName, jobId, blob }): Promise<{ downloadId, filename, mimeType }> }`.

- [ ] **Step 1: Write failing tests including Review Focus #5**

```js
it('uses .webp for image/webp bytes instead of relabeling as png', async () => {
  const chromeDownloads = fakeDownloads();
  const manager = createDownloadManager(chromeDownloads, fakeObjectUrlApi());
  const blob = new Blob(['x'], { type: 'image/webp' });
  const result = await manager.saveResult({ batchName: 'batch-1', jobId: 'S01_IMG01', blob });
  expect(result.filename).toBe('FlowBatch/batch-1/S01_IMG01.webp');
});
```

Also test PNG/JPEG and object-URL revocation after `chrome.downloads.download` resolves.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/download-manager.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement download manager**

Use `URL.createObjectURL(blob)`, call `chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' })`, then revoke the object URL in `finally`.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/download-manager.test.js`

Expected: PASS.

- [ ] **Step 5: Commit downloads**

```bash
git add src/storage/download-manager.js tests/download-manager.test.js

git commit -m "feat: download generated images by mime type"
```

---

### Task 6: Flow DOM resolver, adapter, result detector, and risky capability checks

**Files:**
- Create: `src/flow/selectors.js`
- Create: `src/flow/dom-resolver.js`
- Create: `src/flow/result-detector.js`
- Create: `src/flow/flow-adapter.js`
- Create: `tests/dom-resolver.test.js`
- Create: `tests/result-detector.test.js`
- Create: `tests/flow-adapter.test.js`

**Interfaces:**
- Produces: `resolveControl(document, descriptor): Element | null`.
- Produces: `createResultDetector(document): { snapshot(), waitForNewStableResult(before, options) }`.
- Produces: `createFlowAdapter({ document, window, fetchImpl }): FlowAdapter` matching the spec interface.

- [ ] **Step 1: Define semantic selector descriptors, not one brittle CSS chain**

`src/flow/selectors.js`:

```js
export const FLOW_CONTROLS = {
  prompt: [
    { kind: 'css', value: '[role="textbox"][contenteditable="true"]' },
    { kind: 'css', value: 'textarea' }
  ],
  generate: [
    { kind: 'buttonText', value: /generate|tạo/i },
    { kind: 'ariaContains', value: /generate|tạo/i }
  ],
  upload: [
    { kind: 'css', value: 'input[type="file"]' }
  ],
  imageMode: [
    { kind: 'buttonText', value: /image|ảnh/i }
  ],
  aspect16x9: [
    { kind: 'buttonText', value: /16\s*:\s*9/ }
  ]
};
```

- [ ] **Step 2: Write DOM resolver tests**

Use jsdom to verify resolution by CSS, visible button text, and `aria-label`, including hidden/disabled elements being rejected.

- [ ] **Step 3: Implement resolver**

`resolveControl` loops candidates in priority order and returns only visible, enabled elements unless the descriptor explicitly targets `input[type=file]`.

- [ ] **Step 4: Write result-detector tests including Review Focus #3**

Construct DOM with an old result card, snapshot it, append a loading marker and then a new result image. Assert only the newly introduced asset is returned.

```js
it('never returns a pre-existing result card', async () => {
  document.body.innerHTML = '<div data-result-card><img src="old.webp"></div>';
  const detector = createResultDetector(document);
  const before = detector.snapshot();
  document.body.insertAdjacentHTML('beforeend', '<div data-result-card><img src="new.webp"></div>');
  const result = await detector.waitForNewStableResult(before, { timeoutMs: 100 });
  expect(result.src).toContain('new.webp');
});
```

- [ ] **Step 5: Implement MutationObserver-based detector**

Snapshot a set of stable asset fingerprints (prefer `src`, `currentSrc`, or a generated card identifier). Success requires a fingerprint absent from `before` and stable across two animation-frame/microtask checks. Timeout throws retryable `ExtensionError('RESULT_TIMEOUT', ...)`.

- [ ] **Step 6: Write adapter tests for prompt entry, settings, and file upload**

Prompt setting must dispatch `input` and `change` events. File upload must create a `DataTransfer`, add the `File`, assign `input.files`, dispatch `change`, and then wait for a visible attachment signal.

- [ ] **Step 7: Implement adapter operations**

Core methods:

```js
async function setPrompt(text) {
  const el = requireControl(FLOW_CONTROLS.prompt, 'PROMPT_NOT_FOUND');
  el.focus();
  if ('value' in el) el.value = text;
  else el.textContent = text;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
```

`uploadReference(file)` must fail clearly with `REFERENCE_UPLOAD_UNSUPPORTED` if `DataTransfer` assignment does not produce a non-empty `input.files` collection or Flow never confirms attachment.

- [ ] **Step 8: Implement result blob capture without private API**

Try in this order:

1. fetch the visible result image URL using the page/extension accessible `fetchImpl`;
2. if the result is a `blob:` URL, fetch it directly;
3. if fetch is blocked, throw `RESULT_BLOB_BLOCKED` so the integration test exposes the need for a visible-download fallback before shipping.

Do not add internal Google request interception.

- [ ] **Step 9: Run Flow-layer tests**

Run: `npm test -- tests/dom-resolver.test.js tests/result-detector.test.js tests/flow-adapter.test.js`

Expected: PASS.

- [ ] **Step 10: Perform manual capability probe in a real authenticated Flow tab**

Load the unpacked extension, open `https://flow.google/`, and verify with one throwaway prompt:

- content script receives `FLOW_PING`;
- prompt can be inserted;
- Image/16:9/1-output controls can be set when present;
- `DataTransfer` file assignment is accepted by the current reference uploader;
- a generated result is distinguished from old results;
- the visible asset can be fetched as a Blob.

If file assignment or blob capture fails, stop implementation and revise only the affected adapter boundary in the spec/plan before continuing. Do not silently work around with private APIs.

- [ ] **Step 11: Commit Flow integration boundary**

```bash
git add src/flow tests/dom-resolver.test.js tests/result-detector.test.js tests/flow-adapter.test.js

git commit -m "feat: automate google flow ui boundary"
```

---

### Task 7: Batch controller with retry, pause, dependency safety, and immediate persistence

**Files:**
- Create: `src/core/batch-controller.js`
- Create: `tests/batch-controller.test.js`

**Interfaces:**
- Consumes: queue, state machine, `FlowAdapter` proxy, state store, blob cache, download manager.
- Produces: `createBatchController(deps)` with `start(batch)`, `pause()`, `retryFailedJob()`, `stop()`, `resume(batch)`.

- [ ] **Step 1: Write the happy-path controller test**

Use fakes for Flow, cache, downloads, and state store. Assert sequence:

```text
prepare -> set options -> set prompt -> generate -> wait result -> capture blob -> cache -> download -> DONE -> next job
```

For a dependent second job, assert `uploadReference` receives a `File` built from the first job's cached blob.

- [ ] **Step 2: Add retry-exhaustion and manual-retry tests**

Make `waitForResult` throw a retryable error three executions total (initial + two retries). Assert job becomes `FAILED`, batch becomes `PAUSED_ERROR`, and the dependent job is never started. Then call `retryFailedJob()`, assert `retryCount` resets to `0`, that same failed job returns to a runnable state, and no completed job is regenerated.

- [ ] **Step 3: Add Review Focus #4 pause-during-generation test**

`generate()` begins; call `pause()` while `waitForResult()` is pending; resolve the current result; assert current job may finish and persist, but no next job begins and batch ends in `PAUSED_USER`.

- [ ] **Step 4: Run tests and verify failure**

Run: `npm test -- tests/batch-controller.test.js`

Expected: FAIL.

- [ ] **Step 5: Implement single-job orchestration**

Persist after every state transition:

```js
await setJobStatus(job, JOB_STATUS.PREPARING_FLOW);
await flow.ensureReady();
await flow.setImageMode();
await flow.setOutputCount(1);
await flow.setAspectRatio(job.aspectRatio);

if (job.referenceId) {
  await setJobStatus(job, JOB_STATUS.UPLOADING_REFERENCE);
  const record = await cache.get(batch.id, job.referenceId);
  if (!record) throw nonRetryableMissingDependency(job.referenceId);
  const file = new File([record.blob], record.filename, { type: record.mimeType });
  await flow.uploadReference(file);
}
```

Continue through prompt, generate, wait, capture, cache, download, and `DONE`.

- [ ] **Step 6: Implement retry wrapper**

Only errors with `error.retryable === true` consume automatic retries. Increment and persist `retryCount` before each retry. After 2 retries, mark `FAILED` and batch `PAUSED_ERROR`.

- [ ] **Step 7: Implement pause, manual retry, stop, and completion cleanup semantics**

Pause sets `pauseRequested = true`; controller checks this before starting every job and after the current job reaches a safe boundary. `retryFailedJob()` requires `PAUSED_ERROR`, resets only the failed job's `retryCount` to `0`, clears its `lastError`, moves it back through the legal retry transition, and preserves every completed job. Stop persists `STOPPED` first, then calls `cache.deleteBatch(batch.id)`; downloaded files are untouched. When the final job reaches `DONE`, persist batch `COMPLETED` first and then delete that batch's IndexedDB blobs while retaining the metadata summary.

- [ ] **Step 8: Add completion-cleanup test and run controller tests**

Assert the last successful job causes `COMPLETED` to be saved before `cache.deleteBatch(batch.id)` is invoked.

Run: `npm test -- tests/batch-controller.test.js`

Expected: PASS.

- [ ] **Step 9: Commit controller**

```bash
git add src/core/batch-controller.js tests/batch-controller.test.js

git commit -m "feat: orchestrate resilient flow batches"
```

---

### Task 8: Service worker, content-script RPC, tab discovery, and resume semantics

**Files:**
- Modify: `src/content/content-script.js`
- Modify: `src/background/service-worker.js`
- Create: `tests/service-worker.test.js`

**Interfaces:**
- Content side consumes `MSG.FLOW_*` and returns serializable results/errors.
- Background exposes popup commands `BATCH_IMPORT`, `BATCH_START`, `BATCH_PAUSE`, `BATCH_RETRY`, `BATCH_STOP`, `BATCH_GET_STATE`.
- Background discovers one eligible `https://flow.google/*` tab and rejects ambiguous multiple-tab state in V1.

- [ ] **Step 1: Write RPC serialization tests**

A content-side `ExtensionError` must return `{ ok:false, error:{ code,message,retryable,stage } }`; successful adapter calls return `{ ok:true, value }`.

- [ ] **Step 2: Implement content-script command router**

Create one `FlowAdapter` instance and route only the narrow commands needed by the controller. For captured Blob results, convert to `ArrayBuffer` plus MIME type for message transport if direct structured clone of Blob proves unreliable in the target Chrome version.

- [ ] **Step 3: Write tab-discovery tests**

Cases: zero Flow tabs -> `WAITING_FOR_FLOW`; one Flow tab -> use it; two Flow tabs -> pause/error asking user to keep one eligible Flow tab for V1.

- [ ] **Step 4: Implement service-worker Flow proxy**

`sendFlowCommand(tabId, type, payload)` wraps `chrome.tabs.sendMessage`, reconstructs `ExtensionError`, and never leaks selector logic into the background.

- [ ] **Step 5: Add resume tests including Review Focus #2**

Persist a batch where `S01_IMG01` is `DONE`, `S01_IMG02` needs it, but cache `has(batchId, 'S01_IMG01')` is false. On service-worker startup, assert batch becomes `PAUSED_ERROR` with code `MISSING_DEPENDENCY_BLOB` and no Flow command is sent.

Also test an interrupted `GENERATING` job is reset to a safe retryable state rather than marked done.

- [ ] **Step 6: Implement startup reconciliation**

On worker wake/start:

1. load active batch;
2. if `COMPLETED`/`STOPPED`, do nothing;
3. verify cached blobs for all completed jobs that are referenced by unfinished jobs;
4. map uncertain active states (`GENERATING`, `WAITING_RESULT`, `CAPTURING_RESULT`) to retry of that job;
5. locate one Flow tab;
6. continue only when tab is available and batch status authorizes running.

- [ ] **Step 7: Run service-worker tests**

Run: `npm test -- tests/service-worker.test.js`

Expected: PASS.

- [ ] **Step 8: Commit runtime messaging/resume**

```bash
git add src/content/content-script.js src/background/service-worker.js tests/service-worker.test.js

git commit -m "feat: connect flow tab and resume batches"
```

---

### Task 9: Popup import, validation, progress, controls, and logs

**Files:**
- Modify: `src/ui/popup.html`
- Modify: `src/ui/popup.css`
- Modify: `src/ui/popup.js`

**Interfaces:**
- Popup sends/receives only background `MSG.BATCH_*` messages.
- It never accesses Flow DOM, IndexedDB, or `chrome.downloads` directly.

- [ ] **Step 1: Build import-state markup**

Required controls/fields:

```html
<input id="prompt-file" type="file" accept=".md,text/markdown,text/plain">
<div id="summary"></div>
<div id="validation"></div>
<div id="flow-status"></div>
<button id="start" disabled>Start</button>
```

- [ ] **Step 2: Implement file import and background validation request**

Read file with `file.text()`, send `{ type: MSG.BATCH_IMPORT, payload: { filename: file.name, markdown } }`, and render returned `jobCount`, `sceneCount`, `errors`, `warnings`, and derived batch name.

Start remains disabled when validation errors exist or no Flow tab is connected.

- [ ] **Step 3: Build running/error states**

Show batch name, `done/total`, current job/reference/stage, retry count, recent log lines, and buttons `Pause`, `Stop`; on `PAUSED_ERROR`, replace Pause with `Retry Job`.

- [ ] **Step 4: Implement resilient popup refresh**

On every popup open and after every action, call `BATCH_GET_STATE`. Also refresh every 1 second while popup remains open; the popup is a view, not the process owner.

- [ ] **Step 5: Build and manually inspect popup**

Run: `npm run build`

Load unpacked extension and verify all states remain legible around 360px popup width without horizontal scrolling.

- [ ] **Step 6: Commit popup**

```bash
git add src/ui

git commit -m "feat: add batch control popup"
```

---

### Task 10: Full acceptance, interruption tests, cache cleanup, and release verification

**Files:**
- Modify as failures require, limited to files owning the failing behavior.
- Create: `docs/manual-test-checklist.md`

**Interfaces:**
- No new public interfaces; this task proves the spec end to end.

- [ ] **Step 1: Run complete automated suite**

Run: `npm run check`

Expected: all Vitest tests PASS and Rollup build succeeds with no unresolved imports.

- [ ] **Step 2: Create the manual checklist with exact expected outcomes**

`docs/manual-test-checklist.md` must include:

```text
[ ] Import full prompts_batch.md -> 42 jobs, 14 scenes, no validation errors
[ ] S01_IMG01 runs without reference
[ ] S01_IMG02 uploads cached S01_IMG01 result
[ ] S01_IMG03 uploads cached S01_IMG02 result
[ ] Each successful asset downloads immediately under FlowBatch/<batch-name>/
[ ] PNG/JPEG/WebP filenames match actual MIME
[ ] Close/reopen popup between jobs -> batch keeps running/state is preserved
[ ] Reload Flow tab between jobs -> controller reconnects and resumes
[ ] Restart Chrome between jobs -> controller resumes unfinished batch
[ ] Restart during generation -> only uncertain current job is regenerated
[ ] Force two automatic retries to fail -> batch pauses, downstream job never starts
[ ] Retry Job after fixing issue -> same job resumes
[ ] Pause during generation -> no next job starts after current safe boundary
[ ] Stop -> STOPPED persisted before cache deletion
[ ] Complete all jobs -> 42 downloads and IndexedDB batch blobs removed
```

- [ ] **Step 3: Run 1-scene/3-job smoke batch**

Use the first three sample blocks only. Confirm output dependency chain and download names before attempting the full 42-job batch.

- [ ] **Step 4: Run 2-scene/6-job interruption batch**

Reload Flow between jobs 3 and 4; close/reopen popup; then restart Chrome between jobs 4 and 5. Confirm state reconciliation and no repeated completed jobs.

- [ ] **Step 5: Exercise error/retry path intentionally**

Temporarily make Flow unavailable or break one selector locally, confirm initial + 2 retries, `PAUSED_ERROR`, no downstream execution, then restore and use `Retry Job`.

- [ ] **Step 6: Run full 42-job sample acceptance**

Expected when Flow successfully generates every job:

- progress reaches `42 / 42`;
- `S01_IMG02` references `S01_IMG01`, `S01_IMG03` references `S01_IMG02`, and declared dependencies continue correctly;
- 42 image files exist under the batch Downloads folder;
- batch is `COMPLETED`;
- active binary cache contains zero records for the batch.

- [ ] **Step 7: Inspect permissions and packaged output**

Confirm manifest contains no permissions beyond `storage`, `downloads`, `tabs`, and the actual Flow host permission required by the tested production URL.

- [ ] **Step 8: Final verification commit**

```bash
git add docs/manual-test-checklist.md manifest.json src tests

git commit -m "test: verify flow batch extension v1"
```

---

## Implementation Order Rationale

Tasks 1-5 establish deterministic browser-independent behavior first. Task 6 intentionally verifies the two highest-risk assumptions — programmatic reference upload and generated-result Blob capture — before the orchestration/UI work is finished. Tasks 7-9 then connect those proven boundaries into a resilient MV3 runtime. Task 10 prevents declaring V1 complete until the user's real 42-job format, interruption behavior, retry semantics, and cache cleanup are verified end to end.

## Completion Definition

V1 is complete only when all automated tests pass, Rollup produces a loadable unpacked MV3 extension, the manual capability probe confirms reference upload and result Blob capture on the current Flow UI, the 1-scene and interruption smoke tests pass, and the full supplied 42-job batch satisfies the spec acceptance criteria without skipping failed dependencies or losing prior downloads.
