
export * from "./definitions";
export * from "./types";
export * from "./registry";

import { ACTIONS } from "./definitions";
import type { TActionWithOptionalArgs } from "./types";

const ACTIONS_REQUIRING_ARGS: ReadonlySet<string> = new Set([
	"remove-media-asset",
	"remove-media-assets",
]);

export function isActionWithOptionalArgs(
	value: string,
): value is TActionWithOptionalArgs {
	return (
		Object.prototype.hasOwnProperty.call(ACTIONS, value) &&
		!ACTIONS_REQUIRING_ARGS.has(value)
	);
}
