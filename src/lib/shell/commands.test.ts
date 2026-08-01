import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

import { createShellState, httpClient, prepareCommand } from "./commands";
import { executeShell, type PipelineExit } from "./execute";
import {
  createEofFileDescriptor,
  createMemoryFileDescriptor,
  createTerminalFileDescriptor,
  filesystem,
} from "./filesystem";
import { asAbsolutePath, asExitCode, asPid } from "./schemas";
import type {
  FileChunk,
  FileDescriptor,
  ProcessContext,
  ProcessIO,
} from "./types";

const decoder = new TextDecoder();
let shellState = createShellState();

type CapturedExecution = Readonly<{
  result: PipelineExit;
  stdout: readonly FileChunk[];
  stderr: readonly FileChunk[];
}>;

const textOf = (chunks: readonly FileChunk[]): string =>
  chunks.map((chunk) => decoder.decode(chunk.bytes)).join("");

const actionsOf = (chunks: readonly FileChunk[]) =>
  chunks.flatMap((chunk) => chunk.actions);

const byteLengthOf = (chunks: readonly FileChunk[]): number =>
  chunks.reduce((total, value) => total + value.bytes.byteLength, 0);

const execute = async (
  source: string,
  stdin: FileDescriptor = createEofFileDescriptor(),
  state = shellState,
): Promise<CapturedExecution> => {
  const stdout: FileChunk[] = [];
  const stderr: FileChunk[] = [];
  const io: ProcessIO = {
    stdin,
    stdout: createTerminalFileDescriptor("stdout", (_stream, value) => {
      stdout.push(value);
    }),
    stderr: createTerminalFileDescriptor("stderr", (_stream, value) => {
      stderr.push(value);
    }),
  };

  return {
    result: await executeShell(source, io, state).completed,
    stdout,
    stderr,
  };
};

beforeEach(() => {
  shellState = createShellState();
});

afterEach(() => {
  mock.restore();
});

describe("cat", () => {
  test("reads the explicitly passed EOF stdin when no path is given", async () => {
    const execution = await execute("cat");

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(execution.result.processes).toHaveLength(1);
    expect(execution.result.processes[0]?.argv).toEqual(["cat"]);
    expect(execution.stdout).toEqual([]);
    expect(execution.stderr).toEqual([]);
  });

  test("renders the website README Markdown without terminal controls", async () => {
    const execution = await execute("cat readme.md");

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(textOf(execution.stdout)).toContain(
      "software engineer, amateur chess player",
    );
    expect(actionsOf(execution.stdout)).toEqual([]);
    expect(execution.stdout[0]?.presentation?.kind).toBe("html");
    expect(execution.stderr).toEqual([]);
  });

  test("renders links.md as safe HTML while preserving its Markdown bytes", async () => {
    const execution = await execute("cat links.md");
    const presentation = execution.stdout[0]?.presentation;

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(textOf(execution.stdout)).toContain(
      "[github](https://github.com/aripiprazole)",
    );
    expect(presentation?.kind).toBe("html");
    if (presentation?.kind !== "html") throw new Error("expected HTML output");
    expect(presentation.html).toContain(
      '<a href="https://github.com/aripiprazole"',
    );
    expect(presentation.html).not.toContain("<script");
  });

  test("lets an unexpected filesystem error escape to the process runner", async () => {
    const unexpected = new Error("unexpected open failure");
    spyOn(filesystem, "open").mockRejectedValue(unexpected);
    const command = prepareCommand(["cat", "README.md"]);
    const controller = new AbortController();
    const context: ProcessContext = {
      pid: asPid(1),
      argv: command.argv,
      cwd: filesystem.initialDirectory,
      oldCwd: filesystem.initialDirectory,
      stdin: createEofFileDescriptor(),
      stdout: createMemoryFileDescriptor([], { access: "write" }),
      stderr: createMemoryFileDescriptor([], { access: "write" }),
      signal: controller.signal,
    };

    await expect(command.run(context)).rejects.toBe(unexpected);

    const execution = await execute("cat readme.md");
    expect(execution.result.exitCode).toBe(asExitCode(1));
    expect(textOf(execution.stderr)).toBe("cat: unexpected open failure\n");
  });
});

describe("filesystem command operands", () => {
  test.each(["cat ''", "ls ''", "cd ''"])(
    "rejects an explicitly empty path: %s",
    async (source) => {
      const execution = await execute(source);

      expect(execution.result.exitCode).toBe(asExitCode(1));
      expect(textOf(execution.stderr).toLowerCase()).toContain("empty");
    },
  );
});

describe("png", () => {
  test("renders profile.png with a rounded default", async () => {
    const execution = await execute("png profile.png");
    const presentation = execution.stdout[0]?.presentation;

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(presentation).toEqual({
      kind: "image",
      src: "/profile.png",
      alt: "Pixel-art portrait of Gabrielle",
      borderRadius: 12,
    });
    expect(textOf(execution.stdout)).toBe("");
  });

  test("accepts explicit border radii and preserves image output through a pipe", async () => {
    const execution = await execute("png --radius 24 profile.png | cat");

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(execution.stdout[0]?.presentation).toMatchObject({
      kind: "image",
      borderRadius: 24,
    });
  });

  test("rejects missing assets and invalid radii", async () => {
    const missing = await execute("png missing.png");
    const invalid = await execute("png -r round profile.png");

    expect(missing.result.exitCode).toBe(asExitCode(1));
    expect(textOf(missing.stderr)).toContain("no such file or directory");
    expect(invalid.result.exitCode).toBe(asExitCode(2));
    expect(textOf(invalid.stderr)).toContain("non-negative integer");
  });
});

describe("ls", () => {
  test("makes -1 and --one-per-line meaningfully different from terminal default output", async () => {
    const defaultExecution = await execute("ls");
    const shortFlagExecution = await execute("ls -1");
    const longFlagExecution = await execute("ls --one-per-line");
    const defaultOutput = textOf(defaultExecution.stdout);
    const onePerLineOutput = textOf(shortFlagExecution.stdout);

    expect(defaultExecution.result.exitCode).toBe(asExitCode(0));
    expect(shortFlagExecution.result.exitCode).toBe(asExitCode(0));
    expect(longFlagExecution.result.exitCode).toBe(asExitCode(0));
    expect(defaultOutput).not.toBe(onePerLineOutput);
    expect(defaultOutput.trim().split("\n")).toHaveLength(1);
    expect(onePerLineOutput.trim().split("\n")).toHaveLength(7);
    expect(textOf(longFlagExecution.stdout)).toBe(onePerLineOutput);
    expect(actionsOf(defaultExecution.stdout)).toEqual(
      actionsOf(shortFlagExecution.stdout),
    );
  });

  test("accepts clustered flags and emits a long human-readable listing", async () => {
    const execution = await execute("ls -lah1");
    const output = textOf(execution.stdout);
    const actions = actionsOf(execution.stdout);

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(output).toContain("total 24\n");
    expect(output).toContain("  4.0K Jul 31 00:00 ./\n");
    expect(output).toContain("  4.0K Jul 31 00:00 ../\n");
    expect(output).not.toMatch(/(?:^|\s)[dl-][rwx-]{9}(?:\s|$)/m);
    expect(output).not.toContain("gabi");
    expect(output).toContain("readme.md\n");
    expect(output.split("\n").filter(Boolean)).toHaveLength(10);
    expect(actions).toHaveLength(5);
    expect(actions).toContainEqual({
      label: "projects/",
      command: "cd projects/",
      behavior: "prefill",
    });
  });

  test("does not turn regular files into navigation controls", async () => {
    const execution = await execute("ls projects | cat");
    const actions = actionsOf(execution.stdout);

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(textOf(execution.stdout)).toContain("plank.txt");
    expect(actions).toEqual([]);
  });
});

describe("cd", () => {
  test("applies a standalone cwd effect but isolates a successful pipeline effect", async () => {
    const standalone = await execute("cd projects");

    expect(standalone.result.exitCode).toBe(asExitCode(0));
    expect(shellState.cwd).toBe(asAbsolutePath("/app/projects"));
    expect(shellState.oldCwd).toBe(asAbsolutePath("/app"));

    const pipeline = await execute("cd ../writings | cat");

    expect(
      pipeline.result.processes.map((process) => process.exitCode),
    ).toEqual([asExitCode(0), asExitCode(0)]);
    expect(shellState.cwd).toBe(asAbsolutePath("/app/projects"));
    expect(shellState.oldCwd).toBe(asAbsolutePath("/app"));
  });
});

describe("pwd", () => {
  test("prints the current absolute directory through stdout", async () => {
    const initialDirectory = await execute("pwd");

    expect(initialDirectory.result.exitCode).toBe(asExitCode(0));
    expect(textOf(initialDirectory.stdout)).toBe("/app\n");
    expect(initialDirectory.stderr).toEqual([]);

    await execute("cd projects");
    const projectDirectory = await execute("pwd | cat");

    expect(projectDirectory.result.exitCode).toBe(asExitCode(0));
    expect(textOf(projectDirectory.stdout)).toBe("/app/projects\n");
    expect(projectDirectory.stderr).toEqual([]);
  });

  test("rejects operands", async () => {
    const execution = await execute("pwd projects");

    expect(execution.result.exitCode).toBe(asExitCode(2));
    expect(textOf(execution.stderr)).toBe(
      "pwd: unsupported argument: projects\n",
    );
  });
});

describe("split", () => {
  test("emits a standalone terminal split effect without output", async () => {
    const execution = await execute("split");

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(execution.result.effects).toEqual([{ kind: "split" }]);
    expect(execution.stdout).toEqual([]);
    expect(execution.stderr).toEqual([]);
  });

  test("rejects arguments and isolates its effect inside a pipeline", async () => {
    const invalid = await execute("split extra");
    const pipeline = await execute("split | cat");

    expect(invalid.result.exitCode).toBe(asExitCode(2));
    expect(textOf(invalid.stderr)).toContain("unsupported argument: extra");
    expect(pipeline.result.exitCode).toBe(asExitCode(0));
    expect(pipeline.result.effects).toEqual([]);
  });
});

describe("shell sessions", () => {
  test("keeps cwd, previous cwd, and pid allocation independent", async () => {
    const first = createShellState();
    const second = createShellState();

    await execute("cd projects", createEofFileDescriptor(), first);
    const secondPwd = await execute("pwd", createEofFileDescriptor(), second);

    expect(first.cwd).toBe(asAbsolutePath("/app/projects"));
    expect(first.oldCwd).toBe(asAbsolutePath("/app"));
    expect(first.nextPid).toBe(2);
    expect(second.cwd).toBe(asAbsolutePath("/app"));
    expect(second.oldCwd).toBe(asAbsolutePath("/app"));
    expect(second.nextPid).toBe(2);
    expect(textOf(secondPwd.stdout)).toBe("/app\n");
  });
});

describe("capped curl", () => {
  test("uses the restricted request policy and emits only inert response chunks", async () => {
    const request = spyOn(httpClient, "request").mockResolvedValue(
      new Response("hello from the web", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );

    const execution = await execute(
      "curl --max-time 1 --max-filesize 64 https://example.com/readme",
    );
    const [url, init] = request.mock.calls[0] ?? [];

    expect(execution.result.exitCode).toBe(asExitCode(0));
    expect(textOf(execution.stdout)).toBe("hello from the web");
    expect(actionsOf(execution.stdout)).toEqual([]);
    expect(url?.href).toBe("https://example.com/readme");
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test.each(["https://fc.example.com", "https://fd.example.com"])(
    "allows public DNS names that begin with an IPv6-private-looking prefix: %s",
    async (url) => {
      const request = spyOn(httpClient, "request").mockResolvedValue(
        new Response("public hostname", {
          headers: { "content-type": "text/plain" },
        }),
      );

      const execution = await execute(`curl ${url}`);

      expect(execution.result.exitCode).toBe(asExitCode(0));
      expect(textOf(execution.stdout)).toBe("public hostname");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    "http://example.com",
    "https://localhost",
    "https://localhost.",
    "https://api.localhost.",
    "https://127.0.0.1",
    "https://127.0.0.1.",
    "https://[::1]",
    "https://[fc00::1]",
    "https://[fd12:3456::1]",
    "https://[fe80::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:10.0.0.1]",
    "https://user:password@example.com",
  ])("rejects a disallowed URL without making a request: %s", async (url) => {
    const request = spyOn(httpClient, "request");
    const execution = await execute(`curl '${url}'`);

    expect(execution.result.exitCode).toBe(asExitCode(2));
    expect(textOf(execution.stderr)).toContain(
      "only public HTTPS URLs without credentials are allowed",
    );
    expect(request).not.toHaveBeenCalled();
  });

  test("rejects a response without a declared Content-Type", async () => {
    spyOn(httpClient, "request").mockResolvedValue(
      new Response(new TextEncoder().encode("undeclared bytes")),
    );

    const execution = await execute("curl https://example.com/no-content-type");

    expect(execution.result.exitCode).toBe(asExitCode(1));
    expect(execution.stdout).toEqual([]);
    expect(textOf(execution.stderr).toLowerCase()).toMatch(/content[- ]type/);
  });

  test("counts included headers and body against one total output cap", async () => {
    spyOn(httpClient, "request").mockResolvedValue(
      new Response("body", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "x-response-metadata": "long-enough-to-cross-the-limit",
        },
      }),
    );

    const execution = await execute(
      "curl -i --max-filesize 32 https://example.com/headers-and-body",
    );

    expect(execution.result.exitCode).toBe(asExitCode(63));
    expect(byteLengthOf(execution.stdout)).toBeLessThanOrEqual(32);
    expect(textOf(execution.stderr)).toContain("response exceeds 32 bytes");
  });

  test.each([
    "curl --max-time 5.001 https://example.com",
    "curl --max-filesize 65537 https://example.com",
  ])("rejects a caller attempting to raise a hard cap: %s", async (source) => {
    const request = spyOn(httpClient, "request");
    const execution = await execute(source);

    expect(execution.result.exitCode).toBe(asExitCode(2));
    expect(textOf(execution.stderr)).toStartWith("bash: ");
    expect(request).not.toHaveBeenCalled();
  });

  test("stops before streaming a body whose declared length exceeds the cap", async () => {
    spyOn(httpClient, "request").mockResolvedValue(
      new Response("too large", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "content-length": "9",
        },
      }),
    );

    const execution = await execute(
      "curl --max-filesize 8 https://example.com/large",
    );

    expect(execution.result.exitCode).toBe(asExitCode(63));
    expect(execution.stdout).toEqual([]);
    expect(textOf(execution.stderr)).toBe("curl: response exceeds 8 bytes\n");
  });

  test("cancels the response reader when writing to stdout fails", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode("first chunk"));
      },
      cancel: () => {
        cancelled = true;
      },
    });
    spyOn(httpClient, "request").mockResolvedValue(
      new Response(body, {
        headers: { "content-type": "text/plain" },
      }),
    );
    const stderr: FileChunk[] = [];
    const io: ProcessIO = {
      stdin: createEofFileDescriptor(),
      stdout: createTerminalFileDescriptor("stdout", () => {
        throw new Error("stdout unavailable");
      }),
      stderr: createTerminalFileDescriptor("stderr", (_stream, value) => {
        stderr.push(value);
      }),
    };

    const result = await executeShell(
      "curl https://example.com/stream",
      io,
      shellState,
    ).completed;

    expect(result.exitCode).toBe(asExitCode(1));
    expect(cancelled).toBe(true);
    expect(textOf(stderr)).toContain("stdout unavailable");
  });
});
