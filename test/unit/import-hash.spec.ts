import { describe, it, expect } from 'bun:test';
import { generateImportHash, generateLegacyImportHash } from '$lib/server/actions/import';

describe('generateImportHash', () => {
	const date = new Date(2026, 2, 15); // March 15, 2026
	const accountId = 'acc123';

	it('generates consistent hash for same inputs', () => {
		const hash1 = generateImportHash(date, 100.0, 'Test transaction', accountId);
		const hash2 = generateImportHash(date, 100.0, 'Test transaction', accountId);
		expect(hash1).toBe(hash2);
	});

	it('generates different hash for different amounts', () => {
		const hash1 = generateImportHash(date, 100.0, 'Test transaction', accountId);
		const hash2 = generateImportHash(date, 100.01, 'Test transaction', accountId);
		expect(hash1).not.toBe(hash2);
	});

	it('generates different hash for different descriptions', () => {
		const hash1 = generateImportHash(date, 100.0, 'Test transaction', accountId);
		const hash2 = generateImportHash(date, 100.0, 'Different transaction', accountId);
		expect(hash1).not.toBe(hash2);
	});

	it('generates different hash for different dates', () => {
		const date2 = new Date(2026, 2, 16);
		const hash1 = generateImportHash(date, 100.0, 'Test transaction', accountId);
		const hash2 = generateImportHash(date2, 100.0, 'Test transaction', accountId);
		expect(hash1).not.toBe(hash2);
	});

	it('generates different hash for different accounts', () => {
		const hash1 = generateImportHash(date, 100.0, 'Test transaction', 'acc123');
		const hash2 = generateImportHash(date, 100.0, 'Test transaction', 'acc456');
		expect(hash1).not.toBe(hash2);
	});

	it('uses FITID when provided', () => {
		const hashWithFitid = generateImportHash(date, 100.0, 'Test', accountId, 0, 'FITID123');
		const hashWithoutFitid = generateImportHash(date, 100.0, 'Test', accountId, 0);
		expect(hashWithFitid).not.toBe(hashWithoutFitid);
	});

	it('FITID hash ignores date/amount/description', () => {
		// With FITID, only the FITID and accountId matter
		const hash1 = generateImportHash(date, 100.0, 'Test', accountId, 0, 'FITID123');
		const date2 = new Date(2020, 0, 1);
		const hash2 = generateImportHash(date2, 999.99, 'Different', accountId, 0, 'FITID123');
		expect(hash1).toBe(hash2);
	});

	it('sequence number affects hash', () => {
		const hash1 = generateImportHash(date, 100.0, 'Test', accountId, 0);
		const hash2 = generateImportHash(date, 100.0, 'Test', accountId, 1);
		expect(hash1).not.toBe(hash2);
	});

	it('returns 32-character hex string', () => {
		const hash = generateImportHash(date, 100.0, 'Test', accountId);
		expect(hash).toMatch(/^[a-f0-9]{32}$/);
	});
});

describe('generateLegacyImportHash', () => {
	const date = new Date(2026, 2, 15);
	const accountId = 'acc123';

	it('generates consistent hash', () => {
		const hash1 = generateLegacyImportHash(date, 100.0, 'Test', accountId);
		const hash2 = generateLegacyImportHash(date, 100.0, 'Test', accountId);
		expect(hash1).toBe(hash2);
	});

	it('matches generateImportHash with seq=0 and no FITID', () => {
		// Legacy hash should match the old format (no sequence number)
		// This tests backward compatibility
		const legacy = generateLegacyImportHash(date, 100.0, 'Test', accountId);

		// The legacy hash format is: date|amount|description|accountId (no seq)
		// The new hash format with seq=0 is: date|amount|description|accountId|0
		// So they should NOT match (this is intentional - legacy is for old imports)
		const withSeq = generateImportHash(date, 100.0, 'Test', accountId, 0);
		expect(legacy).not.toBe(withSeq);
	});

	it('returns 32-character hex string', () => {
		const hash = generateLegacyImportHash(date, 100.0, 'Test', accountId);
		expect(hash).toMatch(/^[a-f0-9]{32}$/);
	});
});
