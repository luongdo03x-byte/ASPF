export class ExtensionError extends Error {
  constructor(code, message, {retryable=false, stage=null}={}) { super(message); this.name='ExtensionError'; this.code=code; this.retryable=retryable; this.stage=stage; }
}
export function asExtensionError(error, fallback={code:'UNKNOWN',retryable:false,stage:null}) {
  if (error instanceof ExtensionError) return error;
  return new ExtensionError(error?.code || fallback.code, error?.message || String(error), {retryable:error?.retryable ?? fallback.retryable, stage:error?.stage ?? fallback.stage});
}
