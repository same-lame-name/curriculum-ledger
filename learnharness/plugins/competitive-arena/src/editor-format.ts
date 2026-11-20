const SUPERSCRIPTS: Record<string, string> = {
	"0": "⁰",
	"1": "¹",
	"2": "²",
	"3": "³",
	"4": "⁴",
	"5": "⁵",
	"6": "⁶",
	"7": "⁷",
	"8": "⁸",
	"9": "⁹",
	"+": "⁺",
	"-": "⁻",
	n: "ⁿ",
	i: "ⁱ",
	k: "ᵏ",
};

const SUBSCRIPTS: Record<string, string> = {
	"0": "₀",
	"1": "₁",
	"2": "₂",
	"3": "₃",
	"4": "₄",
	"5": "₅",
	"6": "₆",
	"7": "₇",
	"8": "₈",
	"9": "₉",
	a: "ₐ",
	e: "ₑ",
	i: "ᵢ",
	j: "ⱼ",
	k: "ₖ",
	n: "ₙ",
	m: "ₘ",
	x: "ₓ",
};

function mapChars(raw: string, table: Record<string, string>): string | null {
	let out = "";
	for (const ch of raw) {
		const mapped = table[ch];
		if (!mapped) return null;
		out += mapped;
	}
	return out;
}

function replaceLatexCommands(raw: string): string {
	let s = raw;
	// Repeatedly simplify simple \frac{a}{b}, \sqrt{x}, \text{x}, etc.
	s = s
		.replace(/\\(?:text|textrm|textsf|texttt|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, "$1")
		.replace(/\\pmod\{([^{}]*)\}/g, "(mod $1)")
		.replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
		.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");

	const replacements: Array<[RegExp, string]> = [
		[/\\leq?/g, "≤"],
		[/\\geq?/g, "≥"],
		[/\\neq?/g, "≠"],
		[/\\approx/g, "≈"],
		[/\\equiv/g, "≡"],
		[/\\times/g, "×"],
		[/\\cdot/g, "·"],
		[/\\pm/g, "±"],
		[/\\infty/g, "∞"],
		[/\\sum/g, "∑"],
		[/\\prod/g, "∏"],
		[/\\notin/g, "∉"],
		[/\\in(?![a-zA-Z])/g, "∈"],
		[/\\subseteq/g, "⊆"],
		[/\\subset/g, "⊂"],
		[/\\cup/g, "∪"],
		[/\\cap/g, "∩"],
		[/\\land/g, "∧"],
		[/\\lor/g, "∨"],
		[/\\neg/g, "¬"],
		[/\\Leftrightarrow/g, "⇔"],
		[/\\Rightarrow/g, "⇒"],
		[/\\(?:to|rightarrow)/g, "→"],
		[/\\leftarrow/g, "←"],
		[/\\(?:dots|ldots|cdots)/g, "..."],
		[/\\bmod/g, "mod"],
		[/\\lfloor/g, "⌊"],
		[/\\rfloor/g, "⌋"],
		[/\\lceil/g, "⌈"],
		[/\\rceil/g, "⌉"],
		[/\\langle/g, "⟨"],
		[/\\rangle/g, "⟩"],
		[/\\(?:left|right)([()\[\]|])/g, "$1"],
		[/\\,/g, " "],
		[/\\;/g, " "],
		[/\\quad/g, " "],
	];
	for (const [re, sym] of replacements) {
		s = s.replace(re, sym);
	}

	// Superscripts: ^{18} -> ¹⁸, ^9 -> ⁹, ^{k+1} -> ^(k+1)
	s = s.replace(/\^\{([^{}]+)\}/g, (_m, exp: string) => mapChars(exp.trim(), SUPERSCRIPTS) ?? `^(${exp.trim()})`);
	s = s.replace(/\^([0-9nik])(?![0-9a-zA-Z])/g, (_m, ch: string) => SUPERSCRIPTS[ch] ?? `^${ch}`);

	// Subscripts: _{i} -> ᵢ, a_{i+1} -> a_(i+1)
	s = s.replace(/([a-zA-Z0-9)_])_\{([^{}]+)\}/g, (_m, base: string, sub: string) => {
		const mapped = mapChars(sub.trim(), SUBSCRIPTS);
		return mapped ? `${base}${mapped}` : `${base}_(${sub.trim()})`;
	});
	s = s.replace(/([a-zA-Z0-9)_])_([0-9aeijkmnx])(?![0-9a-zA-Z])/g, (_m, base: string, ch: string) => {
		return `${base}${SUBSCRIPTS[ch] ?? `_${ch}`}`;
	});

	return s;
}

/**
 * Converts LaTeX/Markdown-heavy text into clean plain UTF-8 Unicode prose safe
 * for plain-text terminal buffers (Neovim floating card) without `$...$` or `**`.
 */
export function sanitizeEditorText(input: string): string {
	if (!input) return "";
	let s = input.replace(/\r\n/g, "\n");

	// Unwrap display and inline math delimiters before global cleanup.
	s = s
		.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner: string) => replaceLatexCommands(inner.trim()))
		.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => replaceLatexCommands(inner.trim()))
		.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner: string) => replaceLatexCommands(inner.trim()))
		.replace(/\$([^\n$]+?)\$/g, (full, inner: string) => {
			// Preserve literal dollar amounts like "$100" when there are no math operators.
			if (/^\d[\d,.]*(?:\s|$)/.test(inner.trim()) && !/[\\^_=<>+*/-]/.test(inner)) {
				return full;
			}
			return replaceLatexCommands(inner);
		});

	// Convert any remaining LaTeX commands outside delimiters.
	s = replaceLatexCommands(s);

	// Strip common Markdown syntax that looks raw in Neovim floating plain text.
	s = s
		.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
		.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, "$1")
		.replace(/`([^`\n]+)`/g, "$1")
		.replace(/\*\*([^*\n]+)\*\*/g, "$1")
		.replace(/__([^_\n]+)__/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/\n{3,}/g, "\n\n");

	return s.trim();
}
