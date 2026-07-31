import type { PanelMode } from './panel-layout';

export type TerminalShortcutAction = 'interrupt' | 'clear' | 'finish';

type TerminalShortcutInput = Readonly<{
	key: string;
	ctrlKey: boolean;
	repeat: boolean;
	copying: boolean;
	mode: PanelMode;
	canClose: boolean;
}>;

export const terminalShortcutAction = ({
	key,
	ctrlKey,
	repeat,
	copying,
	mode,
	canClose
}: TerminalShortcutInput): TerminalShortcutAction | null => {
	if (!ctrlKey) return null;

	switch (key.toLowerCase()) {
		case 'c':
			if (copying || repeat) return null;
			if (mode === 'output-only') return canClose ? 'finish' : null;
			return 'interrupt';
		case 'l':
			return mode === 'interactive' ? 'clear' : null;
		default:
			return null;
	}
};
