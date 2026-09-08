import { describe, it, expect } from 'bun:test';
import { diff, serialize } from '$lib/server/actions/operationLog';

describe('diff', () => {
	it('returns empty objects when no differences', () => {
		const obj = { a: 1, b: 'test' };
		const result = diff(obj, obj);
		expect(result.before).toEqual({});
		expect(result.after).toEqual({});
	});

	it('detects changed values', () => {
		const before = { a: 1, b: 'old' };
		const after = { a: 1, b: 'new' };
		const result = diff(before, after);
		expect(result.before).toEqual({ b: 'old' });
		expect(result.after).toEqual({ b: 'new' });
	});

	it('detects added keys', () => {
		const before = { a: 1 } as Record<string, unknown>;
		const after = { a: 1, b: 'new' } as Record<string, unknown>;
		const result = diff(before, after);
		expect(result.before).toEqual({ b: undefined });
		expect(result.after).toEqual({ b: 'new' });
	});

	it('detects removed keys', () => {
		const before = { a: 1, b: 'old' } as Record<string, unknown>;
		const after = { a: 1 } as Record<string, unknown>;
		const result = diff(before, after);
		expect(result.before).toEqual({ b: 'old' });
		expect(result.after).toEqual({ b: undefined });
	});

	it('handles nested objects', () => {
		const before = { a: { x: 1 } };
		const after = { a: { x: 2 } };
		const result = diff(before, after);
		expect(result.before).toEqual({ a: { x: 1 } });
		expect(result.after).toEqual({ a: { x: 2 } });
	});

	it('handles null values', () => {
		const before = { a: null } as Record<string, unknown>;
		const after = { a: 'value' } as Record<string, unknown>;
		const result = diff(before, after);
		expect(result.before).toEqual({ a: null });
		expect(result.after).toEqual({ a: 'value' });
	});

	it('handles multiple changes', () => {
		const before = { a: 1, b: 2, c: 3 };
		const after = { a: 10, b: 2, c: 30 };
		const result = diff(before, after);
		expect(result.before).toEqual({ a: 1, c: 3 });
		expect(result.after).toEqual({ a: 10, c: 30 });
	});
});

describe('serialize', () => {
	it('serializes plain objects', () => {
		const obj = { a: 1, b: 'test' };
		expect(serialize(obj)).toEqual({ a: 1, b: 'test' });
	});

	it('converts Date to ISO string', () => {
		const date = new Date('2026-03-15T10:30:00.000Z');
		const obj = { date };
		const result = serialize(obj);
		expect(result.date).toBe('2026-03-15T10:30:00.000Z');
	});

	it('converts bigint to string', () => {
		const obj = { big: BigInt(12345678901234567890n) };
		const result = serialize(obj);
		expect(result.big).toBe('12345678901234567890');
	});

	it('handles nested objects with dates', () => {
		const date = new Date('2026-03-15T10:30:00.000Z');
		const obj = { nested: { date } };
		const result = serialize(obj);
		expect((result.nested as Record<string, unknown>).date).toBe('2026-03-15T10:30:00.000Z');
	});

	it('handles arrays', () => {
		const obj = { arr: [1, 2, 3] };
		expect(serialize(obj)).toEqual({ arr: [1, 2, 3] });
	});

	it('handles null and undefined', () => {
		const obj = { a: null, b: undefined };
		const result = serialize(obj);
		expect(result.a).toBe(null);
		expect('b' in result).toBe(false); // undefined is stripped by JSON
	});
});
