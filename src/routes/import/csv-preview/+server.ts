import { previewCSV } from "$lib/server/import/csv";
import { json } from "@sveltejs/kit";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export async function POST({ request }) {
	const data = await request.formData();
	const file = data.get("file") as File;

	if (!file || file.size === 0) {
		return json({ error: "No file provided" }, { status: 400 });
	}

	const tempPath = join(tmpdir(), `moneypit-csv-preview-${Date.now()}-${file.name}`);

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		await writeFile(tempPath, buffer);

		const preview = await previewCSV(tempPath, 5);

		return json({
			headers: preview.headers,
			rows: preview.rows,
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
