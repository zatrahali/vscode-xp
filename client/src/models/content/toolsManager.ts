import * as fs from 'fs';

import { Configuration } from '../configuration';
import { Log } from '../../extension';
import { OsType } from '../locator/pathLocator';

export class ToolsManager {
	public static async init(config : Configuration) : Promise<void> {
		const evtxToJsonToolFullPath = config.getEvtxToJsonToolFullPath();
		
		switch(config.getOsType()) {
			case OsType.Linux: {
				await fs.promises.chmod(evtxToJsonToolFullPath, 0x777); 
				Log.info(`The utility file '${evtxToJsonToolFullPath}' is assigned an executable flag`);
				break;
			}
		}
	}
}