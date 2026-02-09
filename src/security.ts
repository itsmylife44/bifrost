export interface ValidationResult {
  valid: boolean;
  error?: string;
}

function normalizeUnicode(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\uFF01-\uFF5E]/g, (c) => 
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
    )
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
}

const SAFE_PATH_CHARS = /^[a-zA-Z0-9_.\-\/\s@:]+$/;

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\.\./, name: "path traversal (..)" },
  { pattern: /^\s*-/, name: "flag injection (starts with -)" },
  { pattern: /[`$]/, name: "command substitution ($ or `)" },
  { pattern: /[;&|]/, name: "command chaining (; & |)" },
  { pattern: /[\n\r]/, name: "newline injection" },
  { pattern: new RegExp("\\x00"), name: "null byte" },
  { pattern: /[\t\v\f]/, name: "tab or special whitespace" },
  { pattern: /[<>]/, name: "redirection (< or >)" },
  { pattern: /[*?[\]]/, name: "glob pattern (* ? [ ])" },
  { pattern: /[{}]/, name: "brace expansion ({ })" },
  { pattern: /[\\]/, name: "backslash escape" },
  { pattern: /[!#~^]/, name: "shell expansion (! # ~ ^)" },
  { pattern: /\$\(/, name: "command substitution $()" },
];

export function validatePath(path: string, fieldName: string): ValidationResult {
  if (!path || path.trim().length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }

  const normalized = normalizeUnicode(path);
  
  if (normalized !== path) {
    return { 
      valid: false, 
      error: `${fieldName} contains suspicious unicode characters` 
    };
  }

  if (!SAFE_PATH_CHARS.test(path)) {
    return { 
      valid: false, 
      error: `${fieldName} contains characters outside allowed set [a-zA-Z0-9_.\\-/@: ]` 
    };
  }

  for (const { pattern, name } of DANGEROUS_PATTERNS) {
    if (pattern.test(path)) {
      return {
        valid: false,
        error: `${fieldName} contains forbidden pattern: ${name}`,
      };
    }
  }

  if (path.length > 4096) {
    return { valid: false, error: `${fieldName} exceeds maximum length (4096)` };
  }

  return { valid: true };
}

export function validateCommand(command: string): ValidationResult {
  if (!command || command.trim().length === 0) {
    return { valid: false, error: "command cannot be empty" };
  }

  const normalized = normalizeUnicode(command);
  if (normalized !== command) {
    return { 
      valid: false, 
      error: "command contains suspicious unicode characters" 
    };
  }

  if (command.includes("\x00")) {
    return { valid: false, error: "command contains null byte" };
  }

  if (command.length > 65536) {
    return { valid: false, error: "command exceeds maximum length (64KB)" };
  }

  return { valid: true };
}

export function escapeShellArg(arg: string): string {
  return arg.replace(/'/g, "'\\''");
}
