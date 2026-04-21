export interface TaxModuleCategory {
	name: string;
	scheduleRef: string;
	description?: string;
}

export interface TaxModule {
	id: string;
	name: string;
	description: string;
	group: 'us-federal' | 'us-state' | 'corporate';
	categories: TaxModuleCategory[];
}
