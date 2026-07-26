import assert from "node:assert/strict";

import { cloneDefaultConfig, mock, runTest } from "./test-helpers.test.ts";

mock.module("@earendil-works/pi-coding-agent", {
	namedExports: {
		getAgentDir: () => "/tmp/.pi/agent",
		getSettingsListTheme: () => ({}),
	},
});

mock.module("@earendil-works/pi-tui", {
	namedExports: {
		Box: class {
			addChild(): void {}
		},
		Container: class {
			addChild(): void {}
			render(): string[] {
				return ["settings-content"];
			}
			invalidate(): void {}
		},
		SettingsList: class {
			handleInput(): void {}
			updateValue(): void {}
		},
		Spacer: class {},
		Text: class {},
		truncateToWidth: (text: string, width: number) => text.slice(0, width),
		visibleWidth: (text: string) => text.length,
	},
});

const { registerRtkIntegrationCommand } = await import("./command-register.ts");
const { getRtkArgumentCompletions } = await import("./command-completions.ts");

interface Notification {
	message: string;
	level: string;
}

interface CommandContextStub {
	ui: { notify: (message: string, level: string) => void };
}

interface RegisteredCommandDefinition {
	description: string;
	handler: (args: string, ctx: CommandContextStub) => Promise<void>;
}

function createNotifyContext(): { ctx: CommandContextStub; notifications: Notification[] } {
	const notifications: Notification[] = [];
	return {
		ctx: {
			ui: {
				notify: (message: string, level: string) => {
					notifications.push({ message, level });
				},
			},
		},
		notifications,
	};
}

function lastNotification(notifications: Notification[]): Notification {
	const entry = notifications.at(-1);
	if (!entry) {
		throw new Error("Expected at least one notification");
	}
	return entry;
}

function createController(execRtkGain: (args: string[]) => Promise<string>) {
	const config = cloneDefaultConfig();
	return {
		getConfig: () => config,
		setConfig: () => {},
		getConfigPath: () => "C:/tmp/pi-rtk-optimizer/config.json",
		getRuntimeStatus: () => ({ rtkAvailable: true }),
		refreshRuntimeStatus: async () => ({ rtkAvailable: true }),
		getMetricsSummary: () => "metrics summary",
		clearMetrics: () => {},
		execRtkGain,
	};
}

function registerWith(controller: ReturnType<typeof createController>): RegisteredCommandDefinition {
	let definition: RegisteredCommandDefinition | undefined;
	registerRtkIntegrationCommand(
		{
			registerCommand(_name: string, nextDefinition: RegisteredCommandDefinition) {
				definition = nextDefinition;
			},
		} as never,
		controller as never,
	);
	if (!definition) {
		throw new Error("Expected /rtk command definition to be registered");
	}
	return definition;
}

await runTest("rtk gain subcommand is offered as an argument completion", async () => {
	const completions = getRtkArgumentCompletions("");
	assert.ok(completions?.some((entry) => entry.value === "gain"));

	const filtered = getRtkArgumentCompletions("ga");
	assert.deepEqual(filtered?.map((entry) => entry.value), ["gain"]);
});

await runTest("rtk gain routes to controller and reports CLI output", async () => {
	const calls: string[][] = [];
	const controller = createController(async (args) => {
		calls.push(args);
		return "saved 1234 tokens";
	});
	const definition = registerWith(controller);
	const { ctx, notifications } = createNotifyContext();

	await definition.handler("gain", ctx);
	assert.deepEqual(calls, [[]]);
	assert.equal(lastNotification(notifications).message, "saved 1234 tokens");
	assert.equal(lastNotification(notifications).level, "info");

	await definition.handler("gain --since 7d", ctx);
	assert.deepEqual(calls.at(-1), ["--since", "7d"]);
});

await runTest("rtk gain reports a placeholder when the CLI returns no data", async () => {
	const controller = createController(async () => "");
	const definition = registerWith(controller);
	const { ctx, notifications } = createNotifyContext();

	await definition.handler("gain", ctx);
	assert.equal(lastNotification(notifications).message, "No rtk gain data available.");
	assert.equal(lastNotification(notifications).level, "info");
});

await runTest("rtk gain surfaces CLI failures as an error notification", async () => {
	const controller = createController(async () => {
		throw new Error("rtk gain exited with code 2");
	});
	const definition = registerWith(controller);
	const { ctx, notifications } = createNotifyContext();

	await definition.handler("gain", ctx);
	assert.equal(lastNotification(notifications).level, "error");
	assert.ok(lastNotification(notifications).message.includes("rtk gain failed: rtk gain exited with code 2"));
});

await runTest("rtk usage text advertises the gain subcommand", async () => {
	const controller = createController(async () => "");
	const definition = registerWith(controller);
	const { ctx, notifications } = createNotifyContext();

	await definition.handler("help", ctx);
	assert.ok(lastNotification(notifications).message.includes("gain"));
});

console.log("All rtk gain tests passed.");
