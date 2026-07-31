const escapeHtml = (value: string): string =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

const safeLink = (value: string): string | null => {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'mailto:'
			? url.toString()
			: null;
	} catch {
		return null;
	}
};

const renderInline = (source: string): string => {
	const link = /\[([^\]]+)\]\(([^)\s]+)\)/gu;
	let html = '';
	let offset = 0;

	for (const match of source.matchAll(link)) {
		const index = match.index;
		const label = match[1];
		const target = match[2];
		if (index === undefined || label === undefined || target === undefined) continue;

		html += escapeHtml(source.slice(offset, index));
		const href = safeLink(target);
		html +=
			href === null
				? escapeHtml(label)
				: `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`;
		offset = index + match[0].length;
	}

	return html + escapeHtml(source.slice(offset));
};

export const renderMarkdown = (markdown: string): string => {
	const lines = markdown.replaceAll('\r\n', '\n').split('\n');
	const blocks: string[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index]?.trim() ?? '';
		if (line.length === 0) {
			index += 1;
			continue;
		}

		const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
		if (heading !== null) {
			const level = heading[1]?.length ?? 1;
			blocks.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`);
			index += 1;
			continue;
		}

		if (line.startsWith('- ')) {
			const items: string[] = [];
			while (index < lines.length) {
				const item = lines[index]?.trim() ?? '';
				if (!item.startsWith('- ')) break;
				items.push(`<li>${renderInline(item.slice(2))}</li>`);
				index += 1;
			}
			blocks.push(`<ul>${items.join('')}</ul>`);
			continue;
		}

		const paragraph: string[] = [];
		while (index < lines.length) {
			const next = lines[index]?.trim() ?? '';
			if (next.length === 0 || next.startsWith('- ') || /^#{1,3}\s/u.test(next)) {
				break;
			}
			paragraph.push(next);
			index += 1;
		}
		blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
	}

	return blocks.join('');
};
