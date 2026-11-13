/** An error that is safe to show to the user. `detail` is technical output kept for logs/advanced view. */
export class ConversionError extends Error {
  constructor(message, { detail, code, internal = false, cancelled = false, suggestion } = {}) {
    super(message);
    this.name = 'ConversionError';
    this.detail = detail;
    this.code = code;
    this.internal = internal;
    this.cancelled = cancelled;
    this.suggestion = suggestion;
  }
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Turns engine stderr into a human sentence where we recognise the failure. */
export function explainFailure(err) {
  const text = `${err?.message || ''}\n${err?.detail || ''}`;
  const rules = [
    [/Invalid data found when processing input|moov atom not found|EBML header parsing failed/i, 'The file appears to be damaged or incomplete, so it could not be read.'],
    [/does not contain any stream|Output file .* does not contain any stream|Stream map .* matches no streams/i, 'The file does not contain the kind of data needed for this conversion (for example, no audio track).'],
    [/No space left on device/i, 'The server ran out of disk space. Please try again in a few minutes.'],
    [/password|encrypted/i, 'The file is password protected. Unlock it first, or provide the password.'],
    [/Unsupported codec|Decoder .* not found|unknown codec/i, 'The file uses a codec this server cannot decode.'],
    [/pixel limit|exceeds pixel limit|Input image exceeds/i, 'The image is larger than the maximum allowed resolution.'],
    [/corrupt|bad header|not a valid|Invalid (PDF|header)/i, 'The file appears to be damaged or is not a valid file of this type.'],
  ];
  for (const [re, msg] of rules) if (re.test(text)) return msg;
  return null;
}
