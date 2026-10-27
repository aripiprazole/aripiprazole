import { describe, expect, test } from 'bun:test';

import {
	asciiRamp,
	atlasGlyphs,
	cellSize,
	coverTransform,
	edgeGlyphs,
	gridMetrics,
	textCells
} from './ascii-backdrop';

describe('ascii backdrop', () => {
	test('starts the ramp with an empty glyph', () => {
		expect(asciiRamp[0]).toBe(' ');
		expect(new Set(asciiRamp).size).toBe(asciiRamp.length);
	});

	test('puts the edge glyphs after the shading ramp in the atlas', () => {
		expect(atlasGlyphs.indexOf(edgeGlyphs)).toBe(asciiRamp.length);
		expect([...edgeGlyphs]).toEqual(['|', '-', '/', '\\']);
	});

	test('scales cells to device pixels', () => {
		expect(gridMetrics(800, 600, 2)).toEqual({
			ratio: 2,
			width: 1600,
			height: 1200,
			cellWidth: cellSize.width * 2,
			cellHeight: cellSize.height * 2,
			columns: Math.ceil(1600 / (cellSize.width * 2)),
			rows: Math.ceil(1200 / (cellSize.height * 2)),
			fontSize: cellSize.font * 2
		});
	});

	test('caps the device pixel ratio between 1 and 2', () => {
		expect(gridMetrics(100, 100, 3).width).toBe(200);
		expect(gridMetrics(100, 100, 0.5).width).toBe(100);
	});

	test('pads text boxes by a cell and clamps them to the grid', () => {
		const { width, height } = cellSize;
		const metrics = gridMetrics(width * 100, height * 10, 1);
		expect(
			textCells({ left: width * 10, top: height * 2, right: width * 20, bottom: height * 3 }, metrics)
		).toEqual([9, 2, 12, 1]);
		expect(textCells({ left: -20, top: -5, right: width * 200, bottom: height * 20 }, metrics)).toEqual([
			0, 0, metrics.columns, metrics.rows
		]);
		expect(textCells({ left: 10, top: height * 12, right: 50, bottom: height * 13 }, metrics)).toBeNull();
	});

	test('crops the height of a wide viewport', () => {
		const { scale, offset } = coverTransform(2000, 500, 16, 9, 0.5, 0.6);
		expect(scale[0]).toBe(1);
		expect(scale[1]).toBeCloseTo(0.444, 3);
		expect(offset[0]).toBe(0);
		expect(offset[1]).toBeCloseTo((1 - scale[1]) * 0.6, 6);
	});

	test('crops the width of a tall viewport around the focus', () => {
		const { scale, offset } = coverTransform(390, 844, 16, 9, 0.6);
		expect(scale[1]).toBe(1);
		expect(scale[0]).toBeCloseTo(390 / 844 / (16 / 9), 6);
		expect(offset[0]).toBeCloseTo((1 - scale[0]) * 0.6, 6);
		expect(offset[1]).toBe(0);
	});
});
