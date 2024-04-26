import { Configuration } from '../configuration';
import { RuleBaseItem } from '../content/ruleBaseItem';

export interface RuleCommandParams {
	config: Configuration;
	rule: RuleBaseItem;
	tmpDirPath?: string;
	message?: any;
}

export abstract class ViewCommand {
	public abstract execute() : Promise<void>;
}

export abstract class Command {
	public abstract execute() : Promise<boolean>
}