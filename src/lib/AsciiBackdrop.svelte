<script lang="ts">
	import { onMount } from 'svelte';

	import {
		asciiRamp,
		coverTransform,
		fragmentShader,
		gridMetrics,
		textCells,
		vertexShader,
		type GridMetrics
	} from '$lib/ascii-backdrop';

	type Renderer = Readonly<{
		resize: () => void;
		paintText: () => void;
		draw: (now: number) => void;
	}>;

	const imageSource = '/backdrop.webp';
	const imageSize = { width: 512, height: 288 };
	// Keep the bridge and the travelers in view when the viewport crops the image.
	const focus = { x: 0.62, y: 0.6 };
	const frameInterval = 1000 / 30;
	const revealDuration = 2800;

	let canvas = $state<HTMLCanvasElement>();

	const context2d = (target: HTMLCanvasElement): CanvasRenderingContext2D => {
		const context = target.getContext('2d');
		if (context === null) throw new Error('2d context unavailable');
		return context;
	};

	const loadImage = async (): Promise<HTMLCanvasElement> => {
		const image = new Image();
		image.src = imageSource;
		await image.decode();
		const scaled = document.createElement('canvas');
		scaled.width = imageSize.width;
		scaled.height = imageSize.height;
		const context = context2d(scaled);
		context.imageSmoothingQuality = 'high';
		context.drawImage(image, 0, 0, scaled.width, scaled.height);
		return scaled;
	};

	const drawAtlas = (metrics: GridMetrics): HTMLCanvasElement => {
		const atlas = document.createElement('canvas');
		atlas.width = metrics.cellWidth * asciiRamp.length;
		atlas.height = metrics.cellHeight;
		const context = context2d(atlas);
		context.font = `500 ${metrics.fontSize}px "JetBrains Mono", monospace`;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillStyle = '#fff';
		[...asciiRamp].forEach((glyph, index) => {
			context.fillText(glyph, (index + 0.5) * metrics.cellWidth, metrics.cellHeight / 2);
		});
		return atlas;
	};

	const compile = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader => {
		const shader = gl.createShader(type);
		if (shader === null) throw new Error('shader unavailable');
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed to compile');
		}
		return shader;
	};

	const createTexture = (gl: WebGLRenderingContext, unit: number, filter: number): void => {
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	};

	const upload = (gl: WebGLRenderingContext, unit: number, source: TexImageSource): void => {
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
	};

	const createRenderer = (
		gl: WebGLRenderingContext,
		target: HTMLCanvasElement,
		image: HTMLCanvasElement,
		started: number,
		reducedMotion: boolean
	): Renderer => {
		const program = gl.createProgram();
		gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
		gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(gl.getProgramInfoLog(program) ?? 'program failed to link');
		}
		gl.useProgram(program);

		gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(program, 'position');
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		const uniform = (name: string) => gl.getUniformLocation(program, name);
		createTexture(gl, 0, gl.LINEAR);
		upload(gl, 0, image);
		createTexture(gl, 1, gl.NEAREST);
		createTexture(gl, 2, gl.NEAREST);
		gl.uniform1i(uniform('image'), 0);
		gl.uniform1i(uniform('atlas'), 1);
		gl.uniform1i(uniform('text'), 2);
		gl.uniform1f(uniform('glyphs'), asciiRamp.length);

		// Line boxes of every text node on the page, one texel per grid cell.
		const textMask = document.createElement('canvas');
		const textContext = context2d(textMask);
		const range = document.createRange();
		const time = uniform('time');
		const reveal = uniform('reveal');
		let metrics = gridMetrics(target.clientWidth, target.clientHeight, devicePixelRatio);

		return {
			resize: () => {
				metrics = gridMetrics(target.clientWidth, target.clientHeight, devicePixelRatio);
				target.width = metrics.width;
				target.height = metrics.height;
				textMask.width = metrics.columns;
				textMask.height = metrics.rows;
				gl.viewport(0, 0, metrics.width, metrics.height);
				upload(gl, 1, drawAtlas(metrics));
				const { scale, offset } = coverTransform(
					metrics.width,
					metrics.height,
					imageSize.width,
					imageSize.height,
					focus.x,
					focus.y
				);
				gl.uniform2f(uniform('resolution'), metrics.width, metrics.height);
				gl.uniform2f(uniform('cell'), metrics.cellWidth, metrics.cellHeight);
				gl.uniform2f(uniform('grid'), metrics.columns, metrics.rows);
				gl.uniform4f(uniform('cover'), scale[0], scale[1], offset[0], offset[1]);
			},
			paintText: () => {
				textContext.clearRect(0, 0, textMask.width, textMask.height);
				textContext.fillStyle = '#fff';
				const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
				for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
					if (node.nodeValue?.trim() === '') continue;
					range.selectNodeContents(node);
					for (const rect of range.getClientRects()) {
						const cells = textCells(rect, metrics);
						if (cells !== null) textContext.fillRect(...cells);
					}
				}
				upload(gl, 2, textMask);
			},
			draw: (now) => {
				const elapsed = now - started;
				const progress = reducedMotion ? 1 : Math.min(elapsed / revealDuration, 1);
				gl.uniform1f(time, reducedMotion ? 0 : (elapsed / 1000) % 3600);
				gl.uniform1f(reveal, 1 - (1 - progress) ** 3);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
		};
	};

	onMount(() => {
		const target = canvas;
		const gl = target?.getContext('webgl', { antialias: false, premultipliedAlpha: true });
		if (target === undefined || gl === null || gl === undefined) return;

		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const started = performance.now();
		const image = loadImage();
		const font = document.fonts.load('500 11px "JetBrains Mono"').catch(() => []);
		let renderer: Renderer | null = null;
		let disposed = false;
		let textDirty = true;
		let frame = 0;
		let last = -Infinity;

		const schedule = () => {
			if (frame === 0) frame = requestAnimationFrame(render);
		};

		const render = (now: number) => {
			frame = 0;
			if (renderer === null) return;
			if (!reducedMotion) {
				schedule();
				if (now - last < frameInterval) return;
			}
			last = now;
			if (textDirty) {
				textDirty = false;
				renderer.paintText();
			}
			renderer.draw(now);
		};

		const invalidate = () => {
			textDirty = true;
			schedule();
		};

		const resize = () => {
			renderer?.resize();
			last = -Infinity;
			invalidate();
		};

		const start = () => {
			Promise.all([image, font])
				.then(([scaled]) => {
					if (disposed || gl.isContextLost()) return;
					renderer = createRenderer(gl, target, scaled, started, reducedMotion);
					resize();
				})
				.catch((error: unknown) => console.warn('ascii backdrop disabled:', error));
		};

		const contextLost = (event: Event) => {
			event.preventDefault();
			cancelAnimationFrame(frame);
			frame = 0;
			renderer = null;
		};

		const sizes = new ResizeObserver(resize);
		sizes.observe(target);
		const mutations = new MutationObserver(invalidate);
		mutations.observe(document.body, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true
		});
		target.addEventListener('webglcontextlost', contextLost);
		target.addEventListener('webglcontextrestored', start);
		document.addEventListener('scroll', invalidate, { capture: true, passive: true });
		document.fonts.addEventListener('loadingdone', invalidate);
		start();

		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			sizes.disconnect();
			mutations.disconnect();
			target.removeEventListener('webglcontextlost', contextLost);
			target.removeEventListener('webglcontextrestored', start);
			document.removeEventListener('scroll', invalidate, { capture: true });
			document.fonts.removeEventListener('loadingdone', invalidate);
		};
	});
</script>

<canvas class="ascii-backdrop" bind:this={canvas} aria-hidden="true"></canvas>
