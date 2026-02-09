import { describe, test, expect } from "bun:test";
import { validatePath, validateCommand, escapeShellArg } from "../src/security";

describe("validatePath", () => {
  describe("basic injection attacks", () => {
    test("rejects path traversal", () => {
      const result = validatePath("../etc/passwd", "remotePath");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("path traversal");
    });

    test("rejects double dot in middle", () => {
      const result = validatePath("/home/../root", "remotePath");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("path traversal");
    });

    test("rejects command substitution with $", () => {
      const result = validatePath("/tmp/$(rm -rf /)", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects command substitution with backtick", () => {
      const result = validatePath("/tmp/`whoami`", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects command chaining with semicolon", () => {
      const result = validatePath("/tmp; rm -rf /", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects command chaining with pipe", () => {
      const result = validatePath("/tmp | cat /etc/passwd", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects command chaining with ampersand", () => {
      const result = validatePath("/tmp & whoami", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects flag injection", () => {
      const result = validatePath("-rf /", "cwd");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("flag injection");
    });

    test("rejects newline injection", () => {
      const result = validatePath("/tmp\nrm -rf /", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects empty path", () => {
      const result = validatePath("", "remotePath");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("cannot be empty");
    });
  });

  describe("advanced bypass attempts", () => {
    test("rejects glob patterns with asterisk", () => {
      const result = validatePath("/???/c?t /???/p*sswd", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects glob patterns with question mark", () => {
      const result = validatePath("/bin/c?t", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects glob patterns with brackets", () => {
      const result = validatePath("/bin/[c]at", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects brace expansion", () => {
      const result = validatePath("{cat,/etc/passwd}", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects redirection with >", () => {
      const result = validatePath("/tmp > /etc/passwd", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects redirection with <", () => {
      const result = validatePath("cat < /etc/passwd", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects backslash escape", () => {
      const result = validatePath("c\\at /et\\c/pas\\swd", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects tilde expansion", () => {
      const result = validatePath("~root/.ssh/id_rsa", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects history expansion with !", () => {
      const result = validatePath("!!", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects hash comment", () => {
      const result = validatePath("/tmp #comment", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects caret substitution", () => {
      const result = validatePath("^old^new", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects tab character", () => {
      const result = validatePath("/tmp\t/etc", "cwd");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("tab");
    });

    test("rejects null byte", () => {
      const result = validatePath("/tmp\x00/etc", "cwd");
      expect(result.valid).toBe(false);
    });
  });

  describe("unicode bypass attempts", () => {
    test("rejects fullwidth semicolon", () => {
      const result = validatePath("/tmp\uFF1Bwhoami", "cwd");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("unicode");
    });

    test("rejects fullwidth pipe", () => {
      const result = validatePath("/tmp\uFF5Cwhoami", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects smart quotes", () => {
      const result = validatePath("/tmp\u201Ctest\u201D", "cwd");
      expect(result.valid).toBe(false);
    });

    test("rejects unicode dash variants", () => {
      const result = validatePath("\u2013rf /", "cwd");
      expect(result.valid).toBe(false);
    });
  });

  describe("valid paths", () => {
    test("accepts valid absolute path", () => {
      const result = validatePath("/home/user/file.txt", "remotePath");
      expect(result.valid).toBe(true);
    });

    test("accepts valid relative path without traversal", () => {
      const result = validatePath("subdir/file.txt", "remotePath");
      expect(result.valid).toBe(true);
    });

    test("accepts path with spaces", () => {
      const result = validatePath("/home/user/my file.txt", "remotePath");
      expect(result.valid).toBe(true);
    });

    test("accepts path with dashes and underscores", () => {
      const result = validatePath("/home/user/my-file_name.txt", "remotePath");
      expect(result.valid).toBe(true);
    });

    test("accepts path with dots in filename", () => {
      const result = validatePath("/home/user/file.tar.gz", "remotePath");
      expect(result.valid).toBe(true);
    });

    test("accepts path with @ symbol", () => {
      const result = validatePath("/home/user@host/file", "remotePath");
      expect(result.valid).toBe(true);
    });

    test("accepts path with colon", () => {
      const result = validatePath("/home/user/file:2", "remotePath");
      expect(result.valid).toBe(true);
    });
  });

  describe("length limits", () => {
    test("rejects path exceeding 4096 chars", () => {
      const longPath = "/home/" + "a".repeat(4100);
      const result = validatePath(longPath, "remotePath");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("maximum length");
    });
  });
});

describe("validateCommand", () => {
  test("accepts valid command", () => {
    const result = validateCommand("ls -la /home");
    expect(result.valid).toBe(true);
  });

  test("rejects empty command", () => {
    const result = validateCommand("");
    expect(result.valid).toBe(false);
  });

  test("rejects null byte in command", () => {
    const result = validateCommand("ls\x00 -la");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("null byte");
  });

  test("rejects unicode bypass in command", () => {
    const result = validateCommand("ls\uFF1B whoami");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("unicode");
  });

  test("rejects command exceeding 64KB", () => {
    const longCmd = "echo " + "a".repeat(70000);
    const result = validateCommand(longCmd);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("maximum length");
  });
});

describe("escapeShellArg", () => {
  test("escapes single quotes", () => {
    const result = escapeShellArg("it's a test");
    expect(result).toBe("it'\\''s a test");
  });

  test("handles multiple single quotes", () => {
    const result = escapeShellArg("it's Bob's file");
    expect(result).toBe("it'\\''s Bob'\\''s file");
  });

  test("leaves string without quotes unchanged", () => {
    const result = escapeShellArg("simple-path");
    expect(result).toBe("simple-path");
  });
});
