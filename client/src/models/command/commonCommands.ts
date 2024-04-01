import * as vscode from "vscode";

import { Configuration } from '../configuration';
import { ShowExtensionOutputChannel } from './showExtensionOutputChannel';

export class CommonCommands {
	public static init(config: Configuration) : void {
		config.getContext().subscriptions.push(
			vscode.commands.registerCommand(
				CommonCommands.SHOW_OUTPUT_CHANNEL_COMMAND,
				async () => {
					const command = new ShowExtensionOutputChannel(config);
					command.execute();
				}
			)
		);
	}

	public static SHOW_OUTPUT_CHANNEL_COMMAND = "xp.commonCommands.showOutputChannel";
}