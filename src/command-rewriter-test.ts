import assert from "node:assert/strict";

import { computeRewriteDecision } from "./command-rewriter.ts";
import { cloneDefaultConfig, runTest } from "./test-helpers.ts";

function expectedProxyExecutable(base: string): string {
	const windowsExecutables = new Set(["npm", "npx", "pnpm", "yarn"]);
	return process.platform === "win32" && windowsExecutables.has(base) ? `${base}.cmd` : base;
}

runTest("pnpm dlx rewrites through RTK proxy instead of generic pnpm wrapper", () => {
	const config = cloneDefaultConfig();
	const decision = computeRewriteDecision("pnpm dlx create-vite@latest demo --template react-ts", config);

	assert.equal(decision.changed, true);
	assert.equal(decision.rule?.id, "pnpm-dlx-proxy");
	assert.equal(
		decision.rewrittenCommand,
		`rtk proxy ${expectedProxyExecutable("pnpm")} dlx create-vite@latest demo --template react-ts`,
	);
});

runTest("docker run with shell command bypasses rewrite when interactive flags are missing", () => {
	const config = cloneDefaultConfig();
	const decision = computeRewriteDecision("docker run ubuntu bash", config);

	assert.equal(decision.changed, false);
	assert.equal(decision.rewrittenCommand, "docker run ubuntu bash");
	assert.equal(decision.reason, "no_match");
});

runTest("docker run with -it keeps container rewrite enabled", () => {
	const config = cloneDefaultConfig();
	const decision = computeRewriteDecision("docker run -it ubuntu bash", config);

	assert.equal(decision.changed, true);
	assert.equal(decision.rule?.id, "docker");
	assert.equal(decision.rewrittenCommand, "rtk docker run -it ubuntu bash");
});

runTest("docker compose exec without -it bypasses interactive shell rewrite", () => {
	const config = cloneDefaultConfig();
	const decision = computeRewriteDecision("docker compose exec web bash", config);

	assert.equal(decision.changed, false);
	assert.equal(decision.rewrittenCommand, "docker compose exec web bash");
});

runTest("container rewrites stay enabled for scripted shells and non-shell commands", () => {
	const config = cloneDefaultConfig();

	const scriptedShell = computeRewriteDecision('docker run ubuntu bash -lc "echo hi"', config);
	assert.equal(scriptedShell.changed, true);
	assert.equal(scriptedShell.rule?.id, "docker");
	assert.equal(scriptedShell.rewrittenCommand, 'rtk docker run ubuntu bash -lc "echo hi"');

	const nonShell = computeRewriteDecision("docker run ubuntu python app.py", config);
	assert.equal(nonShell.changed, true);
	assert.equal(nonShell.rule?.id, "docker");
	assert.equal(nonShell.rewrittenCommand, "rtk docker run ubuntu python app.py");
});

runTest("kubectl exec requires interactive flags before rewriting shell sessions", () => {
	const config = cloneDefaultConfig();
	const missingFlagsDecision = computeRewriteDecision("kubectl exec pod-123 -- bash", config);
	assert.equal(missingFlagsDecision.changed, false);
	assert.equal(missingFlagsDecision.rewrittenCommand, "kubectl exec pod-123 -- bash");

	const interactiveDecision = computeRewriteDecision("kubectl exec -it pod-123 -- bash", config);
	assert.equal(interactiveDecision.changed, true);
	assert.equal(interactiveDecision.rule?.id, "kubectl");
	assert.equal(interactiveDecision.rewrittenCommand, "rtk kubectl exec -it pod-123 -- bash");
});

runTest("sed scripts keep internal separators intact while later pipe segments still rewrite", () => {
	const config = cloneDefaultConfig();
	const decision = computeRewriteDecision("sed -e s/a/b/;d file.txt | git status", config);

	assert.equal(decision.changed, true);
	assert.equal(decision.rewrittenCommand, "sed -e s/a/b/;d file.txt | rtk git status");
	assert.equal(decision.rule?.id, "git-any");
});

runTest("background operators rewrite both command segments without misreading redirect ampersands", () => {
	const config = cloneDefaultConfig();
	const backgroundDecision = computeRewriteDecision("git status & cargo test", config);
	assert.equal(backgroundDecision.changed, true);
	assert.equal(backgroundDecision.rewrittenCommand, "rtk git status & rtk cargo test");

	const redirectDecision = computeRewriteDecision("cargo test 2>&1 | head -5", config);
	assert.equal(redirectDecision.changed, true);
	assert.equal(redirectDecision.rewrittenCommand, "rtk cargo test 2>&1 | head -5");
	assert.equal(redirectDecision.rule?.id, "cargo-any");
});

runTest("gh structured output commands bypass RTK rewrites", () => {
	const config = cloneDefaultConfig();
	const structuredCommands = [
		"gh pr list --json number,title",
		"gh issue list --jq '.[].title'",
		"gh pr view 123 --template '{{.title}}'",
	];

	for (const command of structuredCommands) {
		const decision = computeRewriteDecision(command, config);
		assert.equal(decision.changed, false);
		assert.equal(decision.rewrittenCommand, command);
		assert.equal(decision.reason, "no_match");
	}
});

runTest("compound find and search shell flows bypass rewrites when RTK parity is unsafe", () => {
	const config = cloneDefaultConfig();
	const auditedCommands = [
		"find src -type f | xargs grep todo",
		"find . -name '*.ts' -exec grep -n FIXME {} +",
		"grep -R TODO src | head -n 5",
		"rg TODO src && wc -l",
	];

	for (const command of auditedCommands) {
		const decision = computeRewriteDecision(command, config);
		assert.equal(decision.changed, false, command);
		assert.equal(decision.rewrittenCommand, command, command);
		assert.equal(decision.reason, "no_match", command);
	}
});

runTest("formatting-sensitive ls flows bypass rewrites", () => {
	const config = cloneDefaultConfig();
	const auditedCommands = ["ls -la", "ls -l src | grep command-rewriter"];

	for (const command of auditedCommands) {
		const decision = computeRewriteDecision(command, config);
		assert.equal(decision.changed, false, command);
		assert.equal(decision.rewrittenCommand, command, command);
		assert.equal(decision.reason, "no_match", command);
	}
});

runTest("native bash shell proxy flows bypass rewrites when RTK parity is unsafe", () => {
	const config = cloneDefaultConfig();
	const command = 'bash -lc "find src -type f | xargs grep todo"';
	const decision = computeRewriteDecision(command, config);

	assert.equal(decision.changed, false);
	assert.equal(decision.rewrittenCommand, command);
	assert.equal(decision.reason, "no_match");
});

runTest("cd prefix does not bypass rewriting of subsequent commands", () => {
	const config = cloneDefaultConfig();

	// cd && <command> should rewrite the command segment
	const lsDecision = computeRewriteDecision("cd /foo && ls", config);
	assert.equal(lsDecision.changed, true, "cd && ls should rewrite");
	assert.ok(lsDecision.rewrittenCommand.includes("rtk ls"), "ls should become rtk ls");
	assert.ok(lsDecision.rewrittenCommand.startsWith("cd /foo && "), "cd prefix preserved");

	const catDecision = computeRewriteDecision("cd /some/path && cat file.txt", config);
	assert.equal(catDecision.changed, true, "cd && cat should rewrite");
	assert.ok(catDecision.rewrittenCommand.includes("rtk read"), "cat should become rtk read");

	const grepDecision = computeRewriteDecision("cd /src && grep -r TODO .", config);
	assert.equal(grepDecision.changed, true, "cd && grep should rewrite");
	assert.ok(grepDecision.rewrittenCommand.includes("rtk grep"), "grep should become rtk grep");

	const findDecision = computeRewriteDecision("cd /project && find . -name '*.ts'", config);
	assert.equal(findDecision.changed, true, "cd && find should rewrite");
	assert.ok(findDecision.rewrittenCommand.includes("rtk find"), "find should become rtk find");

	// Multiple cd segments should also work
	const multiCd = computeRewriteDecision("cd /a && cd /b && git status", config);
	assert.equal(multiCd.changed, true, "multiple cd && git should rewrite");
	assert.ok(multiCd.rewrittenCommand.includes("rtk git"), "git should become rtk git");
});

runTest("cd prefix does not defeat bypass for genuinely unsafe compounds", () => {
	const config = cloneDefaultConfig();

	// cd + genuine pipe should still bypass
	const pipedGrep = computeRewriteDecision("cd /foo && grep -R TODO src | head -n 5", config);
	assert.equal(pipedGrep.changed, false, "cd + grep|head should still bypass");

	const pipedFind = computeRewriteDecision("cd /foo && find src -type f | xargs grep todo", config);
	assert.equal(pipedFind.changed, false, "cd + find|xargs should still bypass");
});

runTest("python proxy rewrites preserve the original executable token", () => {
	const config = cloneDefaultConfig();
	const decision = computeRewriteDecision('python3.11 -c "print(1)"', config);

	assert.equal(decision.changed, true);
	assert.equal(decision.rule?.id, "python-proxy");
	assert.equal(decision.rewrittenCommand, `rtk proxy ${expectedProxyExecutable("python3.11")} -c "print(1)"`);
});

console.log("All command-rewriter tests passed.");
