# Flow Batch Extension V1 — Design Specification

Date: 2026-09-22
Status: Approved for V1 implementation

## 1. Purpose

Build a Chrome Extension (Manifest V3) that automates image generation in a Google Flow tab already opened and authenticated by the user.

The extension's V1 goal is to accept one `prompts_batch.md` file following the user's current 42-prompt format, parse it into an ordered dependency-aware job queue, generate exactly one image per prompt, download each result immediately, cache generated images for downstream reference use, and resume safely after reloads or browser restarts.

V1 intentionally avoids any private API dependency, backend service, or API key. It controls the Flow UI using a hybrid DOM-driven adapter plus multi-signal state detection.

## 2. Success Criteria

V1 is considered successful when it can:

1. Import the current `prompts_batch.md` format.
2. Parse all 42 image jobs and 14 scenes correctly.
3. Validate dependencies before execution.
4. Run jobs sequentially in the correct order.
5. Generate exactly one image per prompt.
6. Use the previous generated image as the reference image when specified by the prompt metadata.
7. Download every successful image immediately using the job ID as the filename.
8. Cache generated image blobs in IndexedDB for dependency reuse and resume.
9. Resume from the latest unfinished job after extension reload, Flow-tab reload, or Chrome restart.
10. Retry a failed job at most two times, then pause the batch and require user action.
11. Never skip a failed dependency and continue into dependent jobs.
12. Keep already downloaded files even if the batch later fails or is stopped.

## 3. V1 Scope

### Included

- Chrome Extension Manifest V3.
- Popup UI.
- Import of `prompts_batch.md` only.
- Markdown parser tailored to the current prompt format.
- Dependency graph validation.
- Sequential job queue.
- Direct control of an already-open Google Flow tab.
- Automatic image mode selection where possible.
- Automatic output count = 1.
- Automatic aspect ratio selection from parsed job data, with current V1 expectation of 16:9.
- Prompt insertion.
- Reference-image upload.
- Generate action.
- Generation completion detection using multiple UI signals.
- Generated asset capture.
- Immediate download to `Downloads/FlowBatch/<batch-name>/`.
- IndexedDB blob cache.
- `chrome.storage.local` batch-state persistence.
- Pause / resume / retry / stop controls.
- Maximum two automatic retries per job.
- Basic execution log in popup UI.

### Explicitly Excluded from V1

- `.json` or `.txt` input formats.
- Multiple simultaneous Flow tabs.
- Parallel prompt execution.
- Multiple outputs per prompt.
- Manual image selection among multiple candidates.
- Per-job model selection.
- Prompt editing UI.
- Batch gallery.
- Private/internal Google Flow API calls.
- Server/backend components.
- Cloud synchronization.
- Automatic Google account login.
- Quota bypassing or generation-limit bypassing.

## 4. Input Format

V1 supports the existing Markdown structure only.

Example conceptual block:

```md
## [2/42] S01_IMG02 — dùng S01_IMG01 làm ảnh tham chiếu

**Thao tác:** upload `sources/S01_IMG01.png` vào Gemini trước, rồi dán prompt dưới

**Yêu cầu độ phân giải:** tối thiểu 3072px chiều ngang, tỷ lệ 16:9

<Vietnamese scene description>
<shot instruction>
--- style lock ---
<style text>
--- negative ---
<negative text>
```

The parser must extract at minimum:

- ordinal index
- total count
- job ID
- scene ID
- image ID
- reference job ID or null
- minimum requested width
- aspect ratio
- main prompt text
- style lock text
- negative prompt text
- output filename

## 5. Normalized Job Model

```ts
interface FlowBatchJob {
  index: number;
  total: number;
  id: string;              // e.g. S01_IMG02
  sceneId: string;         // e.g. S01
  imageId: string;         // e.g. IMG02
  referenceId: string | null;
  minWidth: number | null;
  aspectRatio: string;     // e.g. 16:9
  mainPrompt: string;
  styleLock: string;
  negativePrompt: string;
  finalPrompt: string;
  filename: string;        // e.g. S01_IMG02.png
  status: JobStatus;
  retryCount: number;
  lastError?: string;
}
```

`finalPrompt` is constructed from the current Markdown block without silently rewriting its wording.

Default construction:

```text
<mainPrompt>

--- style lock ---
<styleLock>

--- negative ---
<negativePrompt>
```

## 6. Batch Naming and Model

V1 derives a default batch name from the imported Markdown filename plus a local timestamp, sanitized for use as a Downloads subdirectory. The popup may display the derived name, but V1 does not require a batch-name editor.

Example:

```text
prompts_batch-20260922-1127
```


```ts
interface FlowBatch {
  id: string;
  name: string;
  sourceFilename: string;
  createdAt: string;
  updatedAt: string;
  status: BatchStatus;
  currentJobId: string | null;
  lastCompletedJobId: string | null;
  settings: {
    mode: "image";
    outputs: 1;
    maxRetries: 2;
  };
  jobs: FlowBatchJob[];
}
```

## 7. Validation Rules

Validation occurs before Start is enabled.

The validator must reject the batch if any of the following are true:

- duplicate job ID
- missing job ID
- malformed ordinal metadata
- missing main prompt
- missing aspect ratio
- reference points to a nonexistent job
- reference points to a later job
- cyclic dependency
- unsupported structural format

The validator should also warn, but not necessarily reject, when:

- minimum resolution is present but Flow exposes no equivalent UI control
- scene numbering is non-contiguous
- image numbering differs from the expected `IMG01/IMG02/IMG03` pattern

The queue engine follows actual declared dependencies rather than assuming every scene is exactly three images.

## 8. Dependency Rules

A job is runnable only when:

- `referenceId === null`, or
- the referenced job has status `DONE` and a cached blob exists in IndexedDB.

For the current sample format, the normal scene pattern is:

```text
IMG01 -> no reference
IMG02 -> reference IMG01
IMG03 -> reference IMG02
```

A failed dependency blocks all downstream jobs that depend on it.

V1 never skips a failed job automatically.

## 9. Queue Execution Model

Execution is strictly sequential.

High-level loop:

```text
load batch
  -> find earliest runnable unfinished job
  -> prepare Flow
  -> upload reference if required
  -> set prompt
  -> generate
  -> wait for result
  -> capture result
  -> cache blob
  -> download file
  -> mark DONE
  -> persist state
  -> continue
```

No two jobs may be in an active generation state simultaneously.

## 10. Job State Machine

Allowed states:

```text
PENDING
PREPARING_FLOW
UPLOADING_REFERENCE
SETTING_PROMPT
GENERATING
WAITING_RESULT
CAPTURING_RESULT
CACHING_RESULT
DOWNLOADING
DONE
RETRY_WAIT
FAILED
PAUSED
```

Nominal transition:

```text
PENDING
 -> PREPARING_FLOW
 -> UPLOADING_REFERENCE? 
 -> SETTING_PROMPT
 -> GENERATING
 -> WAITING_RESULT
 -> CAPTURING_RESULT
 -> CACHING_RESULT
 -> DOWNLOADING
 -> DONE
```

If any retryable stage fails:

```text
<active state>
 -> RETRY_WAIT
 -> retry same job
```

After two automatic retries fail:

```text
<active state>
 -> FAILED
 -> batch PAUSED_ERROR
```

The user can then choose:

- Retry Job
- Stop Batch

## 11. Batch States

```text
READY
RUNNING
PAUSED_USER
PAUSED_ERROR
COMPLETED
STOPPED
```

`COMPLETED` is reached only when every job is `DONE`.

## 12. Flow Adapter Architecture

All knowledge about Google Flow's DOM must be isolated in the Flow integration layer.

Recommended interface:

```ts
interface FlowAdapter {
  ensureReady(): Promise<void>;
  setImageMode(): Promise<void>;
  setAspectRatio(value: string): Promise<void>;
  setOutputCount(value: 1): Promise<void>;
  clearReferenceInputs(): Promise<void>;
  uploadReference(file: File): Promise<void>;
  clearPrompt(): Promise<void>;
  setPrompt(text: string): Promise<void>;
  clickGenerate(): Promise<void>;
  waitForGenerationStart(): Promise<void>;
  waitForResult(context: GenerationContext): Promise<FlowResult>;
  getLatestResultBlob(result: FlowResult): Promise<Blob>;
}
```

Flow adapter implementation must not rely on one long brittle CSS selector.

## 13. Selector Strategy

Selectors should be resolved using layered fallbacks:

1. stable semantic attributes when available
2. `aria-label`
3. `role`
4. visible control text
5. `contenteditable`
6. structurally scoped fallback selectors

All selectors belong in `flow/selectors.js` or equivalent configuration.

The queue engine must never contain Google Flow selectors directly.

## 14. Hybrid Completion Detection

V1 must not use a fixed sleep as the primary completion mechanism.

Generation completion should be inferred from a combination of signals such as:

- Generate action was accepted.
- Loading/progress state appeared.
- DOM mutation introduced a new result asset/card.
- Loading/progress state disappeared.
- New image asset differs from the pre-generation result snapshot.
- Result action/menu becomes available.

A timeout remains necessary as a failure guard, but not as the success criterion.

## 15. Reference Image Handling

When a job requires a reference:

1. Retrieve the referenced blob from IndexedDB.
2. Construct a `File` using the referenced job filename.
3. Inject it into the Flow upload input using the supported browser file-input path.
4. Wait until Flow visibly confirms the uploaded reference is attached.
5. Only then set/generate the dependent prompt.

Conceptual conversion:

```js
const file = new File([blob], "S01_IMG01.png", {
  type: blob.type || "image/png"
});
```

The implementation must verify that the Flow upload control actually accepts programmatically supplied files in the current UI. If browser security or Flow implementation prevents reliable assignment, this is treated as an implementation risk requiring a targeted fallback design before V1 can be considered complete.

## 16. Result Capture

V1 should prefer capturing the generated image asset as a Blob once the result is available.

The result blob has two uses:

1. cache for later reference upload
2. immediate user download

The capture implementation may obtain the blob from a browser-accessible image/resource URL if permitted by the page and extension security context.

V1 must not depend on undocumented private backend API contracts.

## 17. Download Behavior

Each successful result is downloaded immediately.

Destination pattern:

```text
Downloads/FlowBatch/<batch-name>/<job-id>.<detected-extension>
```

Example:

```text
Downloads/FlowBatch/project-01/S01_IMG01.png
Downloads/FlowBatch/project-01/S01_IMG02.png
Downloads/FlowBatch/project-01/S01_IMG03.png
```

If the actual generated asset is JPEG/WebP rather than PNG, implementation must choose one explicit behavior and keep extension metadata consistent. Preferred V1 behavior is to preserve the actual image encoding and extension rather than relabel bytes incorrectly.

Therefore the final filename rule should be:

```text
<job-id>.<detected-extension>
```

unless Flow reliably provides PNG bytes.

## 18. Persistence

### chrome.storage.local

Stores lightweight recoverable state:

- active batch ID
- batch status
- current job ID
- last completed job ID
- retry count
- parsed job metadata
- timestamps
- latest error

### IndexedDB

Stores binary result data:

```text
key: <batch-id>:<job-id>
value:
  blob
  mimeType
  filename
  createdAt
```

## 19. Resume Semantics

On extension startup:

1. Load persisted batch metadata.
2. If no active unfinished batch exists, show import state.
3. If an unfinished batch exists, load current job metadata.
4. Verify all required completed dependency blobs still exist.
5. Locate an eligible Google Flow tab.
6. If Flow is not available, show `Waiting for Flow tab` and do not mutate batch progress.
7. Once Flow is available and ready, continue the current unfinished job from a safe boundary.

V1 does not attempt to resume midway through an uncertain generation side effect.

If Chrome restarted while a job was `GENERATING` or `WAITING_RESULT`, the safe default is:

- mark that job as needing retry
- inspect current Flow result state where feasible
- if completion cannot be proven unambiguously, regenerate that single job rather than incorrectly marking it done

This can create at most one duplicate generation for an interrupted in-flight job, but avoids corrupting dependency state.

## 20. Retry Policy

Automatic retries per job: 2.

Retryable examples:

- temporary selector not found
- temporary upload failure
- generation start not detected
- result timeout
- generated result card not yet stable
- blob capture transient failure

Non-retryable or user-action errors:

- Google login required
- unsupported prompt file format
- quota/credit blocked
- Flow page not supported
- permission denied for required extension capability
- missing dependency blob after persisted state claims completion

After automatic retries are exhausted, the batch pauses.

## 21. Pause, Stop, and Retry Semantics

### Pause

- Finish no new jobs.
- If currently between jobs, pause immediately.
- If currently generating, implementation should not assume generation can be canceled; record pause intent and stop before starting the next job.

### Retry Job

- reset current failed job to runnable state
- preserve completed jobs and cached dependencies
- retry only the failed job

### Stop Batch

- mark batch `STOPPED`
- never delete already downloaded files
- persist the batch as `STOPPED` first
- then clear the batch's IndexedDB binary cache automatically
- never delete files already downloaded to the user's Downloads folder

## 22. Cache Cleanup

When batch status becomes `COMPLETED`:

- retain metadata summary
- remove all IndexedDB blobs for the batch
- keep downloaded files

When batch becomes `STOPPED`:

- remove binary cache
- retain minimal batch history and error/log summary

## 23. Popup UI

### Import State

Displays:

- file import control
- detected job count
- detected scene count
- validation result
- Flow-tab connection state
- Start button

### Running State

Displays:

- batch name
- progress `N / total`
- current job ID
- current reference ID
- current execution stage
- retry count
- recent log lines
- Pause button
- Stop button

### Error State

Displays:

- failed job ID
- failed stage
- concise error reason
- Retry Job
- Stop Batch

## 24. Extension Components

Recommended project structure:

```text
flow-batch-extension/
  manifest.json
  src/
    core/
      parser.js
      validator.js
      queue.js
      state-machine.js
      batch-controller.js
    flow/
      selectors.js
      flow-adapter.js
      result-detector.js
    storage/
      state-store.js
      idb-cache.js
      download-manager.js
    content/
      content-script.js
    background/
      service-worker.js
    ui/
      popup.html
      popup.js
      popup.css
  tests/
    parser/
    validator/
    queue/
    state-machine/
  docs/
    superpowers/
      specs/
```

## 25. Responsibilities by Component

### parser.js

- split Markdown into job blocks
- extract structured fields
- construct final prompt

### validator.js

- validate job IDs
- validate dependencies
- detect cycles
- report errors/warnings

### queue.js

- determine next runnable job
- enforce strict sequencing
- enforce dependency readiness

### state-machine.js

- validate state transitions
- provide deterministic execution state

### batch-controller.js

- orchestrate parser output, queue, Flow adapter, cache, persistence, retry, pause and completion

### selectors.js

- central registry of Flow selector candidates

### flow-adapter.js

- all Flow UI mutations/actions

### result-detector.js

- snapshot result state
- observe mutations
- decide when a new stable result exists

### state-store.js

- wrapper over `chrome.storage.local`

### idb-cache.js

- binary result cache

### download-manager.js

- filename/extension handling
- `chrome.downloads` integration

### content-script.js

- runs in Flow page context
- exposes narrow message-based commands to background/controller

### service-worker.js

- persistent orchestration boundary appropriate to MV3
- tab discovery
- extension messages
- downloads

## 26. Permissions

Expected Manifest V3 permissions may include:

- `storage`
- `downloads`
- `tabs` or `activeTab` depending on final tab-discovery design
- host permissions restricted to the actual Google Flow origin(s) required by the implementation

Permissions must be minimized after the actual Flow URL/origin is confirmed during implementation.

## 27. Security and Privacy

V1 must:

- keep prompt data local to the browser except where sent to Flow through normal UI interaction
- keep generated blob cache local in IndexedDB
- use no custom backend
- use no API key
- avoid collecting Google credentials
- avoid exporting cookies/session tokens
- clear binary cache after completion/stop

## 28. Testing Strategy

### Unit Tests

Parser:

- no-reference job
- reference job
- 3072px/4608px extraction
- aspect ratio extraction
- style lock extraction
- negative extraction
- final prompt construction

Validator:

- duplicate ID
- missing reference
- forward reference
- cycle
- valid chain

Queue:

- no-reference first job
- dependency blocked
- dependency ready
- completed jobs ignored
- failure pauses downstream execution

State machine:

- allowed transitions
- invalid transitions rejected
- retry counting
- pause semantics

### Integration / Manual Tests

1. One scene / three jobs.
2. Two scenes / six jobs.
3. Full 42-job sample.
4. Popup close/reopen while idle between jobs.
5. Flow tab reload between jobs.
6. Chrome restart between jobs.
7. Chrome restart while generation is in flight.
8. Reference upload failure.
9. Generation timeout.
10. Two retries exhausted -> batch pauses.
11. Manual Retry Job succeeds.
12. Final completion clears binary cache but preserves downloads.

## 29. Acceptance Test for the User's Sample

Given the supplied `prompts_batch.md`:

- parser reports 42 jobs
- parser reports 14 unique scenes
- `S01_IMG01.referenceId === null`
- `S01_IMG02.referenceId === "S01_IMG01"`
- `S01_IMG03.referenceId === "S01_IMG02"`
- corresponding pattern continues through `S14_IMG03`
- batch runs in original file order
- each generated result is immediately downloaded
- dependent jobs receive the immediately preceding declared reference
- completion results in 42 downloaded image files if all jobs succeed

## 30. Risks and Mitigations

### Risk: Google Flow UI changes

Mitigation:

- isolate selectors
- use semantic/fallback selector strategy
- keep adapter independent from queue logic
- add adapter-level smoke checks

### Risk: Flow blocks programmatic file-input manipulation

Mitigation:

- verify early with a minimal reference-upload integration test
- if direct file injection is unreliable, redesign only the reference-upload boundary rather than the queue/parser architecture

### Risk: Result image cannot be fetched as Blob because of resource/CORS constraints

Mitigation:

- test blob capture early
- if direct page-context fetch is blocked, use an extension-permitted resource path or Flow's visible download action, while preserving a local reference-copy strategy

### Risk: MV3 service worker suspension

Mitigation:

- persist state after every meaningful state transition
- avoid relying on in-memory controller state as source of truth
- reconstruct orchestration from storage on wake

### Risk: duplicate generation after crash during in-flight job

Mitigation:

- prefer a safe retry over an unverified success
- only mark a job `DONE` after blob cache and download have completed successfully

## 31. Design Decisions Confirmed with User

1. Control the currently open, authenticated Flow tab.
2. Exactly one generated image per prompt.
3. V1 supports only the current `prompts_batch.md` format.
4. Download every result immediately.
5. Download under `Downloads/FlowBatch/<batch-name>/`.
6. Resume automatically after interruption.
7. Cache generated images in IndexedDB during an active batch.
8. Retry each job at most two times.
9. After retries are exhausted, pause the entire batch.
10. Automatically set Flow image-generation options that are controllable from the UI.
11. Use hybrid DOM automation plus multi-signal completion detection.
12. Strict sequential execution; no parallel generation in V1.

## 32. Open Implementation Checks

These are not unresolved product requirements; they are technical checks that must be verified during implementation:

1. Exact current Google Flow origin(s) needed in host permissions.
2. Reliable selector candidates for prompt input, image mode, aspect ratio, output count, upload control, Generate, progress, result asset, and result actions.
3. Whether current Flow permits reliable programmatic `File` assignment to the reference upload control.
4. Whether current result assets can be captured directly as Blob from the extension context.
5. Whether Flow always emits a known image MIME type or whether filename extension must be detected dynamically.

If any check invalidates the current adapter boundary, only the affected integration layer should be redesigned unless the finding changes a confirmed product requirement.
