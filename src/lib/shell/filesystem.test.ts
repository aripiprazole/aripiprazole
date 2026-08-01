import { describe, expect, test } from "bun:test";

import {
  createEofFileDescriptor,
  createMemoryFileDescriptor,
  createPipe,
  createTerminalFileDescriptor,
  filesystem,
  FileSystemErrorSchema,
} from "./filesystem";
import { asAbsolutePath, FileDescriptorErrorSchema } from "./schemas";
import type { FileChunk } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const chunk = (text: string): FileChunk => ({
  bytes: encoder.encode(text),
  actions: [],
});

const expectDescriptorError = async (
  promise: Promise<unknown>,
  kind: "closed" | "bad-file-descriptor" | "broken-pipe" | "aborted",
): Promise<void> => {
  try {
    await promise;
    expect.unreachable("expected the descriptor operation to throw");
  } catch (error: unknown) {
    const parsed = FileDescriptorErrorSchema.parse(error);
    expect(parsed.kind).toBe(kind);
  }
};

describe("local file descriptors", () => {
  test("EOF provides explicit empty stdin and throws plain typed errors", async () => {
    const descriptor = createEofFileDescriptor();

    expect(await descriptor.read()).toBeNull();
    await expectDescriptorError(
      descriptor.write(chunk("no")),
      "bad-file-descriptor",
    );

    await descriptor.close();
    await expectDescriptorError(descriptor.read(), "closed");
  });

  test("terminal descriptors validate and isolate received chunks", async () => {
    const received: FileChunk[] = [];
    const descriptor = createTerminalFileDescriptor(
      "stdout",
      (_stream, value) => received.push(value),
    );
    const bytes = encoder.encode("hello");

    await descriptor.write({
      bytes,
      actions: [
        {
          label: "list projects",
          command: "ls projects",
          behavior: "execute",
        },
      ],
    });
    bytes[0] = 0;

    expect(decoder.decode(received[0]?.bytes)).toBe("hello");
    expect(received[0]?.actions[0]?.command).toBe("ls projects");
    await expectDescriptorError(descriptor.read(), "bad-file-descriptor");
  });

  test("memory descriptors preserve chunks and enforce their access mode", async () => {
    const descriptor = createMemoryFileDescriptor([chunk("one"), chunk("two")]);

    expect(decoder.decode((await descriptor.read())?.bytes)).toBe("one");
    expect(decoder.decode((await descriptor.read())?.bytes)).toBe("two");
    expect(await descriptor.read()).toBeNull();
    await expectDescriptorError(
      descriptor.write(chunk("three")),
      "bad-file-descriptor",
    );
  });
});

describe("bounded pipe descriptors", () => {
  test("preserves actions and reports EOF after draining a closed writer", async () => {
    const pipe = createPipe(64);
    const actionChunk: FileChunk = {
      bytes: encoder.encode("projects/\n"),
      actions: [
        {
          label: "open projects",
          command: "cd projects",
          behavior: "execute",
        },
      ],
    };

    await pipe.writer.write(actionChunk);
    await pipe.writer.close();

    const output = await pipe.reader.read();
    expect(decoder.decode(output?.bytes)).toBe("projects/\n");
    expect(output?.actions).toEqual(actionChunk.actions);
    expect(await pipe.reader.read()).toBeNull();
  });

  test("applies backpressure and splits writes larger than capacity", async () => {
    const pipe = createPipe(3);
    let writeCompleted = false;
    const write = pipe.writer.write(chunk("abcdef")).then(() => {
      writeCompleted = true;
    });

    await Bun.sleep(0);
    expect(writeCompleted).toBe(false);
    expect(decoder.decode((await pipe.reader.read())?.bytes)).toBe("abc");

    await write;
    expect(writeCompleted).toBe(true);
    await pipe.writer.close();
    expect(decoder.decode((await pipe.reader.read())?.bytes)).toBe("def");
    expect(await pipe.reader.read()).toBeNull();
  });

  test("turns a closed reader into a broken pipe for the writer", async () => {
    const pipe = createPipe(8);
    await pipe.reader.close();

    await expectDescriptorError(
      pipe.writer.write(chunk("hello")),
      "broken-pipe",
    );
  });

  test("aborts blocked reads and writes", async () => {
    const readPipe = createPipe(8);
    const blockedRead = readPipe.reader.read();
    await readPipe.writer.abort("cancelled");
    await expectDescriptorError(blockedRead, "aborted");

    const writePipe = createPipe(1);
    const blockedWrite = writePipe.writer.write(chunk("two bytes"));
    await Bun.sleep(0);
    await writePipe.reader.abort("cancelled");
    await expectDescriptorError(blockedWrite, "aborted");
  });

  test("honors an operation AbortSignal without closing the pipe", async () => {
    const pipe = createPipe(16);
    const controller = new AbortController();
    const blockedRead = pipe.reader.read(controller.signal);

    controller.abort("stop waiting");
    await expectDescriptorError(blockedRead, "aborted");

    await pipe.writer.write(chunk("still usable"));
    expect(decoder.decode((await pipe.reader.read())?.bytes)).toBe(
      "still usable",
    );
  });
});

describe("virtual filesystem paths", () => {
  test("resolves relative paths, dot segments, and root traversal", () => {
    const cwd = asAbsolutePath("/app/projects");

    expect(
      filesystem.resolve(cwd, "../writings/./gadt-like-types-in-rust.txt"),
    ).toBe(asAbsolutePath("/app/writings/gadt-like-types-in-rust.txt"));
    expect(filesystem.resolve(cwd, "../../../../")).toBe(asAbsolutePath("/"));
  });

  test("rejects unavailable home paths and null bytes", () => {
    for (const path of [
      "~",
      "~/contact.txt",
      "~someone/file.txt",
      "bad\0path",
    ]) {
      try {
        filesystem.resolve(filesystem.initialDirectory, path);
        throw new Error("expected resolution to fail");
      } catch (error: unknown) {
        expect(FileSystemErrorSchema.safeParse(error).success).toBe(true);
      }
    }
  });
});

describe("virtual portfolio tree", () => {
  test("lists directory entries in deterministic order", async () => {
    const entries = await filesystem.readDirectory(
      filesystem.initialDirectory,
      ".",
    );

    expect(entries.map((entry) => entry.name)).toEqual([
      "readme.md",
      "accounts",
      "contact.txt",
      "links.md",
      "profile.png",
      "projects",
      "writings",
    ]);
    expect(entries.every((entry) => !("mode" in entry))).toBe(true);
  });

  test("reports missing paths and non-directory reads as typed objects", async () => {
    for (const operation of [
      filesystem.stat(filesystem.initialDirectory, "missing.txt"),
      filesystem.readDirectory(filesystem.initialDirectory, "readme.md"),
    ]) {
      try {
        await operation;
        throw new Error("expected filesystem operation to fail");
      } catch (error: unknown) {
        expect(FileSystemErrorSchema.safeParse(error).success).toBe(true);
      }
    }
  });

  test("opens README as a read-only descriptor", async () => {
    const descriptor = await filesystem.open(
      filesystem.initialDirectory,
      "README.md",
    );
    const chunk = await descriptor.read();

    expect(chunk).not.toBeNull();
    expect(decoder.decode(chunk?.bytes)).toContain(
      "software engineer, amateur chess player",
    );
    expect(chunk?.actions).toEqual([]);
    expect(await descriptor.read()).toBeNull();
    await expect(
      descriptor.write({ bytes: new Uint8Array(), actions: [] }),
    ).rejects.toMatchObject({ kind: "bad-file-descriptor" });
  });

  test("preserves every portfolio collection and exposes the PNG asset", async () => {
    const collectionSizes = await Promise.all(
      ["projects", "writings", "accounts"].map(
        async (path) =>
          (await filesystem.readDirectory(filesystem.initialDirectory, path))
            .length,
      ),
    );

    expect(collectionSizes).toEqual([6, 7, 4]);
    expect(
      await filesystem.readPngAsset(filesystem.initialDirectory, "profile.png"),
    ).toEqual({
      kind: "png",
      src: "/profile.png",
      alt: "Pixel-art portrait of Gabrielle",
    });
  });
});
