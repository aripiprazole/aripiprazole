// Glyphs ordered from empty to densest ink, sampled by how dark the image is.
export const asciiRamp = ' .\':-+=itoxs%S8X@';

// Contours drawn over the shading, by the direction the edge runs.
export const edgeGlyphs = '|-/\\';

export const atlasGlyphs = asciiRamp + edgeGlyphs;

export const cellSize = Object.freeze({ width: 6, height: 11, font: 10 });

export type GridMetrics = Readonly<{
	ratio: number;
	width: number;
	height: number;
	cellWidth: number;
	cellHeight: number;
	columns: number;
	rows: number;
	fontSize: number;
}>;

export type CoverTransform = Readonly<{
	scale: readonly [number, number];
	offset: readonly [number, number];
}>;

export type CellRect = readonly [x: number, y: number, width: number, height: number];

export const gridMetrics = (
	cssWidth: number,
	cssHeight: number,
	devicePixelRatio: number
): GridMetrics => {
	const ratio = Math.min(Math.max(devicePixelRatio, 1), 2);
	const width = Math.max(1, Math.round(cssWidth * ratio));
	const height = Math.max(1, Math.round(cssHeight * ratio));
	const cellWidth = Math.max(1, Math.round(cellSize.width * ratio));
	const cellHeight = Math.max(1, Math.round(cellSize.height * ratio));
	return {
		ratio,
		width,
		height,
		cellWidth,
		cellHeight,
		columns: Math.ceil(width / cellWidth),
		rows: Math.ceil(height / cellHeight),
		fontSize: cellSize.font * ratio
	};
};

// Maps screen uv into image uv so the image covers the viewport, cropping
// around the focus point instead of the center.
export const coverTransform = (
	viewWidth: number,
	viewHeight: number,
	imageWidth: number,
	imageHeight: number,
	focusX = 0.5,
	focusY = 0.5
): CoverTransform => {
	const view = viewWidth / viewHeight;
	const image = imageWidth / imageHeight;
	if (view > image) {
		const scaleY = image / view;
		return { scale: [1, scaleY], offset: [0, (1 - scaleY) * focusY] };
	}
	const scaleX = view / image;
	return { scale: [scaleX, 1], offset: [(1 - scaleX) * focusX, 0] };
};

// Grid cells covered by a text box given in css pixels, padded by a cell on
// each side so the art keeps a little air around the words.
export const textCells = (
	rect: Readonly<{ left: number; top: number; right: number; bottom: number }>,
	metrics: GridMetrics
): CellRect | null => {
	const left = Math.max(0, Math.floor((rect.left * metrics.ratio) / metrics.cellWidth) - 1);
	const top = Math.max(0, Math.floor((rect.top * metrics.ratio) / metrics.cellHeight));
	const right = Math.min(metrics.columns, Math.ceil((rect.right * metrics.ratio) / metrics.cellWidth) + 1);
	const bottom = Math.min(metrics.rows, Math.ceil((rect.bottom * metrics.ratio) / metrics.cellHeight));
	if (right <= left || bottom <= top) return null;
	return [left, top, right - left, bottom - top];
};

export const vertexShader = `
attribute vec2 position;

void main() {
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const fragmentShader = `
precision highp float;

uniform sampler2D image;
uniform sampler2D atlas;
uniform sampler2D text;
uniform vec2 resolution;
uniform vec2 cell;
uniform vec2 grid;
uniform float glyphs;
uniform float levels;
uniform vec4 cover;
uniform float time;
uniform float reveal;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
		mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}

float lightAt(vec2 uv) {
	return dot(texture2D(image, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
}

float textAt(vec2 index) {
	return texture2D(text, (index + 0.5) / grid).a;
}

void main() {
	vec2 pixel = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y);
	vec2 index = floor(pixel / cell);
	vec2 local = (pixel - index * cell) / cell;
	vec2 screen = (index + 0.5) * cell / resolution;
	vec2 uv = screen * cover.xy + cover.zw;

	// Leaves sway in the wind: the canopy sits on the upper part of the image.
	float canopy = smoothstep(0.7, 0.1, uv.y);
	vec2 wind = vec2(
		noise(uv * 7.0 + vec2(time * 0.35, 0.0)),
		noise(uv * 7.0 + vec2(13.0, time * 0.28))
	) - 0.5;
	uv += wind * 0.014 * canopy;

	float light = lightAt(uv);

	// Slow sunbeams drifting diagonally through the trees.
	float beam = noise(vec2((uv.x - uv.y * 0.55) * 5.0 + time * 0.05, time * 0.03));
	light += smoothstep(0.55, 0.95, beam) * 0.12;

	// Outline shapes where the light changes sharply, so light things like a
	// white cloak still show up on the paper.
	vec2 span = cell / resolution * cover.xy;
	float tl = lightAt(uv - span);
	float tr = lightAt(uv + vec2(span.x, -span.y));
	float bl = lightAt(uv + vec2(-span.x, span.y));
	float br = lightAt(uv + span);
	float gx = tr + br - tl - bl + 2.0 * (lightAt(uv + vec2(span.x, 0.0)) - lightAt(uv - vec2(span.x, 0.0)));
	float gy = bl + br - tl - tr + 2.0 * (lightAt(uv + vec2(0.0, span.y)) - lightAt(uv - vec2(0.0, span.y)));
	float edge = step(1.9, length(vec2(gx, gy)));
	float direction = abs(gx) > abs(gy) * 2.414 ? 0.0
		: abs(gy) > abs(gx) * 2.414 ? 1.0
		: gx * gy > 0.0 ? 2.0
		: 3.0;

	// Shade like ink on paper: shadows get dense glyphs, light gets dots.
	float tone = smoothstep(0.05, 0.95, 1.0 - light);
	tone = clamp(tone + (noise(index * 0.4 + time * 0.9) - 0.5) * 0.06, 0.0, 1.0);

	// Fade into the paper towards the edges, mostly at the top.
	float fade = smoothstep(0.0, 0.1, screen.x) * smoothstep(1.0, 0.9, screen.x);
	fade *= mix(0.3, 1.0, smoothstep(0.0, 0.3, screen.y));
	fade *= smoothstep(1.0, 0.95, screen.y);

	float seed = hash(index);
	fade *= clamp(reveal * 1.6 - seed * 0.6 - screen.y * 0.4, 0.0, 1.0);
	// Where it fades, cells dissolve one by one instead of all at once.
	if (seed > fade * 1.6) fade = 0.0;

	// Dim the scene behind text, without cutting it out, so the page stays readable.
	float words = textAt(index) * 0.4
		+ (textAt(index + vec2(1.0, 0.0)) + textAt(index - vec2(1.0, 0.0))) * 0.15
		+ (textAt(index + vec2(0.0, 1.0)) + textAt(index - vec2(0.0, 1.0))) * 0.15;
	float presence = fade * (1.0 - words * 0.8);

	float level = tone * mix(0.6, 1.0, fade);
	float glyph = mix(floor(level * (levels - 1.0) + 0.5), levels + direction, edge);
	float coverage = texture2D(atlas, vec2((glyph + local.x) / glyphs, local.y)).a;

	// Black and white: darker spots get darker ink.
	vec3 ink = vec3(mix(mix(0.45, 0.06, tone), 0.12, edge));
	float alpha = coverage * mix(mix(0.5, 0.9, tone), 0.95, edge) * presence;

	// A grey ink wash behind every cell shades the mid tones, so white things
	// like the cloak stand out from the path around them.
	float washAlpha = 0.3 * smoothstep(0.02, 0.6, 1.0 - light) * presence;
	vec4 wash = vec4(0.0, 0.0, 0.0, washAlpha);

	// Deep shadows turn into solid blocks with the glyph cut out, and a few
	// darker cells flicker into one now and then.
	float flicker = step(0.6, tone) * step(0.96, hash(index + floor(time * 0.6 + seed * 4.0)));
	float solid = max(step(0.9, level), flicker) * (1.0 - edge);
	vec2 inset = step(vec2(0.04), local) * step(local, vec2(0.96));
	alpha = mix(alpha, (1.0 - coverage) * 0.5 * presence, solid * inset.x * inset.y);

	gl_FragColor = vec4(ink * alpha, alpha) + wash * (1.0 - alpha);
}
`;
