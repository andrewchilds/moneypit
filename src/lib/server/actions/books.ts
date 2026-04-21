import { db } from '../db';
import type { Book } from '@prisma/client';

export async function listBooks(): Promise<Book[]> {
	return db.book.findMany({
		orderBy: { createdAt: 'asc' }
	});
}

export async function getBook(id: string): Promise<Book | null> {
	return db.book.findUnique({ where: { id } });
}

export interface CreateBookData {
	name: string;
	description?: string;
	isDemo?: boolean;
}

export async function createBook(data: CreateBookData): Promise<Book> {
	return db.book.create({ data });
}

export interface UpdateBookData {
	name?: string;
	description?: string;
}

export async function updateBook(id: string, data: UpdateBookData): Promise<Book> {
	return db.book.update({ where: { id }, data });
}

export async function deleteBook(id: string): Promise<void> {
	// Get counts for confirmation/warning
	const [accounts, transactions] = await Promise.all([
		db.account.count({ where: { bookId: id } }),
		db.transaction.count({ where: { bookId: id } })
	]);

	if (accounts > 0 || transactions > 0) {
		// Cascade delete handles it, but caller should be aware
		console.warn(`Deleting book with ${accounts} accounts and ${transactions} transactions`);
	}

	await db.book.delete({ where: { id } });
}

export async function getDefaultBook(): Promise<Book> {
	const book = await db.book.findFirst({ orderBy: { createdAt: 'asc' } });
	if (!book) {
		// Create default if none exists
		return createBook({ name: 'Default', description: 'Default book' });
	}
	return book;
}
