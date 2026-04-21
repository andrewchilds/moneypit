import type { TaxModule } from './types';
import {
	usPersonalBase,
	usScheduleC,
	nyState,
	njState,
	caState,
	form1120
} from './modules/index';

export const taxModules: TaxModule[] = [
	// US Federal
	usPersonalBase,
	usScheduleC,
	// US State
	nyState,
	njState,
	caState,
	// Corporate
	form1120,
];
