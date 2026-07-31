<script lang="ts">
	import { analyzeShellInput } from '$lib/shell/input';

	let {
		source,
		className = ''
	}: {
		source: string;
		className?: string;
	} = $props();

	const tokens = $derived(analyzeShellInput(source));
</script>

<span class={className}>{#each tokens as token (`${token.start}:${token.end}:${token.kind}`)}<span class={`syntax-${token.kind}`}>{token.text}</span>{/each}</span>
