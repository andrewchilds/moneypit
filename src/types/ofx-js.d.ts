declare module 'ofx-js' {
	interface OFXTransaction {
		TRNTYPE?: string;
		DTPOSTED?: string;
		TRNAMT?: string;
		FITID?: string;
		NAME?: string;
		MEMO?: string;
	}

	interface OFXBankTransactionList {
		DTSTART?: string;
		DTEND?: string;
		STMTTRN?: OFXTransaction | OFXTransaction[];
	}

	interface OFXStatementResponse {
		BANKTRANLIST?: OFXBankTransactionList;
	}

	interface OFXBankMessagesResponse {
		STMTTRNRS?: {
			STMTRS?: OFXStatementResponse;
		};
	}

	interface OFXCreditCardMessagesResponse {
		CCSTMTTRNRS?: {
			CCSTMTRS?: OFXStatementResponse;
		};
	}

	interface OFXData {
		OFX?: {
			BANKMSGSRSV1?: OFXBankMessagesResponse;
			CREDITCARDMSGSRSV1?: OFXCreditCardMessagesResponse;
		};
	}

	export function parse(data: string): Promise<OFXData>;
}
