import * as path from "path";
import * as fs from "fs";
import locale, { ILocale } from "locale-codes";

export abstract class BaseLocaleFileLocator {
	private defaultLanguageTag = 'ru';
	public readonly locale: ILocale;

    constructor(currentLanguageTag: string) {
		this.locale = locale.getByTag(currentLanguageTag);
	}

	public getLocaleFilePath() : string {
		const localeFunctionsFilePath = this.getLocaleFilePathImpl(this.locale.tag);
		if(fs.existsSync(localeFunctionsFilePath)) {
			return localeFunctionsFilePath;	
		}
		
		return this.getLocaleFilePathImpl(this.defaultLanguageTag);
	}

	protected abstract getLocaleFilePathImpl(tag: string) : string;
}