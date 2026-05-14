import { listAccounts } from "$lib/server/actions/accounts";
import { importOFX, importCSV } from "$lib/server/actions/import";
import type { CSVMapping } from "$lib/server/import/csv";
import { fail } from "@sveltejs/kit";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export async function load({ locals }) {
	const { bookId } = locals;
	const accounts = await listAccounts(bookId);

	// Filter to ASSET, LIABILITY, and INCOME accounts (bank accounts, credit cards, income sources)
	const importableAccounts = accounts.filter((a) => a.type === "ASSET" || a.type === "LIABILITY" || a.type === "INCOME");

	return {
		accounts: importableAccounts.map((a) => ({
			...a,
			openingBalance: a.openingBalance != null ? Number(a.openingBalance) : null
		}))
	};
}

export const actions = {
	import: async ({ request, locals }) => {
		const { bookId } = locals;
		const data = await request.formData();
		const file = data.get("file") as File;
		const accountId = data.get("accountId") as string;
		const fileType = data.get("fileType") as string;
		const mappingJson = data.get("mapping") as string;

		if (!file || file.size === 0) {
			return fail(400, { error: "No file provided" });
		}

		if (!accountId) {
			return fail(400, { error: "No account selected" });
		}

		const tempPath = join(tmpdir(), `moneypit-import-${Date.now()}-${file.name}`);

		try {
			const buffer = Buffer.from(await file.arrayBuffer());
			await writeFile(tempPath, buffer);

			let result;

			if (fileType === "ofx" || file.name.match(/\.(ofx|qfx)$/i)) {
				result = await importOFX(bookId, tempPath, accountId);
			} else {
				if (!mappingJson) {
					return fail(400, { error: "CSV mapping configuration required" });
				}
				const mapping: CSVMapping = JSON.parse(mappingJson);
				result = await importCSV(bookId, tempPath, accountId, mapping);
			}

			return {
				success: true,
				result
			};
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		} finally {
			try {
				await unlink(tempPath);
			} catch {
				// Ignore cleanup errors
			}
		}
	}
};
