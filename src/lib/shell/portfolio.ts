import { z } from "zod";

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

const readme = `software engineer, amateur chess player, somewhat autistic and an inherently curious human being. i write fun code for work, and working code for fun, always pursuing new knowledgement. i deeply despise cowardness and complacentness and i'm fascinated by how our world works, and growing up with computers led me to believe the best way to understand it is through computer science and math, which evolved into a passion towards programming language theory, compilers and DSLs.
`;

const projects = [
  {
    name: "plank",
    title: "Plank",
    description:
      "A functional programming language with a focus on simplicity and ease of use. Plank is a statically typed language with a syntax similar to Kotlin, and a compiler written in Kotlin...",
    url: "https://github.com/aripiprazole/plank",
  },
  {
    name: "trazodone",
    title: "Trazodone",
    description:
      "A LLVM backend for HVM that runs just-in-time compilation, and abstract the codegen into multiple steps to be easy to generate LLVM, Rust, or any target, and has a built-in evaluator...",
    url: "https://github.com/aripiprazole/trazodone",
  },
  {
    name: "asena",
    title: "Asena",
    description:
      "Incremental/single-pass based compiler,the API can be either used for Single-Pass Compilingand for building LSP, orthings that would need incremental pipelines. Its a study project of mine for studying incremental compilers and package-managers...",
    url: "https://github.com/aripiprazole/asena",
  },
  {
    name: "lura",
    title: "Lura",
    description:
      "The Lura compiler is the continuation of Asena, it aims an incremental and query-based compiler with focus in a new tooling toolkit.",
    url: "https://lurasidone.vercel.app/",
  },
  {
    name: "andesite",
    title: "Andesite",
    description:
      "A library for Minecraft protocol development that makes easier to develop servers and stuff directly with the protocol, like a minecraft server with void, or even a proxy...",
    url: "https://github.com/aripiprazole/andesite",
  },
  {
    name: "bupropion",
    title: "Bupropion",
    description:
      "Bupropion is a library based on Miette error handling that provides a way to handle errors in a functional way, and it is very similar to Rust error handling and Ariadne too. It is a beautiful way to present your errors...",
    url: "https://crates.io/crates/bupropion",
  },
] as const;

const writing = [
  {
    name: "minecraft-protocol-in-kotlin",
    title: "Writing a Minecraft Protocol implementation in Kotlin",
    description:
      "A Minecraft Server/Protocol project is very cool to practice concurrency, and tooling stuff, which is very cool and useful nowadays...",
    url: "https://medium.com/@gabrielleeg1/writing-a-minecraft-protocol-implementation-in-kotlin-9276c584bd42",
  },
  {
    name: "defunctionalization",
    title: "Defunctionalization",
    description:
      "Defunctionalization is a way to transform higher-order functions in closures, that can be compiled in a lower level like LLVM, C, or even directly on Machine Code. For this task, we can use Closure...",
    url: "https://aripiprazole.medium.com/defunctionalization-5fd03b21813e",
  },
  {
    name: "rebasing-after-a-name-change",
    title: "Rebasing old commits for people who has changed their name",
    description:
      "Hello, my name is Gabrielle, and I’ve changed my name, so here I want to present some techniques to rebase your old commits into new ones with your new name...",
    url: "https://aripiprazole.medium.com/rebasing-old-commits-for-trans-people-3740d1bc1157",
  },
  {
    name: "equation-solver",
    title: "Writing an Equation Solver",
    description:
      "Writing an Equation Solver is a process that is made of: parsing, equating/unifying and rewriting.It is a powerful project that allows us to learn more about logic and functional programming.",
    url: "https://github.com/aripiprazole/eq",
  },
  {
    name: "higher-rank-polymorphism-in-rust",
    title:
      "Driving Complete and Easy Bidirectional Typechecking for Higher-Rank Polymorphism in Rust",
    description:
      "The main goal of this article is to make some comments about mb64 implementation of the Complete and Easy.. paper, but implementing it in pure rust code, and some optimizations, like de bruijin levels and indexes!",
    url: "https://dev.to/aripiprazole/driving-complete-and-easy-bidirectional-typechecking-for-higher-rank-polymorphism-in-rust-4856",
  },
  {
    name: "gadt-like-types-in-rust",
    title: "GADT-like types in Rust",
    description:
      "I think that GADTs are a very powerful feature of Haskell, and I would like tohave something similar in Rust. I think this is the closestthing to GADTs in Rust.",
    url: "https://dev.to/aripiprazole/gadt-like-types-in-rust-4hcp",
  },
  {
    name: "haskell-in-kotlin",
    title: "Writing Haskell in Kotlin",
    description:
      "Talks about implementing a Haskell-like interpreter in Kotlin. That comes from writing the parser, type system, context resolving to the interpreter. The goal of this article, is to show a short introduction to compilers... (STILL INCOMPLETE)",
    url: "https://github.com/aripiprazole/ekko/tree/main/docs",
  },
] as const;

const accounts = [
  { name: "aripiprazole", url: "https://github.com/aripiprazole" },
  { name: "atomoxetine", url: "https://github.com/atomoxetine" },
  { name: "oestradiol", url: "https://github.com/oestradiol" },
  { name: "perospirone", url: "https://github.com/perospirone" },
] as const;

const links = [
  { name: "linkedin", url: "https://www.linkedin.com/in/aripiprazole" },
  { name: "medium", url: "https://aripiprazole.medium.com/" },
  { name: "github", url: "https://github.com/aripiprazole" },
  { name: "gitlab", url: "https://gitlab.com/lurasidone" },
  { name: "instagram", url: "https://instagram.com/io.gabx" },
  { name: "twitter", url: "https://twitter.com/io_gabx" },
  {
    name: "wynncraft",
    url: "https://wynncraft.com/stats/player/Brexpiprazole",
  },
  { name: "aripiprazole", url: "https://en.wikipedia.org/wiki/Aripiprazole" },
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

const accountFiles = accounts.map((account) => ({
  kind: "file" as const,
  path: asAbsolutePath(`/app/accounts/${account.name}.txt`),
  content: `${account.name}\n${account.url}\n`,
  actions: [
    {
      label: "curl account URL",
      command: `curl ${account.url}`,
      behavior: "prefill" as const,
    },
  ],
  modifiedAt: seedModifiedAt,
}));

const linkFiles = links.map((link) => ({
  kind: "file" as const,
  path: asAbsolutePath(`/app/links/${link.name}.txt`),
  content: `${link.name}\n${link.url}\n`,
  actions: [
    {
      label: "curl link URL",
      command: `curl ${link.url}`,
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
      kind: "directory",
      path: asAbsolutePath("/app/accounts"),
      modifiedAt: seedModifiedAt,
    },
    {
      kind: "directory",
      path: asAbsolutePath("/app/links"),
      modifiedAt: seedModifiedAt,
    },
    {
      kind: "file",
      path: asAbsolutePath("/app/README.md"),
      content: readme,
      modifiedAt: seedModifiedAt,
    },
    {
      kind: "file",
      path: asAbsolutePath("/app/contact.txt"),
      content: "reach me out at you@gabx.io\n",
      actions: [
        {
          label: "show social links",
          command: "ls links",
          behavior: "execute",
        },
      ],
      modifiedAt: seedModifiedAt,
    },
    ...projectFiles,
    ...writingFiles,
    ...accountFiles,
    ...linkFiles,
  ]);
