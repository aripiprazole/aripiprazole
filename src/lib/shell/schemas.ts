import { z } from 'zod';

import type {
	AbsolutePath,
	CommandAction,
	ExitCode,
	FileChunk,
	FileDescriptorError,
	Pid
} from './types';

export const AbsolutePathSchema = z
	.string()
	.min(1)
	.max(4_096)
	.refine((path) => path.startsWith('/'), 'Expected an absolute path')
	.transform((path): AbsolutePath => path as AbsolutePath);

export const PidSchema = z
	.number()
	.int()
	.positive()
	.transform((pid): Pid => pid as Pid);

export const ExitCodeSchema = z
	.number()
	.int()
	.min(0)
	.max(255)
	.transform((exitCode): ExitCode => exitCode as ExitCode);

export const CommandActionSchema = z
	.object({
		label: z.string().trim().min(1).max(120),
		command: z.string().min(1).max(4_096),
		behavior: z.enum(['execute', 'prefill']).default('execute')
	})
	.strict();

export const FilePresentationSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('html'),
			html: z.string().max(131_072)
		})
		.strict(),
	z
		.object({
			kind: z.literal('image'),
			src: z.string().startsWith('/').max(2_048),
			alt: z.string().max(240),
			borderRadius: z.number().int().min(0).max(512)
		})
		.strict()
]);

export const FileChunkSchema = z
	.object({
		bytes: z.instanceof(Uint8Array),
		actions: z.array(CommandActionSchema).max(16).default([]),
		presentation: FilePresentationSchema.optional()
	})
	.strict();

export const FileDescriptorErrorSchema = z
	.object({
		kind: z.enum([
			'closed',
			'bad-file-descriptor',
			'broken-pipe',
			'aborted'
		]),
		operation: z.enum(['read', 'write', 'close']),
		message: z.string().min(1),
		reason: z.unknown().optional()
	})
	.strict();

export const CommandStageSchema = z
	.object({
		argv: z.array(z.string().max(2_048)).min(1).max(64)
	})
	.strict();

export const PipelineSchema = z
	.object({
		stages: z.array(CommandStageSchema).min(1).max(8)
	})
	.strict();

export type CommandStage = z.output<typeof CommandStageSchema>;
export type Pipeline = z.output<typeof PipelineSchema>;

export const asAbsolutePath = (path: string): AbsolutePath =>
	AbsolutePathSchema.parse(path);

export const asPid = (pid: number): Pid => PidSchema.parse(pid);

export const asExitCode = (exitCode: number): ExitCode =>
	ExitCodeSchema.parse(exitCode);

export const createFileDescriptorError = (
	error: FileDescriptorError
): FileDescriptorError => FileDescriptorErrorSchema.parse(error);

export const isFileDescriptorError = (
	error: unknown
): error is FileDescriptorError => FileDescriptorErrorSchema.safeParse(error).success;

export const parseCommandAction = (action: unknown): CommandAction =>
	CommandActionSchema.parse(action);

export const parseFileChunk = (chunk: unknown): FileChunk =>
	FileChunkSchema.parse(chunk);
