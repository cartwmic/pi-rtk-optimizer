import type { RtkRewriteRule } from "./rewrite-rules.js";

const COMMAND_WORD_PATTERN = /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|[^\s]+/g;
const BYPASSED_CARGO_SUBCOMMANDS = new Set(["help", "install", "publish"]);
const GH_STRUCTURED_OUTPUT_FLAGS = ["--json", "--jq", "--template"] as const;
const INTERACTIVE_CONTAINER_SHELLS = new Set([
	"ash",
	"bash",
	"cmd",
	"cmd.exe",
	"fish",
	"powershell",
	"powershell.exe",
	"pwsh",
	"pwsh.exe",
	"sh",
	"zsh",
]);

function splitCommandWords(commandBody: string): string[] {
	return commandBody.match(COMMAND_WORD_PATTERN) ?? [];
}

function shouldBypassCargoRewrite(tokens: string[]): boolean {
	let index = 1;

	while (index < tokens.length && tokens[index].startsWith("+")) {
		index += 1;
	}

	while (index < tokens.length && tokens[index].startsWith("-")) {
		index += 1;
	}

	const subcommand = tokens[index]?.toLowerCase();
	if (!subcommand) {
		return true;
	}

	return BYPASSED_CARGO_SUBCOMMANDS.has(subcommand);
}

function normalizeCommandWord(token: string): string {
	const unwrapped = token.replace(/^(?:["'`])|(?:["'`])$/g, "");
	const lastPathSeparator = Math.max(unwrapped.lastIndexOf("/"), unwrapped.lastIndexOf("\\"));
	const basename = lastPathSeparator >= 0 ? unwrapped.slice(lastPathSeparator + 1) : unwrapped;
	return basename.toLowerCase();
}

function findInteractiveShellIndex(tokens: string[], startIndex: number, endIndex: number): number {
	for (let index = startIndex; index < endIndex; index += 1) {
		if (INTERACTIVE_CONTAINER_SHELLS.has(normalizeCommandWord(tokens[index] ?? ""))) {
			return index;
		}
	}

	return -1;
}

function hasTrailingArguments(tokens: string[], startIndex: number, endIndex: number): boolean {
	return startIndex >= 0 && startIndex < endIndex - 1;
}

function hasStructuredGhOutputFlag(tokens: string[]): boolean {
	return tokens.some((token) => {
		const normalized = token.toLowerCase();
		return GH_STRUCTURED_OUTPUT_FLAGS.some((flag) => normalized === flag || normalized.startsWith(`${flag}=`));
	});
}

function hasShortInteractiveFlag(token: string, flag: "i" | "t"): boolean {
	if (!token.startsWith("-") || token.startsWith("--")) {
		return false;
	}

	return token.slice(1).includes(flag);
}

function hasInteractiveFlagPair(tokens: string[], startIndex: number, endIndex: number): boolean {
	let interactive = false;
	let tty = false;

	for (let index = startIndex; index < endIndex; index += 1) {
		const token = tokens[index] ?? "";
		if (token === "--interactive") {
			interactive = true;
			continue;
		}
		if (token === "--tty") {
			tty = true;
			continue;
		}
		if (hasShortInteractiveFlag(token, "i")) {
			interactive = true;
		}
		if (hasShortInteractiveFlag(token, "t")) {
			tty = true;
		}
	}

	return interactive && tty;
}

function shouldBypassInteractiveContainerRewrite(tokens: string[]): boolean {
	const command = tokens[0]?.toLowerCase();
	if (!command) {
		return false;
	}

	if (command === "docker" || command === "podman") {
		const subcommand = tokens[1]?.toLowerCase();
		if (subcommand === "run" || subcommand === "exec") {
			const interactiveShellIndex = findInteractiveShellIndex(tokens, 2, tokens.length);
			return (
				interactiveShellIndex >= 0 &&
				!hasTrailingArguments(tokens, interactiveShellIndex, tokens.length) &&
				!hasInteractiveFlagPair(tokens, 2, interactiveShellIndex)
			);
		}

		if (subcommand === "compose") {
			const composeSubcommand = tokens[2]?.toLowerCase();
			if (composeSubcommand === "run" || composeSubcommand === "exec") {
				const interactiveShellIndex = findInteractiveShellIndex(tokens, 3, tokens.length);
				return (
					interactiveShellIndex >= 0 &&
					!hasTrailingArguments(tokens, interactiveShellIndex, tokens.length) &&
					!hasInteractiveFlagPair(tokens, 3, interactiveShellIndex)
				);
			}
		}
	}

	if (command === "kubectl" && tokens[1]?.toLowerCase() === "exec") {
		const separatorIndex = tokens.indexOf("--");
		if (separatorIndex === -1 || separatorIndex >= tokens.length - 1) {
			return false;
		}

		const interactiveShellIndex = findInteractiveShellIndex(tokens, separatorIndex + 1, tokens.length);
		if (interactiveShellIndex === -1) {
			return false;
		}

		return !hasTrailingArguments(tokens, interactiveShellIndex, tokens.length) && !hasInteractiveFlagPair(tokens, 2, separatorIndex);
	}

	return false;
}

/**
 * Skips RTK rewrites for command shapes that do not map cleanly to RTK wrappers.
 */
export function shouldBypassRewriteForCommand(commandBody: string, rule: RtkRewriteRule): boolean {
	const tokens = splitCommandWords(commandBody.trim());
	if (tokens.length === 0) {
		return false;
	}

	if (tokens[0]?.toLowerCase() === "gh" && hasStructuredGhOutputFlag(tokens)) {
		return true;
	}

	if (rule.category === "rust" && tokens[0]?.toLowerCase() === "cargo") {
		return shouldBypassCargoRewrite(tokens);
	}

	if (rule.category === "containers") {
		return shouldBypassInteractiveContainerRewrite(tokens);
	}

	return false;
}
