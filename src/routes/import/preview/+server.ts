import { previewImport } from "$lib/server/actions/import";
import type { CSVMapping } from "$lib/server/import/csv";
import { json } from "@sveltejs/kit";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export async function POST({ request }) {
	const data = await request.formData();
	const file = data.get("file") as File;
	const accountId = data.get("accountId") as string;
	const mappingJson = data.get("mapping") as string | null;

	if (!file || file.size === 0) {
		return json({ error: "No file provided" }, { status: 400 });
	}

	if (!accountId) {
		return json({ error: "No account selected" }, { status: 400 });
	}

	const tempPath = join(tmpdir(), `moneypit-preview-${Date.now()}-${file.name}`);

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		await writeFile(tempPath, buffer);

		const isOFX = file.name.match(/\.(ofx|qfx)$/i);
		let mapping: CSVMapping | undefined;
		if (!isOFX && mappingJson) {
			mapping = JSON.parse(mappingJson);
		}
		const preview = await previewImport(tempPath, accountId, mapping);

		return json({
			transactions: preview.transactions.map((tx) => ({
				...tx,
				date: tx.date.toISOString()
			})),
			total: preview.total,
			duplicates: preview.duplicates,
			filename: file.name
		});
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 400 });
	} finally {
		try {
			await unlink(tempPath);
		} catch {
			// Ignore cleanup errors
		}
	}
}
