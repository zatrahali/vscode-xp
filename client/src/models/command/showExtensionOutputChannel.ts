import { Configuration } from '../configuration';
import { Command } from './command';

export class ShowExtensionOutputChannel extends Command {
	constructor(private config: Configuration) {
		super();
	}

	public async execute(): Promise<boolean> {
		this.config.getOutputChannel().show();
		return true;
	}
}