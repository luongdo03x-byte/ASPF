# Flow Batch Generator V1 — Manual Test Checklist

- [ ] Open exactly one `https://flow.google/` project tab and keep it logged in.
- [ ] Load `dist/` as an unpacked extension in `chrome://extensions` (Developer mode).
- [ ] Import full `prompts_batch.md` -> 42 jobs, 14 scenes, no validation errors.
- [ ] S01_IMG01 runs without a reference image.
- [ ] S01_IMG02 uploads the generated S01_IMG01 result as its reference.
- [ ] S01_IMG03 uploads the generated S01_IMG02 result as its reference.
- [ ] Flow is placed in Image mode, 16:9, 1 output, with Nano Banana Pro when those controls are discoverable.
- [ ] Each successful asset downloads immediately under `Downloads/FlowBatch/<batch-name>/`.
- [ ] PNG/JPEG/WebP filename extension matches the real MIME type.
- [ ] Close/reopen popup between jobs -> batch keeps state.
- [ ] Reload Flow between jobs -> extension reconnects and resumes.
- [ ] Restart Chrome between jobs -> unfinished batch resumes.
- [ ] Restart during generation -> uncertain current job regenerates; completed jobs do not repeat.
- [ ] Force initial generation + 2 retries to fail -> batch pauses; downstream dependency does not start.
- [ ] Fix the issue and press Retry Job -> same failed job resumes with retry counter reset.
- [ ] Pause during generation -> current safe boundary completes, next job does not start.
- [ ] Stop -> batch becomes STOPPED and cached generated blobs are removed; downloaded files remain.
- [ ] Complete full sample -> 42 downloads, batch COMPLETED, IndexedDB batch cache empty.
