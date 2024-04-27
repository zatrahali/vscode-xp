import { BaseUnitTest } from './baseUnitTest';

export interface UnitTestRunner {
	run(
		unitTest: BaseUnitTest,
		options?: {
			useAppendix? : boolean
		}): Promise<BaseUnitTest>;
}
