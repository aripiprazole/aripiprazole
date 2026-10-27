<script lang="ts">
	import '../app.css';
	import AsciiBackdrop from '$lib/AsciiBackdrop.svelte';

	let { children } = $props();
</script>

<AsciiBackdrop />
{@render children()}
