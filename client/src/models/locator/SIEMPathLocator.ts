import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { PathLocator } from './pathLocator';

export class SIEMPathHelper extends PathLocator {
	private constructor(kbFullPath: string) {
		super(kbFullPath);
	}
	
	private static _instance: SIEMPathHelper;

	public static get() : SIEMPathHelper {
		const kbFullPath =
		(vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
			? vscode.workspace.workspaceFolders[0].uri.fsPath
			: undefined;

		if (!SIEMPathHelper._instance){
			SIEMPathHelper._instance = new SIEMPathHelper(kbFullPath);
		}
		return SIEMPathHelper._instance;
	}

	public getRootByPath(directory: string): string{
		if (!directory){
			return "";
		}
		const pathEntities = directory.split(path.sep);
		const roots = this.getContentRoots().map(folder => {return path.basename(folder);});
		for (const root of roots) {
			const  packagesDirectoryIndex = pathEntities.findIndex( pe => pe.toLocaleLowerCase() === root);
			if(packagesDirectoryIndex === -1) {
				continue;
			}

			// Удаляем лишние элементы пути и собираем результирующий путь.
			pathEntities.splice(packagesDirectoryIndex + 1);
			const packageDirectoryPath = pathEntities.join(path.sep);
			return packageDirectoryPath;
		}

		throw new Error(`Путь '${directory}' не содержит ни одну из корневых директорий: [${roots.join(", ")}].`);
	}

	public getCorrulesGraphFileName() : string {
		return "corrules_graph.json";
	}	

	// В корневой директории лежат пакеты экспертизы
	public getContentRoots() : string[] {
		this.checkKbPath();
		return [path.join(this.KbFullPath, "packages")];
	}

	public getPackages() : string[]{
		const contentRoots = this.getContentRoots();
		const packagesDirectories = [];
		for(const root in contentRoots){
			packagesDirectories.concat(fs.readdirSync(root, { withFileTypes: true })
			.filter(dir => dir.isDirectory())
			.map(dir => dir.name));
		}		
		return packagesDirectories;
	}

	public getAppendixPath() : string {
		this.checkKbPath();
		const relative_path = path.join("contracts", "xp_appendix", "appendix.xp");
		return path.join(this.KbFullPath, relative_path);
	}

	public getTablesContract() : string {
		this.checkKbPath();
		const relative_path = path.join("_extra", "tabular_lists", "tables_contract.yaml");
		return path.join(this.KbFullPath, relative_path);
	}

	public getRulesDirFilters() : string {
		this.checkKbPath();
		const relative_path = path.join("common", "rules_filters");
		return path.join(this.KbFullPath, relative_path);
	}

	public isKbOpened() : boolean {
		const kbPath = SIEMPathHelper.get();
		const requredFolders = kbPath.getContentRoots();
		requredFolders.concat(kbPath.getRulesDirFilters());
		for (const folder of requredFolders){
			if (!fs.existsSync(folder)){
				return false;
			}
		}
		return true;
	}
}