import { z } from "zod";

import readmeMarkdown from "../../../assets/readme.md?raw";
import linksMarkdown from "../../../assets/links.md?raw";
import worksMarkdown from "../../../assets/works.md?raw";

import {
  AbsolutePathSchema,
  CommandActionSchema,
  asAbsolutePath,
} from "./schemas";

const seedModifiedAt = "2026-07-31T00:00:00.000Z";

export const portfolioRoot = asAbsolutePath("/app");

export const PortfolioDirectorySeedSchema = z
  .object({
    kind: z.literal("directory"),
    path: AbsolutePathSchema,
    modifiedAt: z.iso.datetime(),
  })
  .strict();

export const PortfolioFileSeedSchema = z
  .object({
    kind: z.literal("file"),
    path: AbsolutePathSchema,
    content: z.string(),
    actions: z.array(CommandActionSchema).max(16).default([]),
    asset: z
      .object({
        kind: z.literal("png"),
        src: z.string().startsWith("/").max(2_048),
        alt: z.string().max(240),
      })
      .strict()
      .optional(),
    modifiedAt: z.iso.datetime(),
  })
  .strict();

export const PortfolioSeedEntrySchema = z.discriminatedUnion("kind", [
  PortfolioDirectorySeedSchema,
  PortfolioFileSeedSchema,
]);

export const PortfolioSeedSchema = z.array(PortfolioSeedEntrySchema).min(1);

export type PortfolioDirectorySeed = z.infer<
  typeof PortfolioDirectorySeedSchema
>;
export type PortfolioFileSeed = z.infer<typeof PortfolioFileSeedSchema>;
export type PortfolioSeedEntry = z.infer<typeof PortfolioSeedEntrySchema>;

const projects = [
  {
    name: "plank",
    title: "plank",
    description: "functional programming language",
    url: "https://github.com/aripiprazole/plank",
  },
  {
    name: "trazodone",
    title: "trazodone",
    description: "llvm just in time compiler for hvm",
    url: "https://github.com/aripiprazole/trazodone",
  },
  {
    name: "asena",
    title: "asena",
    description: "incremental compiler",
    url: "https://github.com/aripiprazole/asena",
  },

  {
    name: "andesite",
    title: "andesite",
    description: "minecraft protocol",
    url: "https://github.com/aripiprazole/andesite",
  },
  {
    name: "bupropion",
    title: "bupropion",
    description: "opinionated frontend for miette",
    url: "https://crates.io/crates/bupropion",
  },
  {
    name: "zed unicode",
    title: "zed unicode",
    description: "zed unicode",
    url: "https://zed.dev/extensions/unicode",
  },
] as const;

const writing = [
  {
    name: "minecraft-protocol-in-kotlin",
    title: "writing a minecraft protocol server implementation in kotlin",
    description: "minecraft server protocol in kotlin with coroutines",
    url: "https://medium.com/@gabrielleeg1/writing-a-minecraft-protocol-implementation-in-kotlin-9276c584bd42",
  },
  {
    name: "defunctionalization",
    title: "defunctionalization",
    description:
      "transforming closures into top level functions using closure conversion algorithm",
    url: "https://aripiprazole.medium.com/defunctionalization-5fd03b21813e",
  },
  {
    name: "equation-solver",
    title: "writing an equation solver",
    description:
      "writing a basic equation solver using basic first-order logic",
    url: "https://github.com/aripiprazole/eq",
  },
  {
    name: "higher-rank-polymorphism-in-rust",
    title: "writing a bidirectional type system in rust",
    description: "mutable implementation of bidirectional type system",
    url: "https://dev.to/aripiprazole/driving-complete-and-easy-bidirectional-typechecking-for-higher-rank-polymorphism-in-rust-4856",
  },
  {
    name: "gadt-like-types-in-rust",
    title: "gadt-like types in Rust",
    description: "gadts are useful, and gats are too, why not combine both?",
    url: "https://dev.to/aripiprazole/gadt-like-types-in-rust-4hcp",
  },
] as const;

const projectFiles = projects.map((project) => ({
  kind: "file" as const,
  path: asAbsolutePath(`/app/projects/${project.name}.txt`),
  content: `${project.title}\n\n${project.description}\n\n${project.url}\n`,
  actions: [
    {
      label: "curl project URL",
      command: `curl ${project.url}`,
      behavior: "prefill" as const,
    },
  ],
  modifiedAt: seedModifiedAt,
}));

const writingFiles = writing.map((article) => ({
  kind: "file" as const,
  path: asAbsolutePath(`/app/writing/${article.name}.txt`),
  content: `${article.title}\n\n${article.description}\n\n${article.url}\n`,
  actions: [
    {
      label: "curl article URL",
      command: `curl ${article.url}`,
      behavior: "prefill" as const,
    },
  ],
  modifiedAt: seedModifiedAt,
}));

export const portfolioSeed: readonly PortfolioSeedEntry[] =
  PortfolioSeedSchema.parse([
    {
      kind: "directory",
      path: asAbsolutePath("/"),
      modifiedAt: seedModifiedAt,
    },
    { kind: "directory", path: portfolioRoot, modifiedAt: seedModifiedAt },
    {
      kind: "directory",
      path: asAbsolutePath("/app/projects"),
      modifiedAt: seedModifiedAt,
    },
    {
      kind: "directory",
      path: asAbsolutePath("/app/writing"),
      modifiedAt: seedModifiedAt,
    },
    {
      kind: "file",
      path: asAbsolutePath("/app/readme.md"),
      content: readmeMarkdown,
      modifiedAt: seedModifiedAt,
    },
    {
      kind: "file",
      path: asAbsolutePath("/app/works.md"),
      content: worksMarkdown,
      modifiedAt: seedModifiedAt,
    },
    {
      kind: "file",
      path: asAbsolutePath("/app/links.md"),
      content: linksMarkdown,
      modifiedAt: seedModifiedAt,
    },
    {
      kind: "file",
      path: asAbsolutePath("/app/profile.png"),
      content: "",
      asset: {
        kind: "png",
        src: "/profile.png",
        alt: "pixelart portrait of gabi",
      },
      modifiedAt: seedModifiedAt,
    },
    ...projectFiles,
    ...writingFiles,
  ]);
